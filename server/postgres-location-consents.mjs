import {randomUUID,randomBytes,verify,createHash} from 'node:crypto';
import {parseEnrollmentKey,decodeEnrollmentValue} from './enrollment-key.mjs';
import {createPostgresAuthSessionReader} from './postgres-auth-session.mjs';
import {locationPolicySnapshot,locationDigest,locationExact,locationAuthorization} from './location-policy.mjs';
import {prepareLocationConsent,prepareLocationProof,locationConsentProofMessage,locationUuid,locationStable,LocationInputError,LocationAuthError,LocationDeniedError,LocationConflictError} from './location-consent-input.mjs';
const lock=x=>createHash('sha256').update(x).digest().readBigInt64BE().toString();
const scopeFields=['subject','guard_id','vendor_id','site_id','assignment_id','device_id','device_thumbprint','revocation_version'];
const scopeOf=row=>Object.fromEntries(scopeFields.map(k=>[k,k==='revocation_version'?Number(row[k]):row[k]]));
const intentMatches=(row,intent)=>scopeFields.filter(k=>k!=='subject').every(k=>k==='revocation_version'?Number(row[k])===intent[k]:row[k]===intent[k])&&['policy_revision','notice_revision'].every(k=>Number(row[k])===intent[k])&&['policy_sha256','notice_sha256'].every(k=>row[k]===intent[k]);
export class PostgresLocationConsents{
 constructor({devices,audience='mercury-local',now=Date.now}){if(typeof devices?.transaction!=='function'||typeof devices?.pool?.query!=='function'||typeof now!=='function'||typeof audience!=='string'||!/^[A-Za-z0-9._:/-]{1,128}$/.test(audience))throw Error('Transactional location consent dependencies required');this.devices=devices;this.pool=devices.pool;this.now=now;this.audience=audience;}
 async requireSession(client,session){if(session?.active!==true||!locationUuid(session.subject)||!locationUuid(session.sessionId)||!Number.isSafeInteger(session.expiresAt)||session.expiresAt*1000<=this.now()||!await createPostgresAuthSessionReader(client)(session.subject,session.sessionId))throw new LocationAuthError('Current exact session required');}
 async consentLock(client,id,shared=false){await client.query(`SELECT pg_advisory_xact_lock${shared?'_shared':''}($1::bigint)`,[lock('mercury-location-consent:'+id)]);}
 async challenge(session,value){
  try{locationExact(value,['device_id','consent_id']);if(!locationStable(value.device_id)||value.consent_id!==null&&!locationUuid(value.consent_id))throw Error();}catch{throw new LocationInputError('Exact location challenge required');}
  return this.devices.transaction(async client=>{
   await this.requireSession(client,session);
   const d=(await client.query('SELECT * FROM mercury_guard.devices WHERE device_id=$1 FOR SHARE',[value.device_id])).rows[0];if(!d)throw new LocationDeniedError('Original device required');
   if(value.consent_id!==null){const c=(await client.query('SELECT subject,device_id,device_thumbprint,public_key_spki FROM mercury_guard.location_consents WHERE consent_id=$1 AND subject=$2',[value.consent_id,session.subject])).rows[0];if(!c||c.device_id!==d.device_id||c.device_thumbprint!==d.thumbprint||c.public_key_spki!==d.public_key_spki)throw new LocationDeniedError('Own original consent required');}
   else{const g=(await client.query('SELECT g.guard_id FROM mercury_guard.guards g JOIN mercury_guard.vendors v USING(vendor_id) WHERE g.auth_subject=$1 AND g.active AND v.active FOR SHARE OF g,v',[session.subject])).rows[0];if(!g||!d.active||d.revoked||d.mode==='personal'&&d.guard_id!==g.guard_id||d.mode==='site'&&(await client.query('SELECT 1 FROM mercury_guard.sites WHERE site_id=$1 AND active FOR SHARE',[d.site_id])).rowCount!==1)throw new LocationDeniedError('Current enrollment required');}
   const id=randomUUID(),nonce=randomBytes(32).toString('base64url'),expires=this.now()+60000;
   await client.query('INSERT INTO mercury_guard.device_challenges VALUES($1,$2,$3,$4,$5) ON CONFLICT(auth_subject,device_id) DO UPDATE SET request_id=excluded.request_id,nonce=excluded.nonce,expires_at_ms=excluded.expires_at_ms',[id,session.subject,d.device_id,nonce,expires]);await this.requireSession(client,session);return {audience:this.audience,request_id:id,challenge:nonce,expires_at:expires};
  });
 }
 async proof(client,session,operation,hash,proof,original=null){
  const p=prepareLocationProof(proof,this.audience),hint=(await client.query('SELECT device_id FROM mercury_guard.device_challenges WHERE request_id=$1 AND auth_subject=$2',[p.request_id,session.subject])).rows[0];if(!hint)throw new LocationDeniedError('Fresh location challenge required');
  const d=(await client.query('SELECT * FROM mercury_guard.devices WHERE device_id=$1 FOR SHARE',[hint.device_id])).rows[0],c=(await client.query('SELECT * FROM mercury_guard.device_challenges WHERE request_id=$1 AND auth_subject=$2 FOR UPDATE',[p.request_id,session.subject])).rows[0];
  if(!d||!c||Number(c.expires_at_ms)<=this.now()||c.nonce!==p.challenge||d.thumbprint!==p.device_thumbprint||d.public_key_spki!==p.public_key_spki)throw new LocationDeniedError('Current device possession required');
  if(operation==='withdraw'){if(!original||original.subject!==session.subject||original.device_id!==d.device_id||original.device_thumbprint!==d.thumbprint||original.public_key_spki!==d.public_key_spki)throw new LocationDeniedError('Own original withdrawal required');}
  else if(!d.active||d.revoked)throw new LocationDeniedError('Active location device required');
  const message=locationConsentProofMessage({audience:this.audience,operation,requestId:p.request_id,challenge:p.challenge,thumbprint:p.device_thumbprint,payloadHash:hash});if(!verify('sha256',Buffer.from(message),parseEnrollmentKey(d.public_key_spki).key,decodeEnrollmentValue(p.signature_der,80)))throw new LocationDeniedError('Intent-bound location signature required');
  if((await client.query('DELETE FROM mercury_guard.device_challenges WHERE request_id=$1 AND auth_subject=$2',[p.request_id,session.subject])).rowCount!==1)throw new LocationDeniedError('Location challenge consumed');return d;
 }
 async current(client,session,assignmentId,device,{confirmed=true,historical=false}={}){
  const row=(await client.query(`SELECT a.*,g.auth_subject,d.device_id,d.thumbprint AS device_thumbprint,d.public_key_spki,d.revocation_version FROM mercury_guard.assignments a
   JOIN mercury_guard.guards g ON g.guard_id=a.guard_id AND g.vendor_id=a.vendor_id JOIN mercury_guard.vendors v ON v.vendor_id=g.vendor_id JOIN mercury_guard.sites s ON s.site_id=a.site_id JOIN mercury_guard.devices d ON d.device_id=$3
   WHERE a.assignment_id=$1 AND g.auth_subject=$2 AND a.active AND g.active AND v.active AND s.active AND d.active AND NOT d.revoked
   AND ((d.mode='site' AND d.site_id=a.site_id) OR (d.mode='personal' AND d.guard_id=g.guard_id)) FOR SHARE OF a,g,v,s,d`,[assignmentId,session.subject,device.device_id??device.deviceId])).rows[0];
  const now=this.now();if(!row||Number(row.starts_at_ms)>now||(!historical&&Number(row.ends_at_ms)<=now)||(historical&&now>Number(row.ends_at_ms)+86400000)||!row.location_policy)return null;
  if(confirmed&&(await client.query('SELECT 1 FROM mercury_guard.shift_sessions WHERE assignment=$1 AND guard=$2 AND vendor=$3 AND site=$4 AND device=$5 AND starts_at=$6 AND ends_at=$7 AND clocked_in<=$8 AND clocked_out IS NULL FOR SHARE',[row.assignment_id,row.guard_id,row.vendor_id,row.site_id,row.device_thumbprint,row.starts_at_ms,row.ends_at_ms,now])).rowCount!==1)return null;
  const snapshot=locationPolicySnapshot(row.location_policy);return {...row,subject:session.subject,revocation_version:Number(row.revocation_version),policy_revision:snapshot.policy.revision,notice_revision:snapshot.policy.notice_revision,notice_sha256:snapshot.policy.notice_sha256,...snapshot};
 }
 async receive(session,encoded,proof){const prepared=prepareLocationConsent(encoded),i=prepared.intent;return this.devices.transaction(async client=>{
  await this.requireSession(client,session);
  const hint=(await client.query('SELECT * FROM mercury_guard.location_consents WHERE consent_id=$1',[i.consent_id])).rows[0],d=await this.proof(client,session,i.action,prepared.hash,proof,i.action==='withdraw'?hint:null);
  // Every operation takes its proof/nonce lock before consent locks. Reversing
  // this order lets a concurrent status and withdrawal deadlock.
  await client.query('SELECT pg_advisory_xact_lock($1::bigint)',[lock('mercury-location-request:'+i.request_id)]);await this.consentLock(client,i.consent_id);
  const old=(await client.query('SELECT * FROM mercury_guard.location_consents WHERE consent_id=$1',[i.consent_id])).rows[0];
  let current;
  if(i.action==='consent'){current=await this.current(client,session,i.assignment_id,d);if(!current||!intentMatches(current,i))throw new LocationDeniedError('Approved current shift policy required');}
  else if(!old||old.subject!==session.subject||!intentMatches(old,i))throw new LocationDeniedError('Exact own original withdrawal required');
  const prior=(await client.query('SELECT * FROM mercury_guard.location_consent_requests WHERE request_id=$1',[i.request_id])).rows[0];if(prior){if(prior.subject!==session.subject||prior.intent_sha256!==prepared.hash)throw new LocationConflictError('Location request UUID changed');await this.requireSession(client,session);return prior.receipt;}
  const at=this.now();let recordedAt=at;
  if(i.action==='consent'){
   if(old){if(old.subject!==session.subject||old.intent_raw!==prepared.raw)throw new LocationConflictError('Consent UUID already used');}
   else await client.query('INSERT INTO mercury_guard.location_consents(consent_id,subject,guard_id,vendor_id,site_id,assignment_id,device_id,device_thumbprint,revocation_version,public_key_spki,policy_revision,policy_sha256,policy_payload,notice_revision,notice_sha256,recorded_at_ms,intent_raw) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)',[i.consent_id,session.subject,i.guard_id,i.vendor_id,i.site_id,i.assignment_id,i.device_id,i.device_thumbprint,i.revocation_version,d.public_key_spki,i.policy_revision,i.policy_sha256,current.policy_payload,i.notice_revision,i.notice_sha256,at,prepared.raw]);
  }else{const withdrawn=(await client.query('SELECT withdrawn_at_ms FROM mercury_guard.location_consent_withdrawals WHERE consent_id=$1',[i.consent_id])).rows[0];if(withdrawn)recordedAt=Number(withdrawn.withdrawn_at_ms);else await client.query('INSERT INTO mercury_guard.location_consent_withdrawals(consent_id,subject,withdrawn_at_ms,intent_raw) VALUES($1,$2,$3,$4)',[i.consent_id,session.subject,at,prepared.raw]);}
  const receipt={version:1,request_id:i.request_id,consent_id:i.consent_id,action:i.action,status:i.action==='consent'?'consent_recorded':'consent_withdrawn',recorded_at_ms:recordedAt,intent_sha256:prepared.hash};await client.query('INSERT INTO mercury_guard.location_consent_requests VALUES($1,$2,$3,$4,$5)',[i.request_id,session.subject,i.consent_id,prepared.hash,receipt]);await this.requireSession(client,session);return receipt;
 });}
 async status(session,id,proof){if(!locationUuid(id))throw new LocationInputError('Exact consent UUID required');return this.devices.transaction(async client=>{
  await this.requireSession(client,session);const d=await this.proof(client,session,'status',locationDigest(JSON.stringify({consent_id:id})),proof);await this.consentLock(client,id,true);
  const row=(await client.query('SELECT * FROM mercury_guard.location_consents WHERE consent_id=$1 AND subject=$2 AND device_id=$3 AND device_thumbprint=$4 AND revocation_version=$5',[id,session.subject,d.device_id,d.thumbprint,d.revocation_version])).rows[0];if(!row)return null;
  const w=(await client.query('SELECT withdrawn_at_ms FROM mercury_guard.location_consent_withdrawals WHERE consent_id=$1',[id])).rows[0],current=await this.current(client,session,row.assignment_id,d),active=!!current&&current.policy_sha256===row.policy_sha256;
  await this.requireSession(client,session);return {version:1,consent_id:id,state:w?'withdrawn':active?'active':'unavailable',recorded_at_ms:Number(row.recorded_at_ms),withdrawn_at_ms:w?Number(w.withdrawn_at_ms):null,policy_sha256:row.policy_sha256,scope:scopeOf(row)};
 });}
 async forGrant(client,context){const {session,assignment,device}=context;if(!assignment.locationPolicy||!session?.sessionId)return null;await this.requireSession(client,session);const snapshot=locationPolicySnapshot(assignment.locationPolicy);
  const row=(await client.query(`SELECT c.* FROM mercury_guard.location_consents c WHERE subject=$1 AND assignment_id=$2 AND device_id=$3 AND device_thumbprint=$4 AND revocation_version=$5 AND policy_sha256=$6 AND NOT EXISTS(SELECT 1 FROM mercury_guard.location_consent_withdrawals w WHERE w.consent_id=c.consent_id) ORDER BY recorded_at_ms DESC,consent_id DESC LIMIT 1`,[session.subject,assignment.assignmentId,device.deviceId,device.thumbprint,device.revocationVersion,snapshot.policy_sha256])).rows[0];if(!row)return null;
  await this.consentLock(client,row.consent_id,true);if((await client.query('SELECT 1 FROM mercury_guard.location_consent_withdrawals WHERE consent_id=$1',[row.consent_id])).rowCount)return null;
  const current=await this.current(client,session,assignment.assignmentId,device);if(!current||current.policy_sha256!==row.policy_sha256||!scopeFields.every(k=>k==='revocation_version'?Number(row[k])===current[k]:row[k]===current[k]))return null;
  return {consent_id:row.consent_id,policy_sha256:row.policy_sha256,policy_payload:row.policy_payload};
 }
 async forIngest(client,context,authorization){const a=locationAuthorization(authorization);await this.requireSession(client,context.session);await this.consentLock(client,a.consent_id,true);
  const row=(await client.query('SELECT * FROM mercury_guard.location_consents WHERE consent_id=$1',[a.consent_id])).rows[0],expected={subject:context.subject,guard_id:context.guardId,vendor_id:context.vendorId,site_id:context.siteId,assignment_id:context.assignmentId,device_thumbprint:context.thumbprint,revocation_version:context.revocationVersion};
  if(!row||Object.keys(expected).some(k=>k==='revocation_version'?Number(row[k])!==expected[k]:row[k]!==expected[k])||row.policy_sha256!==a.policy_sha256||row.policy_payload!==a.policy_payload||(await client.query('SELECT 1 FROM mercury_guard.location_consent_withdrawals WHERE consent_id=$1',[a.consent_id])).rowCount)throw new LocationDeniedError('Current original location consent required');
  const current=await this.current(client,context.session,context.assignmentId,{device_id:row.device_id},{confirmed:false,historical:true});if(!current||current.policy_sha256!==row.policy_sha256||Number(row.recorded_at_ms)>context.locationEventAt)throw new LocationDeniedError('Current original location policy required');
  await this.requireSession(client,context.session);return a;
 }
}
