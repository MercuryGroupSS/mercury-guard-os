import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {verifyBatch,strictJson} from './verify-batch.mjs';
const {privateKey,publicKey} = generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const spki=publicKey.export({type:'spki',format:'der'});
const thumbprint=createHash('sha256').update(spki).digest('hex');
const context={enrolled:true,revoked:false,notBefore:1000,expiresAt:1900,audience:'mercury-staging',thumbprint,
 publicKeySpki:spki.toString('base64url'),guardId:'synthetic-guard',siteId:'synthetic-site',assignmentId:'synthetic-assignment',revocationVersion:1,allowedKinds:['incident']};
const batch=()=>({batch_id:randomUUID(),schema_version:1,events:[{event_id:randomUUID(),at:0,kind:'incident',data:{note:'synthetic'},sequence:1}]});
function proof(raw=JSON.stringify(batch())) {
 const payload=Buffer.from(raw).toString('base64url');
 return {version:1,algorithm:'SHA256withECDSA',audience:context.audience,device_thumbprint:thumbprint,public_key_spki:context.publicKeySpki,payload,
 signature_der:sign('sha256',Buffer.from(`mercury-event-batch-v1\n${context.audience}\n${thumbprint}\n${payload}`),privateKey).toString('base64url')};
}
const run=(p=proof(),c=context,now=1100)=>verifyBatch(JSON.stringify(p),c,now);
test('valid DER ECDSA proof returns server-derived scope; old observation time is allowed',()=>{const result=run();assert.equal(result.scope.guardId,context.guardId);assert.match(result.payloadHash,/^[a-f0-9]{64}$/);});
test('payload tampering fails',()=>{const p=proof();p.payload=Buffer.from(JSON.stringify(batch())).toString('base64url');assert.throws(()=>run(p));});
test('signature tampering fails',()=>{const p=proof();p.signature_der=Buffer.alloc(70).toString('base64url');assert.throws(()=>run(p));});
test('unapproved, revoked or differently bound device fails',()=>{for(const patch of [{enrolled:false},{revoked:true},{thumbprint:'a'.repeat(64)},{publicKeySpki:'bad'}])assert.throws(()=>run(proof(),{...context,...patch}));});
test('wrong audience and extra envelope fields fail',()=>{assert.throws(()=>run({...proof(),audience:'other'}));assert.throws(()=>run({...proof(),extra:true}));});
test('expired, future and excessive lifetime authorization fails',()=>{assert.throws(()=>run(proof(),context,1900));assert.throws(()=>run(proof(),context,999));assert.throws(()=>run(proof(),{...context,expiresAt:2000}));});
test('missing trusted scope or permitted kind fails',()=>{assert.throws(()=>run(proof(),{...context,guardId:''}));assert.throws(()=>run(proof(),{...context,allowedKinds:['location']}));});
test('duplicate event IDs and non-increasing sequences fail',()=>{const b=batch();b.events.push({...b.events[0],sequence:2});assert.throws(()=>run(proof(JSON.stringify(b))));b.events[1].event_id=randomUUID();b.events[1].sequence=1;assert.throws(()=>run(proof(JSON.stringify(b))));});
test('coerced numbers, unknown event fields and malformed data fail',()=>{for(const patch of [{at:'1'},{sequence:1.5},{data:[]},{extra:1}]){const b=batch();Object.assign(b.events[0],patch);assert.throws(()=>run(proof(JSON.stringify(b))));}});
test('nested and escaped duplicate JSON keys and trailing input fail',()=>{for(const raw of ['{"a":1,"a":2}','{"x":{"a":1,"\\u0061":2}}','{}{}','[1,]','{"x":01}'])assert.throws(()=>strictJson(raw));});
test('payload duplicate keys rejected even with valid signature',()=>{const b=JSON.stringify(batch()).replace('"schema_version":1','"schema_version":1,"schema_version":1');assert.throws(()=>run(proof(b)));});
test('noncanonical base64, oversized input and deep nesting fail',()=>{const p=proof();p.payload+='=';assert.throws(()=>run(p));assert.throws(()=>verifyBatch(' '.repeat(360001),context,1100));assert.throws(()=>strictJson('['.repeat(66)+'0'+']'.repeat(66)));});
