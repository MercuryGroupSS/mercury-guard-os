import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
const stable=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
// Called only after account, device proof and assignment authorization. Clock times
// come from the service; no automatic attendance event is inferred from a schedule.
export class ShiftLifecycle {
 constructor(path){this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS shift_sessions(assignment TEXT PRIMARY KEY,guard TEXT NOT NULL,vendor TEXT NOT NULL,site TEXT NOT NULL,device TEXT NOT NULL,starts_at INTEGER NOT NULL,ends_at INTEGER NOT NULL,clocked_in INTEGER NOT NULL,clocked_out INTEGER,reason TEXT);
 CREATE UNIQUE INDEX IF NOT EXISTS one_active_guard ON shift_sessions(guard) WHERE clocked_out IS NULL;
 CREATE UNIQUE INDEX IF NOT EXISTS one_active_phone ON shift_sessions(device) WHERE clocked_out IS NULL;
 CREATE TABLE IF NOT EXISTS shift_transitions(request TEXT PRIMARY KEY,digest TEXT NOT NULL,receipt TEXT NOT NULL);`);}
 transition({identity,assignment,deviceThumbprint,request,now}){
  if(!identity||!assignment||['guardId','vendorId'].some(k=>!stable(identity[k])||identity[k]!==assignment[k])||!stable(identity.subject)||!stable(assignment.assignmentId)||!stable(assignment.siteId)||assignment.active!==true||!/^[a-f0-9]{64}$/.test(deviceThumbprint)||!Number.isSafeInteger(now)||now<=0||!Number.isSafeInteger(assignment.startsAt)||!Number.isSafeInteger(assignment.endsAt)||assignment.startsAt>=assignment.endsAt)throw Error('Authorized shift scope required');
  if(!request||Object.keys(request).sort().join()!=='action,confirmed,reason,request_id'||!stable(request.request_id)||!['start','end'].includes(request.action)||request.confirmed!==true||typeof request.reason!=='string'||request.reason.length>2000)throw Error('Explicit shift confirmation required');
  const scope={guard_id:identity.guardId,vendor_id:identity.vendorId,site_id:assignment.siteId,assignment_id:assignment.assignmentId,device_thumbprint:deviceThumbprint};
  const digest=createHash('sha256').update(JSON.stringify({scope,subject:identity.subject,request,starts_at:assignment.startsAt,ends_at:assignment.endsAt})).digest('hex');
  this.db.exec('BEGIN IMMEDIATE');try{
   const retry=this.db.prepare('SELECT digest,receipt FROM shift_transitions WHERE request=?').get(request.request_id);
   if(retry){if(retry.digest!==digest)throw Error('Transition request changed');this.db.exec('COMMIT');return JSON.parse(retry.receipt);}
   const old=this.db.prepare('SELECT * FROM shift_sessions WHERE assignment=?').get(assignment.assignmentId);
   if(request.action==='start'){
    if(old||request.reason!==''||now<assignment.startsAt||now>=assignment.endsAt)throw Error('Shift cannot start');
    this.db.prepare('INSERT INTO shift_sessions VALUES(?,?,?,?,?,?,?,?,NULL,NULL)').run(assignment.assignmentId,identity.guardId,identity.vendorId,assignment.siteId,deviceThumbprint,assignment.startsAt,assignment.endsAt,now);
   }else{
    if(!old||old.clocked_out!==null||old.guard!==identity.guardId||old.vendor!==identity.vendorId||old.site!==assignment.siteId||old.device!==deviceThumbprint||old.starts_at!==assignment.startsAt||old.ends_at!==assignment.endsAt||now<old.clocked_in||now>old.ends_at+86400000)throw Error('Shift cannot end');
    if(now<old.ends_at&&!request.reason.trim())throw Error('Early exit reason required');
    this.db.prepare('UPDATE shift_sessions SET clocked_out=?,reason=? WHERE assignment=?').run(now,request.reason,assignment.assignmentId);
   }
   const saved=this.db.prepare('SELECT clocked_in,clocked_out,reason FROM shift_sessions WHERE assignment=?').get(assignment.assignmentId);
   const receipt={request_id:request.request_id,scope,action:request.action,recorded_at_ms:now,clocked_in_at_ms:saved.clocked_in,clocked_out_at_ms:saved.clocked_out,early_exit:saved.clocked_out!==null&&saved.clocked_out<assignment.endsAt,reason:saved.reason,status:'shift_recorded_local_only'};
   this.db.prepare('INSERT INTO shift_transitions VALUES(?,?,?)').run(request.request_id,digest,JSON.stringify(receipt));this.db.exec('COMMIT');return receipt;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
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
