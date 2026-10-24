import {strictJson} from './verify-batch.mjs';
import {parseEnrollmentKey,decodeEnrollmentValue} from './enrollment-key.mjs';
import {locationExact,locationDigest} from './location-policy.mjs';
export class LocationInputError extends Error{}
export class LocationAuthError extends Error{}
export class LocationDeniedError extends Error{}
export class LocationConflictError extends Error{}
export const locationUuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
export const locationStable=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
export function prepareLocationConsent(encoded){try{
 if(typeof encoded!=='string'||encoded.length>6000||!/^[A-Za-z0-9_-]+$/.test(encoded))throw Error();const bytes=Buffer.from(encoded,'base64url');if(bytes.length>4096||bytes.toString('base64url')!==encoded)throw Error();
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(!Buffer.from(raw).equals(bytes))throw Error();const intent=strictJson(raw);
 locationExact(intent,['version','request_id','consent_id','action','guard_id','vendor_id','site_id','assignment_id','device_id','device_thumbprint','revocation_version','policy_revision','policy_sha256','notice_revision','notice_sha256']);
 if(intent.version!==1||!locationUuid(intent.request_id)||!locationUuid(intent.consent_id)||!['consent','withdraw'].includes(intent.action)||['guard_id','vendor_id','site_id','assignment_id','device_id'].some(k=>!locationStable(intent[k]))||['device_thumbprint','policy_sha256','notice_sha256'].some(k=>typeof intent[k]!=='string'||!/^[a-f0-9]{64}$/.test(intent[k]))||['revocation_version','policy_revision','notice_revision'].some(k=>!Number.isSafeInteger(intent[k])||intent[k]<1))throw Error();
 return {raw,intent:Object.freeze({...intent}),hash:locationDigest(bytes)};
 }catch{throw new LocationInputError('Exact location consent intent required');}}
export function prepareLocationProof(value,audience){try{locationExact(value,['version','algorithm','audience','request_id','challenge','device_thumbprint','public_key_spki','signature_der']);if(value.version!==1||value.algorithm!=='SHA256withECDSA'||value.audience!==audience||!locationUuid(value.request_id)||typeof value.challenge!=='string'||decodeEnrollmentValue(value.challenge,32).length!==32||typeof value.device_thumbprint!=='string'||!/^[a-f0-9]{64}$/.test(value.device_thumbprint)||parseEnrollmentKey(value.public_key_spki).thumbprint!==value.device_thumbprint||decodeEnrollmentValue(value.signature_der,80).length<64)throw Error();return {...value};}catch{throw new LocationInputError('Location device proof required');}}
export function locationConsentProofMessage({audience,operation,requestId,challenge,thumbprint,payloadHash}){
 if(typeof audience!=='string'||!/^[A-Za-z0-9._:/-]{1,128}$/.test(audience)||!['consent','withdraw','status'].includes(operation)||!locationUuid(requestId)||typeof challenge!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(challenge)||![thumbprint,payloadHash].every(x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)))throw new LocationInputError('Bounded location proof required');
 return `mercury-location-consent-proof-v1\n${audience}\n${operation}\n${requestId}\n${challenge}\n${thumbprint}\n${payloadHash}`;
}
