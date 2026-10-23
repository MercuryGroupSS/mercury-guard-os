import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
const stable=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
// Called only after account, device proof and assignment authorization. Clock times
// come from the service; no automatic attendance event is inferred from a schedule.
export class ShiftTransitionRejected extends Error { constructor(receipt){super('Shift transition rejected');this.receipt=receipt;} }
export class ShiftLifecycle {
 constructor(path){this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS shift_sessions(assignment TEXT PRIMARY KEY,guard TEXT NOT NULL,vendor TEXT NOT NULL,site TEXT NOT NULL,device TEXT NOT NULL,starts_at INTEGER NOT NULL,ends_at INTEGER NOT NULL,clocked_in INTEGER NOT NULL,clocked_out INTEGER,reason TEXT);
 CREATE UNIQUE INDEX IF NOT EXISTS one_active_guard ON shift_sessions(guard) WHERE clocked_out IS NULL;
 CREATE UNIQUE INDEX IF NOT EXISTS one_active_phone ON shift_sessions(device) WHERE clocked_out IS NULL;
 CREATE TABLE IF NOT EXISTS shift_transitions(request TEXT PRIMARY KEY,digest TEXT NOT NULL,receipt TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS shift_rejections(request TEXT PRIMARY KEY,digest TEXT NOT NULL,receipt TEXT NOT NULL);`);}
 transition({identity,assignment,deviceThumbprint,request,now,allowStart=true}){
  if(typeof allowStart!=='boolean'||!identity||!assignment||['guardId','vendorId'].some(k=>!stable(identity[k])||identity[k]!==assignment[k])||!stable(identity.subject)||!stable(assignment.assignmentId)||!stable(assignment.siteId)||assignment.active!==true||!/^[a-f0-9]{64}$/.test(deviceThumbprint)||!Number.isSafeInteger(now)||now<=0||!Number.isSafeInteger(assignment.startsAt)||!Number.isSafeInteger(assignment.endsAt)||assignment.startsAt>=assignment.endsAt)throw Error('Authorized shift scope required');
  if(!request||Object.keys(request).sort().join()!=='action,confirmed,reason,request_id'||!stable(request.request_id)||!['start','end'].includes(request.action)||request.confirmed!==true||typeof request.reason!=='string'||request.reason.length>2000)throw Error('Explicit shift confirmation required');
  const scope={guard_id:identity.guardId,vendor_id:identity.vendorId,site_id:assignment.siteId,assignment_id:assignment.assignmentId,device_thumbprint:deviceThumbprint};
  const digest=createHash('sha256').update(JSON.stringify({scope,subject:identity.subject,request,starts_at:assignment.startsAt,ends_at:assignment.endsAt})).digest('hex');
  let committed=false;this.db.exec('BEGIN IMMEDIATE');try{
   const denied=this.db.prepare('SELECT digest,receipt FROM shift_rejections WHERE request=?').get(request.request_id);
   if(denied){if(denied.digest!==digest)throw Error('Rejected request changed');this.db.exec('COMMIT');committed=true;throw new ShiftTransitionRejected(JSON.parse(denied.receipt));}
   const reject=code=>{
    const receipt={request_id:request.request_id,scope,action:request.action,code,server_time_ms:now,status:'shift_rejected_local_only'};
    this.db.prepare('INSERT INTO shift_rejections VALUES(?,?,?)').run(request.request_id,digest,JSON.stringify(receipt));this.db.exec('COMMIT');committed=true;throw new ShiftTransitionRejected(receipt);
   };
   const retry=this.db.prepare('SELECT digest,receipt FROM shift_transitions WHERE request=?').get(request.request_id);
   if(retry){if(retry.digest!==digest)throw Error('Transition request changed');this.db.exec('COMMIT');return JSON.parse(retry.receipt);}
   if(request.action==='start'&&!allowStart)reject('shift_cannot_start');
   const old=this.db.prepare('SELECT * FROM shift_sessions WHERE assignment=?').get(assignment.assignmentId);
   if(request.action==='start'){
    if(old||request.reason!==''||now<assignment.startsAt||now>=assignment.endsAt)reject('shift_cannot_start');
    if(this.db.prepare('SELECT 1 FROM shift_sessions WHERE clocked_out IS NULL AND (guard=? OR device=?)').get(identity.guardId,deviceThumbprint))reject('active_shift_conflict');
    this.db.prepare('INSERT INTO shift_sessions VALUES(?,?,?,?,?,?,?,?,NULL,NULL)').run(assignment.assignmentId,identity.guardId,identity.vendorId,assignment.siteId,deviceThumbprint,assignment.startsAt,assignment.endsAt,now);
   }else{
    if(!old||old.clocked_out!==null||old.guard!==identity.guardId||old.vendor!==identity.vendorId||old.site!==assignment.siteId||old.device!==deviceThumbprint||old.starts_at!==assignment.startsAt||old.ends_at!==assignment.endsAt||now<old.clocked_in||now>old.ends_at+86400000)reject('shift_cannot_end');
    if(now<old.ends_at&&!request.reason.trim())reject('early_exit_reason_required');
    this.db.prepare('UPDATE shift_sessions SET clocked_out=?,reason=? WHERE assignment=?').run(now,request.reason,assignment.assignmentId);
   }
   const saved=this.db.prepare('SELECT clocked_in,clocked_out,reason FROM shift_sessions WHERE assignment=?').get(assignment.assignmentId);
   const receipt={request_id:request.request_id,scope,action:request.action,recorded_at_ms:now,clocked_in_at_ms:saved.clocked_in,clocked_out_at_ms:saved.clocked_out,early_exit:saved.clocked_out!==null&&saved.clocked_out<assignment.endsAt,reason:saved.reason,status:'shift_recorded_local_only'};
   this.db.prepare('INSERT INTO shift_transitions VALUES(?,?,?)').run(request.request_id,digest,JSON.stringify(receipt));this.db.exec('COMMIT');return receipt;
  }catch(e){if(!committed)this.db.exec('ROLLBACK');throw e;}
 }
 dashboardNotice(notice){
  if(!notice||notice.kind!=='check_in_delivery_missing'||!Number.isSafeInteger(notice.policy_revision)||notice.policy_revision<1||!Number.isSafeInteger(notice.slot)||notice.slot<0||!Number.isSafeInteger(notice.deadline_at)||!Number.isSafeInteger(notice.detected_at)||notice.deadline_at<=0||notice.detected_at<notice.deadline_at)throw Error('Invalid missed-delivery notice');
  const row=this.db.prepare('SELECT * FROM shift_sessions WHERE assignment=? AND guard=?').get(notice.assignment_id,notice.guard_id);
  if(!row)return null;
  if(notice.deadline_at<=row.clocked_in||notice.deadline_at>Math.min(row.ends_at,row.clocked_out??row.ends_at))throw Error('Notice outside confirmed shift');
  const h=createHash('sha256').update(JSON.stringify(['mercury-deadline-notice-v1',row.assignment,row.guard,row.vendor,row.device,notice.policy_revision,notice.slot])).digest('hex');
  const eventId=`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
  return {vendor_id:row.vendor,scope:{guard_id:row.guard,vendor_id:row.vendor,site_id:row.site,assignment_id:row.assignment,device_thumbprint:row.device},event:{event_id:eventId,at:notice.detected_at,kind:'check_in_delivery_missing',data:{policy_revision:notice.policy_revision,slot:notice.slot,deadline_at:notice.deadline_at,detected_at:notice.detected_at}}};
 }
 dashboardAfter(cursor,limit){
  if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('Bounded attendance page required');
  return this.db.prepare('SELECT rowid AS cursor,receipt FROM shift_transitions WHERE rowid>? ORDER BY rowid LIMIT ?').all(cursor,limit).map(row=>{
   const receipt=JSON.parse(row.receipt),s=receipt.scope;
   const h=createHash('sha256').update(`mercury-shift-observation-v1\n${s.device_thumbprint}\n${receipt.request_id}`).digest('hex');
   const eventId=`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
   return {cursor:row.cursor,body:JSON.stringify({vendor_id:s.vendor_id,scope:s,event:{event_id:eventId,at:receipt.recorded_at_ms,kind:receipt.action==='start'?'shift_start':'shift_end',data:{clocked_in_at_ms:receipt.clocked_in_at_ms,clocked_out_at_ms:receipt.clocked_out_at_ms,early_exit:receipt.early_exit,reason:receipt.reason}}})};
  });
 }
 checkInWindow(assignment){
  const row=this.db.prepare('SELECT * FROM shift_sessions WHERE assignment=?').get(assignment.assignmentId);
  if(!row)return null;
  if(row.guard!==assignment.guardId||row.vendor!==assignment.vendorId||row.site!==assignment.siteId||row.starts_at!==assignment.startsAt||row.ends_at!==assignment.endsAt)throw Error('Shift schedule mismatch');
  return {startsAt:row.clocked_in,endsAt:Math.min(row.ends_at,row.clocked_out??row.ends_at)};
 }
 snapshot(scope){
  const row=this.db.prepare('SELECT * FROM shift_sessions WHERE assignment=?').get(scope.assignmentId);
  if(!row)return {state:'not_started',clocked_in_at_ms:null,clocked_out_at_ms:null};
  if(row.guard!==scope.guardId||row.vendor!==scope.vendorId||row.site!==scope.siteId||row.device!==scope.deviceThumbprint)throw Error('Shift scope mismatch');
  return {state:row.clocked_out===null?'active':'ended',clocked_in_at_ms:row.clocked_in,clocked_out_at_ms:row.clocked_out};
 }
 permitsCapture(scope,at,{live=false}={}){
  if(!scope||!Number.isSafeInteger(at)||at<=0)return false;
  const row=this.db.prepare('SELECT * FROM shift_sessions WHERE assignment=?').get(scope.assignmentId);
  if(!row||row.guard!==scope.guardId||row.vendor!==scope.vendorId||row.site!==scope.siteId||row.device!==scope.deviceThumbprint)return false;
  if(live&&row.clocked_out!==null)return false;
  return at>=row.clocked_in&&at<row.ends_at&&(row.clocked_out===null||at<row.clocked_out);
 }
 close(){this.db.close();}
}
