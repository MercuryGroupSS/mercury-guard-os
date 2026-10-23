import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID,randomBytes,generateKeyPairSync,sign} from 'node:crypto';
import {prepareEscalationIntent,escalationDigest,escalationStatusPayload,prepareEscalationAcknowledgement,escalationCatalogCursor,parseEscalationCatalogCursor,EscalationInputError,EscalationDeniedError,escalationMaxIntentBytes,escalationMaxRequestBytes} from './escalation-input.mjs';
import {createPostgresEscalationProofAuthorizer,prepareEscalationProof,escalationProofMessage} from './escalation-proof.mjs';
const intent=()=>({version:1,escalation_id:randomUUID(),guard_id:'guard-1',vendor_id:'company-1',assignment_id:null,occurred_at_ms:1000,urgency:'assistance',description:'Synthetic request — no real alert',location:null});
const encode=value=>Buffer.from(typeof value==='string'?value:JSON.stringify(value),'utf8').toString('base64url');
test('escalation snapshots retain exact UTF-8 bytes, guard/company attribution and optional off-shift scope',()=>{
 const value=intent(),compact=prepareEscalationIntent(encode(value)),formatted=prepareEscalationIntent(encode(JSON.stringify(value,null,2)));assert.equal(compact.intent.assignment_id,null);assert.equal(compact.intent.vendor_id,'company-1');assert.notEqual(compact.hash,formatted.hash);assert.equal(compact.hash,escalationDigest(compact.raw));assert.equal(compact.raw,JSON.stringify(value));assert.equal(Object.isFrozen(compact.intent),true);
 const withLocation=prepareEscalationIntent(encode({...value,location:{at_ms:999,latitude:45.1234567,longitude:-73.1234567,accuracy_m:12.1,mock:false}}));assert.equal(Object.isFrozen(withLocation.intent.location),true);
 assert.equal(escalationStatusPayload(value.escalation_id),JSON.stringify({escalation_id:value.escalation_id}));
});
test('escalation input rejects duplicate/extra keys, malformed encoding and untrusted location without imposing a GPS requirement',()=>{
 const value=intent();for(const patch of [{version:2},{guard_id:'bad space'},{vendor_id:''},{assignment_id:undefined},{occurred_at_ms:1.5},{occurred_at_ms:0},{urgency:'medical_triage'},{description:' '},{description:'x'.repeat(2001)},{description:'bad\u0000text'},{description:'\ud800'},{unknown:true},{location:{at_ms:1001,latitude:0,longitude:0,accuracy_m:1,mock:false}},{location:{at_ms:1,latitude:91,longitude:0,accuracy_m:1,mock:false}},{location:{at_ms:1,latitude:0,longitude:0,accuracy_m:1,mock:true}}])assert.throws(()=>prepareEscalationIntent(encode({...value,...patch})),EscalationInputError);
 for(const raw of ['[]','null','{"version":1,"version":1}',JSON.stringify(value)+' trailing'])assert.throws(()=>prepareEscalationIntent(encode(raw)),EscalationInputError);
 for(const encoded of [encode(value)+'=',encode(value)+'\n','x'.repeat(17000),Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(JSON.stringify(value))]).toString('base64url'),Buffer.from([0xff,0xfe]).toString('base64url')])assert.throws(()=>prepareEscalationIntent(encoded),EscalationInputError);
 assert.equal(prepareEscalationIntent(encode(value)).intent.location,null);
});
test('operator acknowledgement requests and opaque cursors bind exact stable IDs and bounded guard-visible notes',()=>{
 const request={request_id:randomUUID(),escalation_id:randomUUID(),reason:' Reviewed synthetic report '};assert.equal(prepareEscalationAcknowledgement(request).reason,'Reviewed synthetic report');for(const patch of [{reason:'\nReviewed'},{reason:' '},{request_id:'bad'},{reason:'x'.repeat(501)},{extra:true}])assert.throws(()=>prepareEscalationAcknowledgement({...request,...patch}),EscalationInputError);
 const cursor=escalationCatalogCursor(1000,request.escalation_id);assert.deepEqual(parseEscalationCatalogCursor(cursor),[1000,request.escalation_id]);assert.equal(parseEscalationCatalogCursor(''),null);for(const bad of [cursor+'=',cursor+'x','e1.e30','x'.repeat(201)])assert.throws(()=>parseEscalationCatalogCursor(bad),EscalationInputError);
});
function proofFixture(){
 const key=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),spki=key.publicKey.export({type:'spki',format:'der'}).toString('base64url'),thumbprint=escalationDigest(Buffer.from(spki,'base64url')),subject=randomUUID(),requestId=randomUUID(),challenge=randomBytes(32).toString('base64url'),payloadHash=escalationDigest('exact retained intent');let consumed=false,revoked=false;
 const proof={version:1,algorithm:'SHA256withECDSA',audience:'mercury-local',request_id:requestId,challenge,device_thumbprint:thumbprint,public_key_spki:spki,signature_der:''};
 const message=escalationProofMessage({audience:proof.audience,operation:'create',requestId,challenge,thumbprint,payloadHash});proof.signature_der=sign('sha256',Buffer.from(message),key.privateKey).toString('base64url');
 const client={query:async(sql,args)=>{
  if(sql.startsWith('SELECT device_id FROM'))return {rows:consumed?[]:[{device_id:'phone'}]};
  if(sql.includes('FROM mercury_guard.devices'))return {rows:[{device_id:'phone',thumbprint,public_key_spki:spki,revocation_version:1,active:true,revoked}]};
  if(sql.startsWith('SELECT request_id,nonce'))return {rows:consumed?[]:[{request_id:requestId,nonce:challenge,expires_at_ms:2000}]};
  if(sql.startsWith('DELETE FROM')){assert.equal(args[1],subject);consumed=true;return {rowCount:1};}
  throw Error('Unexpected SQL');
 }};
 return {key,client,proof,subject,payloadHash,message,revoke:()=>{revoked=true;}};
}
test('largest retained raw intent leaves room for its full signed HTTP envelope',()=>{
 const value=intent(),compact=JSON.stringify(value),raw=compact+' '.repeat(escalationMaxIntentBytes-Buffer.byteLength(compact)),prepared=prepareEscalationIntent(encode(raw)),fixture=proofFixture();
 const proof={...fixture.proof,signature_der:sign('sha256',Buffer.from(escalationProofMessage({audience:'mercury-local',operation:'create',requestId:fixture.proof.request_id,challenge:fixture.proof.challenge,thumbprint:fixture.proof.device_thumbprint,payloadHash:prepared.hash})),fixture.key.privateKey).toString('base64url')};
 const envelope=JSON.stringify({intent:encode(raw),proof});assert.ok(Buffer.byteLength(envelope)<=escalationMaxRequestBytes);assert.equal(Buffer.byteLength(prepared.raw),escalationMaxIntentBytes);
 const maximumFieldEnvelope=JSON.stringify({intent:encode(raw),proof:{...proof,audience:'a'.repeat(128),public_key_spki:'a'.repeat(342),signature_der:'a'.repeat(107)}});assert.ok(Buffer.byteLength(maximumFieldEnvelope)<=escalationMaxRequestBytes);assert.throws(()=>prepareEscalationIntent(encode(raw+' ')),EscalationInputError);
});
test('fresh escalation proof binds operation and exact intent hash; generic enrollment proof, alteration and replay fail',async()=>{
 const fixture=proofFixture(),authorize=createPostgresEscalationProofAuthorizer('mercury-local'),context={client:fixture.client,session:{subject:fixture.subject},operation:'create',payloadHash:fixture.payloadHash,proof:fixture.proof,now:1000};
 for(const patch of [{operation:'status'},{payloadHash:escalationDigest('altered intent')}])await assert.rejects(authorize({...context,...patch}),EscalationDeniedError);
 const generic=`mercury-enrollment-proof-v1\nmercury-local\n${fixture.proof.request_id}\n${fixture.proof.challenge}\n${fixture.proof.device_thumbprint}`;await assert.rejects(authorize({...context,proof:{...fixture.proof,signature_der:sign('sha256',Buffer.from(generic),fixture.key.privateKey).toString('base64url')}}),EscalationDeniedError);
 const result=await authorize(context);assert.equal(result.deviceId,'phone');assert.equal(result.thumbprint,fixture.proof.device_thumbprint);await assert.rejects(authorize(context),EscalationDeniedError);
});
test('escalation proof rejects expired or revoked device authority and foreign audience before consuming its nonce',async()=>{
 const fixture=proofFixture(),authorize=createPostgresEscalationProofAuthorizer('mercury-local'),context={client:fixture.client,session:{subject:fixture.subject},operation:'create',payloadHash:fixture.payloadHash,proof:fixture.proof,now:2000};await assert.rejects(authorize(context),EscalationDeniedError);fixture.revoke();await assert.rejects(authorize({...context,now:1000}),EscalationDeniedError);assert.throws(()=>prepareEscalationProof({...fixture.proof,audience:'other'},'mercury-local'),EscalationInputError);
});
