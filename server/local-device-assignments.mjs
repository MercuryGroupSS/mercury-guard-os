import {checkInPolicy} from './check-in-policy.mjs';
import {patrolRoute} from './patrol-route.mjs';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,verify} from 'node:crypto';
import {parseEnrollmentKey as key,decodeEnrollmentValue as decode} from './enrollment-key.mjs';
import {assignmentForGuard} from './guard-directory.mjs';
const id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
// Local synthetic pilot. Administrative methods are deliberately not HTTP routes.
export class LocalDeviceAssignments {
 constructor(path,audience='mercury-local'){
  if(!/^[A-Za-z0-9._:/-]{1,128}$/.test(audience))throw Error('Audience required');
  this.audience=audience;this.db=new DatabaseSync(path);
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
   CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,thumbprint TEXT NOT NULL UNIQUE,body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS assignments(id TEXT PRIMARY KEY,guard_id TEXT NOT NULL,body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY,subject TEXT NOT NULL,device TEXT NOT NULL,nonce TEXT NOT NULL,expires INTEGER NOT NULL,UNIQUE(subject,device));`);
 }
 enroll(device){
  if(!id(device.deviceId)||device.active!==true||device.revoked!==false||
   !(device.mode==='site'&&id(device.siteId)||device.mode==='personal'&&id(device.guardId)))throw Error('Approved enrollment required');
  const k=key(device.publicKeySpki);
  const stored={deviceId:device.deviceId,mode:device.mode,siteId:device.mode==='site'?device.siteId:null,
   guardId:device.mode==='personal'?device.guardId:null,active:true,revoked:false,revocationVersion:1,publicKeySpki:device.publicKeySpki,thumbprint:k.thumbprint};
  this.db.prepare('INSERT INTO devices VALUES(?,?,?)').run(stored.deviceId,k.thumbprint,JSON.stringify(stored));
 }
 device(deviceId){const row=this.db.prepare('SELECT body FROM devices WHERE id=?').get(deviceId);return row?JSON.parse(row.body):null;}
 deviceByThumbprint(thumbprint){const row=this.db.prepare('SELECT body FROM devices WHERE thumbprint=?').get(thumbprint);return row?JSON.parse(row.body):null;}
 revoke(deviceId){const d=this.device(deviceId);if(!d)throw Error('Unknown device');d.revoked=true;d.revocationVersion=(d.revocationVersion??1)+1;this.db.prepare('UPDATE devices SET body=? WHERE id=?').run(JSON.stringify(d),deviceId);}
 assign(a){
  if(['assignmentId','guardId','vendorId','siteId'].some(k=>!id(a[k]))||a.active!==true||!Number.isSafeInteger(a.startsAt)||!Number.isSafeInteger(a.endsAt)||a.startsAt>=a.endsAt)throw Error('Invalid assignment');
  const row=Object.fromEntries(['assignmentId','guardId','vendorId','siteId','startsAt','endsAt','active'].map(k=>[k,a[k]]));
  if(a.patrolRoute)row.patrolRoute=patrolRoute(a.patrolRoute);
  if(a.checkInPolicy)row.checkInPolicy=checkInPolicy(a.checkInPolicy,a.startsAt,a.endsAt);
  this.db.prepare('INSERT INTO assignments VALUES(?,?,?)').run(a.assignmentId,a.guardId,JSON.stringify(row));
 }
 cancel(assignmentId){const row=this.db.prepare('SELECT body FROM assignments WHERE id=?').get(assignmentId);if(!row)throw Error('Unknown assignment');const a=JSON.parse(row.body);a.active=false;this.db.prepare('UPDATE assignments SET body=? WHERE id=?').run(JSON.stringify(a),assignmentId);}
 challenge(identity,deviceId,now=Date.now()){
  if(!id(identity?.subject)||!id(identity.guardId)||!id(deviceId)||!Number.isSafeInteger(now))throw Error('Invalid request');
  const d=this.device(deviceId);
  if(!d||!d.active||d.revoked||(d.mode==='personal'&&d.guardId!==identity.guardId))throw Error('Device unavailable');
  this.db.prepare('DELETE FROM challenges WHERE expires<=?').run(now);
  const requestId=randomUUID(),nonce=randomBytes(32).toString('base64url'),expires=now+60000;
  this.db.prepare('INSERT INTO challenges VALUES(?,?,?,?,?) ON CONFLICT(subject,device) DO UPDATE SET id=excluded.id,nonce=excluded.nonce,expires=excluded.expires').run(requestId,identity.subject,deviceId,nonce,expires);
  return {audience:this.audience,request_id:requestId,challenge:nonce,expires_at:expires};
 }
 list(identity,proof,now=Date.now(),{historical=false,includeCancelled=false}={}){
  const fields=['version','algorithm','audience','request_id','challenge','device_thumbprint','public_key_spki','signature_der'];
  if(!identity||!id(identity.subject)||!Number.isSafeInteger(now)||!proof||Object.keys(proof).sort().join()!==fields.sort().join()||proof.version!==1||proof.algorithm!=='SHA256withECDSA'||proof.audience!==this.audience||typeof proof.request_id!=='string')throw Error('Invalid proof');
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const c=this.db.prepare('SELECT * FROM challenges WHERE id=? AND subject=?').get(proof.request_id,identity.subject);
   if(!c||c.expires<=now||c.nonce!==proof.challenge)throw Error('Challenge unavailable');
   const d=this.device(c.device);
   if(!d||!d.active||d.revoked||proof.device_thumbprint!==d.thumbprint||proof.public_key_spki!==d.publicKeySpki)throw Error('Device unavailable');
   const message=`mercury-enrollment-proof-v1\n${this.audience}\n${c.id}\n${c.nonce}\n${d.thumbprint}`;
   if(!verify('sha256',Buffer.from(message),key(d.publicKeySpki).key,decode(proof.signature_der,80)))throw Error('Invalid signature');
   this.db.prepare('DELETE FROM challenges WHERE id=?').run(c.id);
   const assignments=this.db.prepare('SELECT body FROM assignments WHERE guard_id=?').all(identity.guardId)
    .map(r=>{const original=JSON.parse(r.body),mapped=historical&&now>original.endsAt+86400000?null:assignmentForGuard({identity,assignment:includeCancelled?{...original,active:true}:original,device:d,now:historical?Math.min(now,original.endsAt-1):now});return mapped?{...mapped,...(includeCancelled?{assignmentActive:original.active}:{}),...(original.checkInPolicy?{checkInPolicy:original.checkInPolicy}:{}),...(original.patrolRoute?{patrolRoute:original.patrolRoute}:{})}:null;}).filter(Boolean)
    .map(a=>({...a,deviceThumbprint:d.thumbprint,revocationVersion:d.revocationVersion}));
   this.db.exec('COMMIT');return {assignments};
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 authorizes(identity,authority,now=Date.now(),historical=false){
  if(!authority||typeof authority.thumbprint!=='string')return false;
  const row=this.db.prepare('SELECT body FROM devices WHERE thumbprint=?').get(authority.thumbprint);
  const assigned=this.db.prepare('SELECT body FROM assignments WHERE id=?').get(authority.assignmentId);
  if(!row||!assigned)return false;
  const device=JSON.parse(row.body),assignment=JSON.parse(assigned.body);
  if(device.revocationVersion!==authority.revocationVersion||device.publicKeySpki!==authority.publicKeySpki||assignment.siteId!==authority.siteId||assignment.guardId!==authority.guardId)return false;
  if(historical){
   if(!Number.isSafeInteger(now)||now<assignment.startsAt||now>assignment.endsAt+86400000)return false;
   return assignmentForGuard({identity,assignment,device,now:Math.min(now,assignment.endsAt-1)})?.canStart===true;
  }
  return assignmentForGuard({identity,assignment,device,now})?.canStart===true;
 }
 scheduledAfter(cursor,limit){
  if(typeof cursor!=='string'||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('Invalid schedule page');
  return this.db.prepare('SELECT body FROM assignments WHERE id>? ORDER BY id LIMIT ?').all(cursor,limit).map(r=>JSON.parse(r.body));
 }
 close(){this.db.close();}
}
