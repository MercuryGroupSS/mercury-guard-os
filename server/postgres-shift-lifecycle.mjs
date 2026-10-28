import {requirePostgresAuthSession} from './postgres-auth-session.mjs';
import {createHash} from 'node:crypto';
import {prepareShiftTransition} from './shift-transition-input.mjs';
import {ShiftTransitionRejected} from './shift-lifecycle.mjs';
const row=r=>r?{...r,...Object.fromEntries(['starts_at','ends_at','clocked_in','clocked_out'].map(k=>[k,r[k]===null?null:Number(r[k])]))}:null;
export class PostgresShiftLifecycle{
 constructor(devices){if(typeof devices?.transaction!=='function'||typeof devices?.pool?.query!=='function')throw Error('Transactional PostgreSQL adapter required');this.devices=devices;this.pool=devices.pool;}
 async transition(input){
  const {identity,assignment,deviceThumbprint,request,now,allowStart=true}=input,{scope,digest}=prepareShiftTransition(input);
  const result=await this.devices.transaction(async client=>{
   const finish=async result=>{await requirePostgresAuthSession(client,input.session,identity.subject,now);return result;};
   // Serializes receipt allocation through commit so dashboard cursors cannot skip a late commit.
   await client.query('SELECT pg_advisory_xact_lock(724910621355082::bigint)');
   await requirePostgresAuthSession(client,input.session,identity.subject,now);
   const denied=(await client.query('SELECT digest,receipt FROM mercury_guard.shift_rejections WHERE request=$1',[request.request_id])).rows[0];
   if(denied){if(denied.digest!==digest)throw Error('Rejected request changed');return finish({rejected:denied.receipt});}
   const reject=async code=>{const receipt={request_id:request.request_id,scope,action:request.action,code,server_time_ms:now,status:'shift_rejected_local_only'};await client.query('INSERT INTO mercury_guard.shift_rejections VALUES($1,$2,$3)',[request.request_id,digest,receipt]);return finish({rejected:receipt});};
   const retry=(await client.query('SELECT digest,receipt FROM mercury_guard.shift_transitions WHERE request=$1',[request.request_id])).rows[0];
   if(retry){if(retry.digest!==digest)throw Error('Transition request changed');return finish({receipt:retry.receipt});}
   // Revalidate and lock authority after asynchronous proof handling; cancellation or
   // suspension must serialize with a newly committed clock event.
   const authority=(await client.query(`SELECT a.active AS assignment_active FROM mercury_guard.assignments a
    JOIN mercury_guard.guards g ON g.guard_id=a.guard_id AND g.vendor_id=a.vendor_id
    JOIN mercury_guard.vendors v ON v.vendor_id=g.vendor_id
    JOIN mercury_guard.sites s ON s.site_id=a.site_id
    JOIN mercury_guard.devices d ON d.thumbprint=$1
    WHERE a.assignment_id=$2 AND a.guard_id=$3 AND a.vendor_id=$4 AND a.site_id=$5
     AND a.starts_at_ms=$6 AND a.ends_at_ms=$7 AND g.auth_subject=$8::uuid
     AND g.active AND v.active AND s.active AND d.active AND NOT d.revoked
     AND ((d.mode='site' AND d.site_id=a.site_id) OR (d.mode='personal' AND d.guard_id=g.guard_id))
    FOR SHARE OF a,g,v,s,d`,[deviceThumbprint,assignment.assignmentId,identity.guardId,identity.vendorId,assignment.siteId,assignment.startsAt,assignment.endsAt,identity.subject])).rows[0];
   if(!authority)return reject(request.action==='start'?'shift_cannot_start':'shift_cannot_end');
   if(request.action==='start'&&(!allowStart||!authority.assignment_active))return reject('shift_cannot_start');
   const old=row((await client.query('SELECT * FROM mercury_guard.shift_sessions WHERE assignment=$1',[assignment.assignmentId])).rows[0]);
   if(request.action==='start'){
    if(old||request.reason!==''||now<assignment.startsAt||now>=assignment.endsAt)return reject('shift_cannot_start');
    // Unconfirmed attendance remains historical after its scheduled capture
    // window ends. It must not reserve this guard/phone forever or invent an end.
    if((await client.query('SELECT 1 FROM mercury_guard.shift_sessions WHERE clocked_out IS NULL AND ends_at>$3 AND (guard=$1 OR device=$2)',[identity.guardId,deviceThumbprint,now])).rowCount)return reject('active_shift_conflict');
    await client.query('INSERT INTO mercury_guard.shift_sessions VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL,NULL)',[assignment.assignmentId,identity.guardId,identity.vendorId,assignment.siteId,deviceThumbprint,assignment.startsAt,assignment.endsAt,now]);
   }else{
    if(!old||old.clocked_out!==null||old.guard!==identity.guardId||old.vendor!==identity.vendorId||old.site!==assignment.siteId||old.device!==deviceThumbprint||old.starts_at!==assignment.startsAt||old.ends_at!==assignment.endsAt||now<old.clocked_in||now>old.ends_at+86400000)return reject('shift_cannot_end');
    if(now<old.ends_at&&!request.reason.trim())return reject('early_exit_reason_required');
    await client.query('UPDATE mercury_guard.shift_sessions SET clocked_out=$1,reason=$2 WHERE assignment=$3',[now,request.reason,assignment.assignmentId]);
   }
   const saved=row((await client.query('SELECT * FROM mercury_guard.shift_sessions WHERE assignment=$1',[assignment.assignmentId])).rows[0]);
   const receipt={request_id:request.request_id,scope,action:request.action,recorded_at_ms:now,clocked_in_at_ms:saved.clocked_in,clocked_out_at_ms:saved.clocked_out,early_exit:saved.clocked_out!==null&&saved.clocked_out<assignment.endsAt,reason:saved.reason,status:'shift_recorded_local_only'};
   await client.query('INSERT INTO mercury_guard.shift_transitions(request,digest,receipt) VALUES($1,$2,$3)',[request.request_id,digest,receipt]);return finish({receipt});
  });
  if(result.rejected)throw new ShiftTransitionRejected(result.rejected);return result.receipt;
 }
 async session(assignmentId){return row((await this.pool.query('SELECT * FROM mercury_guard.shift_sessions WHERE assignment=$1',[assignmentId])).rows[0]);}
 async snapshot(scope){const r=await this.session(scope.assignmentId);if(!r)return {state:'not_started',clocked_in_at_ms:null,clocked_out_at_ms:null};if(r.guard!==scope.guardId||r.vendor!==scope.vendorId||r.site!==scope.siteId||r.device!==scope.deviceThumbprint)throw Error('Shift scope mismatch');return {state:r.clocked_out===null?'active':'ended',clocked_in_at_ms:r.clocked_in,clocked_out_at_ms:r.clocked_out};}
 async permitsCapture(scope,at,{live=false}={}){if(!scope||!Number.isSafeInteger(at)||at<=0)return false;const r=await this.session(scope.assignmentId);return !!r&&r.guard===scope.guardId&&r.vendor===scope.vendorId&&r.site===scope.siteId&&r.device===scope.deviceThumbprint&&!(live&&r.clocked_out!==null)&&at>=r.clocked_in&&at<r.ends_at&&(r.clocked_out===null||at<r.clocked_out);}
 async checkInWindow(a){const r=await this.session(a.assignmentId);if(!r)return null;if(r.guard!==a.guardId||r.vendor!==a.vendorId||r.site!==a.siteId||r.starts_at!==a.startsAt||r.ends_at!==a.endsAt)throw Error('Shift schedule mismatch');return {startsAt:r.clocked_in,endsAt:Math.min(r.ends_at,r.clocked_out??r.ends_at)};}
 async dashboardAfter(cursor,limit){if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('Bounded attendance page required');return (await this.pool.query('SELECT sequence,receipt FROM mercury_guard.shift_transitions WHERE sequence>$1 ORDER BY sequence LIMIT $2',[cursor,limit])).rows.map(r=>{const c=r.receipt,s=c.scope,h=createHash('sha256').update(`mercury-shift-observation-v1\n${s.device_thumbprint}\n${c.request_id}`).digest('hex'),eventId=`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;return {cursor:Number(r.sequence),body:JSON.stringify({vendor_id:s.vendor_id,scope:s,event:{event_id:eventId,at:c.recorded_at_ms,kind:c.action==='start'?'shift_start':'shift_end',data:{clocked_in_at_ms:c.clocked_in_at_ms,clocked_out_at_ms:c.clocked_out_at_ms,early_exit:c.early_exit,reason:c.reason}}})};});}
 async dashboardNotice(notice){if(!notice||notice.kind!=='check_in_delivery_missing'||!Number.isSafeInteger(notice.policy_revision)||notice.policy_revision<1||!Number.isSafeInteger(notice.slot)||notice.slot<0||!Number.isSafeInteger(notice.deadline_at)||!Number.isSafeInteger(notice.detected_at)||notice.deadline_at<=0||notice.detected_at<notice.deadline_at)throw Error('Invalid missed-delivery notice');const r=await this.session(notice.assignment_id);if(!r||r.guard!==notice.guard_id)return null;if(notice.deadline_at<=r.clocked_in||notice.deadline_at>Math.min(r.ends_at,r.clocked_out??r.ends_at))throw Error('Notice outside confirmed shift');const h=createHash('sha256').update(JSON.stringify(['mercury-deadline-notice-v1',r.assignment,r.guard,r.vendor,r.device,notice.policy_revision,notice.slot])).digest('hex'),eventId=`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;return {vendor_id:r.vendor,scope:{guard_id:r.guard,vendor_id:r.vendor,site_id:r.site,assignment_id:r.assignment,device_thumbprint:r.device},event:{event_id:eventId,at:notice.detected_at,kind:'check_in_delivery_missing',data:{policy_revision:notice.policy_revision,slot:notice.slot,deadline_at:notice.deadline_at,detected_at:notice.detected_at}}};}
 close(){}
}
