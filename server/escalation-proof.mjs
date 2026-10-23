import {verify} from 'node:crypto';
import {parseEnrollmentKey,decodeEnrollmentValue} from './enrollment-key.mjs';
import {escalationExact,escalationUuid,escalationStable,EscalationInputError,EscalationDeniedError} from './escalation-input.mjs';
export function prepareEscalationProof(value,audience){
 escalationExact(value,['version','algorithm','audience','request_id','challenge','device_thumbprint','public_key_spki','signature_der']);
 if(value.version!==1||value.algorithm!=='SHA256withECDSA'||value.audience!==audience||!escalationUuid(value.request_id)||typeof value.challenge!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value.challenge)||typeof value.device_thumbprint!=='string'||!/^[a-f0-9]{64}$/.test(value.device_thumbprint))throw new EscalationInputError('Escalation possession proof required');
 try{if(decodeEnrollmentValue(value.challenge,32).length!==32||parseEnrollmentKey(value.public_key_spki).thumbprint!==value.device_thumbprint||decodeEnrollmentValue(value.signature_der,80).length<64)throw Error();}catch{throw new EscalationInputError('Valid escalation key and signature encoding required');}
 return Object.freeze(Object.fromEntries(Object.entries(value)));
}
export function escalationProofMessage({audience,operation,requestId,challenge,thumbprint,payloadHash}){
 if(typeof audience!=='string'||!/^[A-Za-z0-9._:/-]{1,128}$/.test(audience)||!['create','status'].includes(operation)||!escalationUuid(requestId)||!/^[A-Za-z0-9_-]{43}$/.test(challenge)||!/^[a-f0-9]{64}$/.test(thumbprint)||!/^[a-f0-9]{64}$/.test(payloadHash))throw new EscalationInputError('Bounded escalation proof context required');
 return `mercury-escalation-proof-v1\n${audience}\n${operation}\n${requestId}\n${challenge}\n${thumbprint}\n${payloadHash}`;
}
export function createPostgresEscalationProofAuthorizer(audience){
 if(typeof audience!=='string'||!/^[A-Za-z0-9._:/-]{1,128}$/.test(audience))throw Error('Fixed escalation audience required');
 return async({client,session,operation,payloadHash,proof,now})=>{
  const p=prepareEscalationProof(proof,audience);
  if(!escalationUuid(session?.subject)||!Number.isSafeInteger(now)||now<=0)throw new EscalationDeniedError('Escalation authority unavailable');
  const hint=(await client.query('SELECT device_id FROM mercury_guard.device_challenges WHERE request_id=$1 AND auth_subject=$2',[p.request_id,session.subject])).rows[0];
  if(!hint||!escalationStable(hint.device_id))throw new EscalationDeniedError('Fresh escalation challenge required');
  const d=(await client.query('SELECT device_id,thumbprint,public_key_spki,revocation_version,active,revoked FROM mercury_guard.devices WHERE device_id=$1 FOR SHARE',[hint.device_id])).rows[0];
  const c=(await client.query('SELECT request_id,nonce,expires_at_ms FROM mercury_guard.device_challenges WHERE request_id=$1 AND auth_subject=$2 FOR UPDATE',[p.request_id,session.subject])).rows[0];
  if(!c||Number(c.expires_at_ms)<=now||c.nonce!==p.challenge||!d?.active||d.revoked||d.thumbprint!==p.device_thumbprint||d.public_key_spki!==p.public_key_spki)throw new EscalationDeniedError('Current escalation device proof required');
  const message=escalationProofMessage({audience,operation,requestId:p.request_id,challenge:p.challenge,thumbprint:p.device_thumbprint,payloadHash});
  if(!verify('sha256',Buffer.from(message,'utf8'),parseEnrollmentKey(d.public_key_spki).key,decodeEnrollmentValue(p.signature_der,80)))throw new EscalationDeniedError('Intent-bound escalation signature required');
  if((await client.query('DELETE FROM mercury_guard.device_challenges WHERE request_id=$1 AND auth_subject=$2',[p.request_id,session.subject])).rowCount!==1)throw new EscalationDeniedError('Escalation challenge already consumed');
  return Object.freeze({deviceId:d.device_id,thumbprint:d.thumbprint,publicKeySpki:d.public_key_spki,revocationVersion:Number(d.revocation_version)});
 };
}
