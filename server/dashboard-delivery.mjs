import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {strictJson} from './verify-batch.mjs';
import {photoMetadata} from './photo-metadata.mjs';
const stable=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
const hash=x=>createHash('sha256').update(x).digest('hex');
const requiredText=(x,max)=>{if(typeof x!=='string'||!x.trim()||x.length>max)throw Error('Required observation text');return x;};
export function projectDashboardObservation(record,mapping){
 const scope=record?.scope,event=record?.event;
 if(!scope||!event||!mapping||mapping.active!==true||!stable(mapping.destination)||!stable(mapping.dashboardShiftId)||!Number.isSafeInteger(mapping.revision)||mapping.revision<1)throw Error('Approved destination mapping required');
 for(const [source,target] of [['guard_id','guardId'],['site_id','siteId'],['assignment_id','assignmentId']])if(!stable(scope[source])||scope[source]!==mapping[target])throw Error('Mapping scope mismatch');
 if(!stable(record.vendor_id)||record.vendor_id!==mapping.vendorId||!/^[a-f0-9]{64}$/.test(scope.device_thumbprint)||typeof event.event_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(event.event_id)||!Number.isSafeInteger(event.at)||event.at<=0)throw Error('Original attribution required');
 const d=event.data;let data;
 switch(event.kind){
  case 'incident':data={description:requiredText(d.description,8000)};break;
  case 'patrol_checkpoint':if(!stable(d.route_id)||!stable(d.checkpoint_id)||!Number.isSafeInteger(d.route_revision)||d.route_revision<1)throw Error('Invalid checkpoint');data={route_id:d.route_id,route_revision:d.route_revision,checkpoint_id:d.checkpoint_id};break;
  case 'photo_evidence':data={...photoMetadata(d),media_delivery:'not_transferred'};break;
  case 'check_in':
   if(!Number.isSafeInteger(d.policy_revision)||d.policy_revision<1||!Number.isSafeInteger(d.slot)||d.slot<0||typeof d.photo_event_id!=='string'||typeof d.evidence_id!=='string'||d.biometric?.method!=='android_local_biometric'||!Number.isSafeInteger(d.biometric.at)||!Number.isSafeInteger(d.location?.at)||d.location.mock!==false||!Number.isFinite(d.location.latitude)||!Number.isFinite(d.location.longitude)||!Number.isFinite(d.location.accuracy_m)||d.location.latitude< -90||d.location.latitude>90||d.location.longitude< -180||d.location.longitude>180||d.location.accuracy_m<=0||d.location.accuracy_m>1000||d.biometric.at>d.location.at||d.location.at>event.at)throw Error('Invalid check-in');
   data={policy_revision:d.policy_revision,slot:d.slot,biometric:{method:d.biometric.method,at:d.biometric.at},location:{at:d.location.at,latitude:d.location.latitude,longitude:d.location.longitude,accuracy_m:d.location.accuracy_m,mock:false},photo_event_id:d.photo_event_id,evidence_id:d.evidence_id,media_delivery:'not_transferred'};break;
  case 'check_in_miss_reason':if(!Number.isSafeInteger(d.policy_revision)||d.policy_revision<1||!Number.isSafeInteger(d.slot)||d.slot<0)throw Error('Invalid missed-check scope');data={policy_revision:d.policy_revision,slot:d.slot,reason:requiredText(d.reason,2000)};break;
  default:throw Error('Observation kind not approved for dashboard');
 }
 return {version:1,source:'mercury_one',delivery_id:hash(`mercury-one-observation-v1\n${scope.device_thumbprint}\n${event.event_id}`),destination:mapping.destination,
  mapping_revision:mapping.revision,dashboard_shift_id:mapping.dashboardShiftId,guard_id:scope.guard_id,vendor_id:record.vendor_id,site_id:scope.site_id,assignment_id:scope.assignment_id,
  observation:{event_id:event.event_id,device_thumbprint:scope.device_thumbprint,kind:event.kind,occurred_at_ms:event.at,data}};
}
export class DashboardOutbox {
 constructor(path){this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS dashboard_outbox(id TEXT PRIMARY KEY,hash TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL,next_at INTEGER NOT NULL,lease TEXT,lease_until INTEGER,receipt TEXT);`);}
 enqueue(record,mapping){
  const value=projectDashboardObservation(record,mapping),body=JSON.stringify(value),digest=hash(body);
  this.db.exec('BEGIN IMMEDIATE');try{
   const prior=this.db.prepare('SELECT hash FROM dashboard_outbox WHERE id=?').get(value.delivery_id);
   if(prior){if(prior.hash!==digest)throw Error('Existing delivery attribution or content changed');this.db.exec('COMMIT');return value.delivery_id;}
   this.db.prepare("INSERT INTO dashboard_outbox VALUES(?,?,?,'pending',0,0,NULL,NULL,NULL)").run(value.delivery_id,digest,body);
   this.db.exec('COMMIT');return value.delivery_id;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 claim(now=Date.now()){
  if(!Number.isSafeInteger(now)||now<=0)throw Error('Invalid worker time');
  this.db.exec('BEGIN IMMEDIATE');try{
   const row=this.db.prepare("SELECT * FROM dashboard_outbox WHERE status='pending' AND next_at<=? AND (lease_until IS NULL OR lease_until<=?) ORDER BY next_at,id LIMIT 1").get(now,now);
   if(!row){this.db.exec('COMMIT');return null;}
   const lease=randomUUID();this.db.prepare('UPDATE dashboard_outbox SET lease=?,lease_until=?,attempts=attempts+1 WHERE id=?').run(lease,now+120000,row.id);
   this.db.exec('COMMIT');return {id:row.id,hash:row.hash,body:row.body,lease,attempts:row.attempts+1};
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 accepted(job,receipt){
  validateDashboardReceipt(receipt,job);
  if(this.db.prepare("UPDATE dashboard_outbox SET status='delivered',receipt=?,lease=NULL,lease_until=NULL WHERE id=? AND lease=? AND status='pending'").run(JSON.stringify(receipt),job.id,job.lease).changes!==1)throw Error('Delivery lease changed');
 }
 retry(job,now=Date.now()){
  const delay=Math.min(3600000,1000*2**Math.min(job.attempts,12));
  return this.db.prepare("UPDATE dashboard_outbox SET next_at=?,lease=NULL,lease_until=NULL WHERE id=? AND lease=? AND status='pending'").run(now+delay,job.id,job.lease).changes===1;
 }
 close(){this.db.close();}
}
export function validateDashboardReceipt(value,job){
 const payload=JSON.parse(job.body);
 if(!value||Object.keys(value).sort().join()!=='delivery_id,destination,payload_sha256,status'||value.delivery_id!==job.id||value.destination!==payload.destination||value.payload_sha256!==job.hash||value.status!=='stored_in_integration_inbox')throw Error('Dashboard receipt mismatch');
}
export function createDashboardTransport({endpoint,token,allowLocal=false,fetchImpl=fetch}){
 const url=new URL(endpoint);
 if((url.protocol!=='https:'&&!(allowLocal&&url.protocol==='http:'&&url.hostname==='127.0.0.1'))||url.username||url.password||url.search||url.hash||typeof token!=='string'||token.length<32||token.length>4096||/\s/.test(token))throw Error('Explicit secure destination required');
 return async job=>{
  if(Buffer.byteLength(job.body)>64000)throw Error('Observation too large');
  const response=await fetchImpl(url,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:job.body});
  if(response.status!==200)throw Error('Dashboard did not accept observation');
  const reader=response.body?.getReader();if(!reader)throw Error('Missing receipt');
  const chunks=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();throw Error('Receipt too large');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
  const receipt=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));validateDashboardReceipt(receipt,job);return receipt;
 };
}
export async function deliverDashboardOnce(outbox,send,now=Date.now){
 const job=outbox.claim(now());if(!job)return 'idle';
 try{const receipt=await send(job);outbox.accepted(job,receipt);return 'delivered';}
 catch{outbox.retry(job,now());return 'pending';}
}
