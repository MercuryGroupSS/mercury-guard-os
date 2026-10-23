import {DatabaseSync} from 'node:sqlite';
import {createPrivateKey,createPublicKey,randomUUID,sign} from 'node:crypto';
const actions=new Set(['patrol','incident','photo','check_in','location']);
const stable=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
// Server-side issuer. Private key stays outside APKs and API responses.
export class ShiftGrantIssuer {
 constructor({path,privateKey,keyId,issuer,audience}){
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(keyId)||![issuer,audience].every(x=>typeof x==='string'&&x.length>0&&x.length<=256))throw Error('Issuer configuration required');
  const k=typeof privateKey==='string'||Buffer.isBuffer(privateKey)?createPrivateKey(privateKey):privateKey;
  if(k?.type!=='private'||k.asymmetricKeyType!=='rsa'||k.asymmetricKeyDetails.modulusLength<2048)throw Error('RSA signing key required');
  this.key=k;this.keyId=keyId;this.issuer=issuer;this.audience=audience;
  this.db=new DatabaseSync(path);
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
   CREATE TABLE IF NOT EXISTS issued_grants(id TEXT PRIMARY KEY,subject TEXT NOT NULL,vendor_id TEXT NOT NULL,payload TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);`);
 }
 publicKey(){return createPublicKey(this.key).export({type:'spki',format:'der'}).toString('base64url');}
 issue({identity,assignment,device,sessionExpiresAt,allowedActions,now=Date.now()}){
  if(!identity||!assignment||!device||!Number.isSafeInteger(now)||now<=0||!Number.isSafeInteger(sessionExpiresAt))throw Error('Invalid grant context');
  for(const k of ['subject','guardId','vendorId'])if(!stable(identity[k]))throw Error('Invalid guard');
  if(assignment.guardId!==identity.guardId||assignment.vendorId!==identity.vendorId||assignment.deviceId!==device.deviceId||!assignment.canStart||assignment.siteId!==device.siteId&&device.mode==='site'||!device.active||device.revoked)throw Error('Invalid binding');
  if(!stable(assignment.assignmentId)||!stable(assignment.siteId)||!Number.isSafeInteger(assignment.startsAt)||!Number.isSafeInteger(assignment.endsAt)||assignment.startsAt>now||assignment.endsAt<=now)throw Error('Assignment unavailable');
  if(device.mode==='personal'&&device.guardId!==identity.guardId||!['site','personal'].includes(device.mode))throw Error('Device unavailable');
  if(!/^[a-f0-9]{64}$/.test(device.thumbprint)||!Number.isSafeInteger(device.revocationVersion)||device.revocationVersion<0)throw Error('Invalid device scope');
  if(!Array.isArray(allowedActions)||!allowedActions.length||new Set(allowedActions).size!==allowedActions.length||allowedActions.some(a=>!actions.has(a)))throw Error('Invalid actions');
  const expiry=Math.min(now+900000,assignment.endsAt,sessionExpiresAt);
  if(expiry<=now)throw Error('Session expired');
  const claims={version:1,grant_id:randomUUID(),issuer:this.issuer,audience:this.audience,guard_id:identity.guardId,site_id:assignment.siteId,assignment_id:assignment.assignmentId,device_thumbprint:device.thumbprint,revocation_version:device.revocationVersion,issued_at_ms:now,not_before_ms:now,expires_at_ms:expiry,actions:[...allowedActions]};
  const payload=Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature=sign('sha256',Buffer.from(`mercury-shift-grant-v1.${this.keyId}.${payload}`),this.key).toString('base64url');
  this.db.prepare('INSERT INTO issued_grants(id,subject,vendor_id,payload) VALUES(?,?,?,?)').run(claims.grant_id,identity.subject,identity.vendorId,payload);
  return {key_id:this.keyId,payload,signature,server_time_ms:now};
 }
 lookup(grantId){
  if(typeof grantId!=='string'||grantId.length>100)return null;
  const row=this.db.prepare('SELECT * FROM issued_grants WHERE id=?').get(grantId);
  if(!row||row.revoked)return null;
  return {subject:row.subject,vendorId:row.vendor_id,claims:JSON.parse(Buffer.from(row.payload,'base64url').toString('utf8'))};
 }
 revoke(grantId){if(this.db.prepare('UPDATE issued_grants SET revoked=1 WHERE id=?').run(grantId).changes!==1)throw Error('Unknown grant');}
 close(){this.db.close();}
}
