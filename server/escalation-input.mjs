import {createHash} from 'node:crypto';
import {strictJson} from './verify-batch.mjs';
export class EscalationInputError extends Error{}
export class EscalationAuthError extends Error{}
export class EscalationDeniedError extends Error{}
export class EscalationConflictError extends Error{}
export class EscalationNotFoundError extends Error{}
export const escalationUuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
export const escalationStable=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
export const escalationDigest=x=>createHash('sha256').update(x).digest('hex');
// Base64 expansion plus every bounded P-256 proof field still fits 16 KiB.
export const escalationMaxIntentBytes=11264;
export const escalationMaxRequestBytes=16384;
const integer=x=>Number.isSafeInteger(x)&&x>0;
export function escalationExact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!==[...keys].sort().join())throw new EscalationInputError('Exact escalation fields required');}
export function escalationText(value,max){if(typeof value!=='string'||!value.trim()||[...value].length>max||!value.isWellFormed()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))throw new EscalationInputError('Bounded escalation text required');return value;}
export function validateEscalationIntent(value){
 escalationExact(value,['version','escalation_id','guard_id','vendor_id','assignment_id','occurred_at_ms','urgency','description','location']);
 if(value.version!==1||!escalationUuid(value.escalation_id)||!escalationStable(value.guard_id)||!escalationStable(value.vendor_id)||value.assignment_id!==null&&!escalationStable(value.assignment_id)||!integer(value.occurred_at_ms)||!['urgent','assistance'].includes(value.urgency))throw new EscalationInputError('Valid escalation attribution required');
 escalationText(value.description,2000);
 if(value.location!==null){const l=value.location;escalationExact(l,['at_ms','latitude','longitude','accuracy_m','mock']);if(!integer(l.at_ms)||l.at_ms>value.occurred_at_ms||value.occurred_at_ms-l.at_ms>300000||!Number.isFinite(l.latitude)||l.latitude< -90||l.latitude>90||!Number.isFinite(l.longitude)||l.longitude< -180||l.longitude>180||!Number.isFinite(l.accuracy_m)||l.accuracy_m<=0||l.accuracy_m>1000||l.mock!==false)throw new EscalationInputError('Valid optional device-reported location required');Object.freeze(l);}
 return Object.freeze(value);
}
// Sign/hash the exact retained bytes. Java and JavaScript do not need to agree
// on object key order, floating-point spelling or JSON escaping conventions.
export function prepareEscalationIntent(encoded){
 if(typeof encoded!=='string'||encoded.length>Math.ceil(escalationMaxIntentBytes*4/3)||!/^[A-Za-z0-9_-]+$/.test(encoded))throw new EscalationInputError('Encoded escalation intent required');
 const bytes=Buffer.from(encoded,'base64url');if(bytes.length>escalationMaxIntentBytes||bytes.toString('base64url')!==encoded)throw new EscalationInputError('Bounded canonical intent encoding required');
 let raw,intent;try{raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(!Buffer.from(raw,'utf8').equals(bytes))throw Error();intent=validateEscalationIntent(strictJson(raw));}catch(e){if(e instanceof EscalationInputError)throw e;throw new EscalationInputError('Valid immutable escalation JSON required');}
 return {raw,intent,hash:escalationDigest(bytes)};
}
export function escalationStatusPayload(escalationId){if(!escalationUuid(escalationId))throw new EscalationInputError('Escalation ID required');return JSON.stringify({escalation_id:escalationId});}
export function prepareEscalationAcknowledgement(value){
 escalationExact(value,['request_id','escalation_id','reason']);if(!escalationUuid(value.request_id)||!escalationUuid(value.escalation_id))throw new EscalationInputError('Acknowledgement IDs required');
 escalationText(value.reason,500);if(/[\u0000-\u001f]/.test(value.reason))throw new EscalationInputError('Single-line acknowledgement note required');
 return Object.freeze({request_id:value.request_id,escalation_id:value.escalation_id,reason:value.reason.trim()});
}
export function escalationCatalogCursor(at,id){if(!integer(at)||!escalationUuid(id))throw new EscalationInputError('Escalation position required');return 'e1.'+Buffer.from(JSON.stringify([at,id])).toString('base64url');}
export function parseEscalationCatalogCursor(value){
 if(value==='')return null;
 if(typeof value!=='string'||value.length>200||!/^e1\.[A-Za-z0-9_-]+$/.test(value))throw new EscalationInputError('Bounded escalation cursor required');
 try{const raw=Buffer.from(value.slice(3),'base64url'),position=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(raw));if(!Array.isArray(position)||position.length!==2||escalationCatalogCursor(...position)!==value)throw Error();return position;}catch{throw new EscalationInputError('Valid escalation cursor required');}
}
