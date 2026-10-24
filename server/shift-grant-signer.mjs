import {checkInPolicy} from './check-in-policy.mjs';
import {patrolRoute} from './patrol-route.mjs';
import {locationAuthorization,locationPolicySnapshot} from './location-policy.mjs';
import {createPrivateKey,createPublicKey,randomUUID,sign} from 'node:crypto';
const actions=new Set(['patrol','incident','photo','check_in','location','dispatch_ack']);
const stable=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
export class ShiftGrantSigner{
 constructor({privateKey,keyId,issuer,audience}){
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(keyId)||![issuer,audience].every(x=>typeof x==='string'&&x.length>0&&x.length<=256))throw Error('Issuer configuration required');
  const k=typeof privateKey==='string'||Buffer.isBuffer(privateKey)?createPrivateKey(privateKey):privateKey;
  if(k?.type!=='private'||k.asymmetricKeyType!=='rsa'||k.asymmetricKeyDetails.modulusLength<2048)throw Error('RSA signing key required');
  this.key=k;this.keyId=keyId;this.issuer=issuer;this.audience=audience;
 }
 publicKey(){return createPublicKey(this.key).export({type:'spki',format:'der'}).toString('base64url');}
 prepare({identity,assignment,device,sessionExpiresAt,allowedActions,location=null,now=Date.now()}){
  if(!identity||!assignment||!device||!Number.isSafeInteger(now)||now<=0||!Number.isSafeInteger(sessionExpiresAt))throw Error('Invalid grant context');
  for(const k of ['subject','guardId','vendorId'])if(!stable(identity[k]))throw Error('Invalid guard');
  if(assignment.guardId!==identity.guardId||assignment.vendorId!==identity.vendorId||assignment.deviceId!==device.deviceId||!assignment.canStart||assignment.siteId!==device.siteId&&device.mode==='site'||!device.active||device.revoked)throw Error('Invalid binding');
  if(!stable(assignment.assignmentId)||!stable(assignment.siteId)||!Number.isSafeInteger(assignment.startsAt)||!Number.isSafeInteger(assignment.endsAt)||assignment.startsAt>now||assignment.endsAt<=now)throw Error('Assignment unavailable');
  if(device.mode==='personal'&&device.guardId!==identity.guardId||!['site','personal'].includes(device.mode))throw Error('Device unavailable');
  if(!/^[a-f0-9]{64}$/.test(device.thumbprint)||!Number.isSafeInteger(device.revocationVersion)||device.revocationVersion<0)throw Error('Invalid device scope');
  if(!Array.isArray(allowedActions)||!allowedActions.length||new Set(allowedActions).size!==allowedActions.length||allowedActions.some(a=>!actions.has(a)))throw Error('Invalid actions');
  let authorization=null;
  if(allowedActions.includes('location')){authorization=locationAuthorization(location);if(!assignment.locationPolicy||locationPolicySnapshot(assignment.locationPolicy).policy_sha256!==authorization.policy_sha256)throw Error('Original approved location snapshot required');}
  else if(location!==null)throw Error('Unexpected location authorization');
  const expiry=Math.min(now+900000,assignment.endsAt,sessionExpiresAt,...(authorization?[now+authorization.policy.max_capture_lease_ms]:[]));
  if(expiry<=now)throw Error('Session expired');
  const claims={version:1,grant_id:randomUUID(),issuer:this.issuer,audience:this.audience,guard_id:identity.guardId,site_id:assignment.siteId,assignment_id:assignment.assignmentId,device_thumbprint:device.thumbprint,revocation_version:device.revocationVersion,issued_at_ms:now,not_before_ms:now,expires_at_ms:expiry,actions:[...allowedActions]};
  if(authorization)claims.location={consent_id:authorization.consent_id,policy_sha256:authorization.policy_sha256,policy_payload:authorization.policy_payload};
  const payload=Buffer.from(JSON.stringify(claims)).toString('base64url');
  if(payload.length>16384)throw Error('Signed grant too large');
  const signature=sign('sha256',Buffer.from(`mercury-shift-grant-v1.${this.keyId}.${payload}`),this.key).toString('base64url');
  const policy=assignment.patrolRoute?{patrolRoute:patrolRoute(assignment.patrolRoute)}:{};
  if(assignment.checkInPolicy)policy.checkInPolicy=checkInPolicy(assignment.checkInPolicy,assignment.startsAt,assignment.endsAt);
  if(authorization)policy.location=claims.location;
  return {claims,policy,payload,response:{key_id:this.keyId,payload,signature,server_time_ms:now,patrol_route:policy.patrolRoute??null,check_in_policy:policy.checkInPolicy??null}};
 }
}
