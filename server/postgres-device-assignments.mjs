import {randomBytes,randomUUID,verify} from 'node:crypto';
import {parseEnrollmentKey,decodeEnrollmentValue} from './enrollment-key.mjs';
import {assignmentForGuard} from './guard-directory.mjs';
import {patrolRoute} from './patrol-route.mjs';
import {checkInPolicy} from './check-in-policy.mjs';
const id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
const deviceRow=r=>r?{deviceId:r.device_id,mode:r.mode,siteId:r.site_id,guardId:r.guard_id,thumbprint:r.thumbprint,publicKeySpki:r.public_key_spki,active:r.active&&(r.mode!=='site'||r.site_active===true),revoked:r.revoked,revocationVersion:Number(r.revocation_version)}:null;
const assignmentRow=r=>({assignmentId:r.assignment_id,guardId:r.guard_id,vendorId:r.vendor_id,siteId:r.site_id,startsAt:Number(r.starts_at_ms),endsAt:Number(r.ends_at_ms),active:r.active,...(r.patrol_route?{patrolRoute:r.patrol_route}:{}),...(r.check_in_policy?{checkInPolicy:r.check_in_policy}:{})});
const deviceSelect='SELECT d.*,s.active AS site_active FROM mercury_guard.devices d LEFT JOIN mercury_guard.sites s ON s.site_id=d.site_id';
export class PostgresDeviceAssignments{
 constructor(pool,audience='mercury-local'){if(typeof pool?.connect!=='function'||typeof pool?.query!=='function'||!/^[A-Za-z0-9._:/-]{1,128}$/.test(audience))throw Error('Pool and audience required');this.pool=pool;this.audience=audience;}
 async transaction(fn,existingClient=null){if(existingClient)return fn(existingClient);const client=await this.pool.connect();try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
 async device(deviceId){return deviceRow((await this.pool.query(deviceSelect+' WHERE d.device_id=$1',[deviceId])).rows[0]);}
 async deviceByThumbprint(thumbprint){return deviceRow((await this.pool.query(deviceSelect+' WHERE d.thumbprint=$1',[thumbprint])).rows[0]);}
 async enroll(d,client=this.pool){
  if(!id(d?.deviceId)||d.active!==true||d.revoked!==false||!(d.mode==='site'&&id(d.siteId)&&d.guardId==null||d.mode==='personal'&&id(d.guardId)&&d.siteId==null))throw Error('Approved enrollment required');
  const key=parseEnrollmentKey(d.publicKeySpki);
  await client.query('INSERT INTO mercury_guard.devices(device_id,mode,site_id,guard_id,thumbprint,public_key_spki,active,revoked) VALUES($1,$2,$3,$4,$5,$6,true,false)',[d.deviceId,d.mode,d.mode==='site'?d.siteId:null,d.mode==='personal'?d.guardId:null,key.thumbprint,d.publicKeySpki]);
 }
 async revoke(deviceId,client=this.pool){if((await client.query('UPDATE mercury_guard.devices SET revoked=true,revocation_version=revocation_version+1 WHERE device_id=$1',[deviceId])).rowCount!==1)throw Error('Unknown device');}
 async assign(a,client=this.pool){
  if(!a||['assignmentId','guardId','vendorId','siteId'].some(k=>!id(a[k]))||a.active!==true||!Number.isSafeInteger(a.startsAt)||!Number.isSafeInteger(a.endsAt)||a.startsAt<=0||a.startsAt>=a.endsAt)throw Error('Invalid assignment');
  const route=a.patrolRoute?patrolRoute(a.patrolRoute):null,policy=a.checkInPolicy?checkInPolicy(a.checkInPolicy,a.startsAt,a.endsAt):null;
  await client.query('INSERT INTO mercury_guard.assignments(assignment_id,guard_id,vendor_id,site_id,starts_at_ms,ends_at_ms,active,patrol_route,check_in_policy) VALUES($1,$2,$3,$4,$5,$6,true,$7,$8)',[a.assignmentId,a.guardId,a.vendorId,a.siteId,a.startsAt,a.endsAt,route,policy]);
 }
 async cancel(assignmentId,client=this.pool){if((await client.query('UPDATE mercury_guard.assignments SET active=false WHERE assignment_id=$1',[assignmentId])).rowCount!==1)throw Error('Unknown assignment');}
 async challenge(identity,deviceId,now=Date.now()){
  if(!id(identity?.subject)||!id(identity.guardId)||!id(deviceId)||!Number.isSafeInteger(now)||now<=0)throw Error('Invalid challenge');
  return this.transaction(async client=>{
   const d=deviceRow((await client.query(deviceSelect+' WHERE d.device_id=$1 FOR SHARE OF d',[deviceId])).rows[0]);
   if(!d?.active||d.revoked||d.mode==='personal'&&d.guardId!==identity.guardId)throw Error('Device unavailable');
   const requestId=randomUUID(),nonce=randomBytes(32).toString('base64url'),expires=now+60000;
   await client.query('INSERT INTO mercury_guard.device_challenges VALUES($1,$2,$3,$4,$5) ON CONFLICT(auth_subject,device_id) DO UPDATE SET request_id=excluded.request_id,nonce=excluded.nonce,expires_at_ms=excluded.expires_at_ms',[requestId,identity.subject,deviceId,nonce,expires]);
   return {audience:this.audience,request_id:requestId,challenge:nonce,expires_at:expires};
  });
 }
 async list(identity,proof,now=Date.now(),{historical=false,includeCancelled=false}={}){
  const fields=['version','algorithm','audience','request_id','challenge','device_thumbprint','public_key_spki','signature_der'];
  if(!identity||!id(identity.subject)||!Number.isSafeInteger(now)||!proof||Object.keys(proof).sort().join()!==fields.sort().join()||proof.version!==1||proof.algorithm!=='SHA256withECDSA'||proof.audience!==this.audience)throw Error('Invalid proof');
  return this.transaction(async client=>{
   const hint=(await client.query('SELECT device_id FROM mercury_guard.device_challenges WHERE request_id=$1 AND auth_subject=$2',[proof.request_id,identity.subject])).rows[0];if(!hint)throw Error('Challenge unavailable');
   const d=deviceRow((await client.query(deviceSelect+' WHERE d.device_id=$1 FOR SHARE OF d',[hint.device_id])).rows[0]);
   const c=(await client.query('SELECT * FROM mercury_guard.device_challenges WHERE request_id=$1 AND auth_subject=$2 FOR UPDATE',[proof.request_id,identity.subject])).rows[0];
   if(!c||Number(c.expires_at_ms)<=now||c.nonce!==proof.challenge)throw Error('Challenge unavailable');
   if(!d?.active||d.revoked||proof.device_thumbprint!==d.thumbprint||proof.public_key_spki!==d.publicKeySpki)throw Error('Device unavailable');
   const message=`mercury-enrollment-proof-v1\n${this.audience}\n${c.request_id}\n${c.nonce}\n${d.thumbprint}`;
   if(!verify('sha256',Buffer.from(message),parseEnrollmentKey(d.publicKeySpki).key,decodeEnrollmentValue(proof.signature_der,80)))throw Error('Invalid signature');
   await client.query('DELETE FROM mercury_guard.device_challenges WHERE request_id=$1',[c.request_id]);
   const rows=(await client.query('SELECT * FROM mercury_guard.assignments WHERE guard_id=$1',[identity.guardId])).rows;
   const assignments=rows.map(assignmentRow).map(a=>{
    if(historical&&now>a.endsAt+86400000)return null;
    const mapped=assignmentForGuard({identity,assignment:includeCancelled?{...a,active:true}:a,device:d,now:historical?Math.min(now,a.endsAt-1):now});
    return mapped?{...mapped,...(includeCancelled?{assignmentActive:a.active}:{}),...(a.patrolRoute?{patrolRoute:a.patrolRoute}:{}),...(a.checkInPolicy?{checkInPolicy:a.checkInPolicy}:{}),deviceThumbprint:d.thumbprint,revocationVersion:d.revocationVersion}:null;
   }).filter(Boolean);
   return {assignments};
  });
 }
 async authorizes(identity,authority,now=Date.now(),historical=false){
  if(!authority||typeof authority.thumbprint!=='string'||!Number.isSafeInteger(now))return false;
  const d=await this.deviceByThumbprint(authority.thumbprint),row=(await this.pool.query('SELECT * FROM mercury_guard.assignments WHERE assignment_id=$1',[authority.assignmentId])).rows[0];
  if(!d||!row)return false;const a=assignmentRow(row);
  if(d.revocationVersion!==authority.revocationVersion||d.publicKeySpki!==authority.publicKeySpki||a.siteId!==authority.siteId||a.guardId!==authority.guardId)return false;
  if(historical&&(now<a.startsAt||now>a.endsAt+86400000))return false;
  return assignmentForGuard({identity,assignment:a,device:d,now:historical?Math.min(now,a.endsAt-1):now})?.canStart===true;
 }
 async scheduledAfter(cursor,limit){if(typeof cursor!=='string'||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('Bounded schedule page required');return (await this.pool.query('SELECT * FROM mercury_guard.assignments WHERE assignment_id>$1 ORDER BY assignment_id LIMIT $2',[cursor,limit])).rows.map(assignmentRow);}
}
