import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {verifyScopedBatch} from './verify-batch.mjs';

// Test double only: no listener, real identities, cloud API, production adapter or durable storage.
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
function fixture() {
 const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const spki=publicKey.export({type:'spki',format:'der'});
 const thumbprint=createHash('sha256').update(spki).digest('hex');
 const scope={guard_id:'synthetic-guard',site_id:'synthetic-site',assignment_id:'synthetic-shift',device_thumbprint:thumbprint,revocation_version:1};
 const ctx={enrolled:true,revoked:false,audience:'mercury-local',thumbprint,publicKeySpki:spki.toString('base64url'),
  guardId:scope.guard_id,siteId:scope.site_id,assignmentId:scope.assignment_id,revocationVersion:1,
  notBefore:1000,expiresAt:1900,allowedKinds:['check_in','incident']};
 const event=(sequence,kind='check_in')=>({event_id:randomUUID(),sequence,at:1000000,kind,data:{note:'synthetic only'}});
 const batch=events=>({batch_id:randomUUID(),schema_version:2,scope:{...scope},events});
 function proof(b) {
  const payload=Buffer.from(JSON.stringify(b)).toString('base64url');
  return JSON.stringify({version:2,algorithm:'SHA256withECDSA',audience:ctx.audience,device_thumbprint:thumbprint,
   public_key_spki:ctx.publicKeySpki,payload,signature_der:sign('sha256',Buffer.from(`mercury-event-batch-v2\n${ctx.audience}\n${thumbprint}\n${payload}`),privateKey).toString('base64url')});
 }
 let events=new Map(), batches=new Map(), sequence=0;
 function ingest(raw,context=ctx) {
  const verified=verifyScopedBatch(raw,context,1100),b=verified.batch;
  const old=batches.get(b.batch_id);
  if(old){assert.equal(old.hash,verified.payloadHash);return structuredClone(old.receipt);}
  const staged=new Map(events);let next=sequence;
  for(const e of b.events){
   const prior=staged.get(e.event_id);
   if(prior){assert.equal(prior,hash(e));continue;}
   assert.ok(e.sequence>next,'Sequence reuse or rollback');
   staged.set(e.event_id,hash(e));next=e.sequence;
  }
  const receipt={batch_id:b.batch_id,event_ids:b.events.map(e=>e.event_id)};
  events=staged;sequence=next;batches.set(b.batch_id,{hash:verified.payloadHash,receipt});
  return structuredClone(receipt);
 }
 function receive(context=ctx){
  assert.deepEqual(context,ctx,'Synthetic authorization context mismatch');
  return {schema_version:1,scope:{...scope},previous_cursor:'',next_cursor:'local-cursor-1',changes:[
   {id:randomUUID(),version:1,type:'assignment',deleted:false,data:{label:'Synthetic test shift'}},
   {id:randomUUID(),version:1,type:'dispatch',deleted:false,data:{message:'Synthetic dispatch'}}]};
 }
 return {ctx,scope,event,batch,proof,ingest,receive,count:()=>events.size};
}
test('local synthetic round trip: receive shift/dispatch, queue offline, send check-in/incident, lose receipt and retry',()=>{
 const f=fixture(),page=f.receive();assert.equal(page.changes.length,2);
 const pending=[f.event(1),f.event(2,'incident')],b=f.batch(pending),raw=f.proof(b);
 const first=f.ingest(raw);assert.equal(f.count(),2);assert.equal(pending.length,2,'lost receipt keeps client pending');
 const retry=f.ingest(raw);assert.deepEqual(retry,first);assert.equal(f.count(),2);
 const remaining=pending.filter(e=>!retry.event_ids.includes(e.event_id));assert.equal(remaining.length,0);
});
test('signed original scope cannot be reassigned to a later shift or another site/guard/revocation',()=>{
 const f=fixture(),raw=f.proof(f.batch([f.event(1)]));
 for(const patch of [{assignmentId:'later'},{siteId:'other'},{guardId:'other'},{revocationVersion:2}])assert.throws(()=>f.ingest(raw,{...f.ctx,...patch}));
 assert.equal(f.count(),0);
});
test('new batch retry deduplicates event IDs, changed IDs/content and reused batch IDs fail',()=>{
 const f=fixture(),e=f.event(1),b=f.batch([e]);f.ingest(f.proof(b));
 f.ingest(f.proof(f.batch([e])));assert.equal(f.count(),1);
 assert.throws(()=>f.ingest(f.proof(f.batch([{...e,data:{note:'altered'}}]))));
 assert.throws(()=>f.ingest(f.proof({...b,events:[f.event(2)]})));
 assert.equal(f.count(),1);
});
test('late conflict rolls back entire synthetic transaction; failed receipt clears nothing',()=>{
 const f=fixture(),original=f.event(1);f.ingest(f.proof(f.batch([original])));
 const next=f.event(2),conflict={...original,sequence:3};
 assert.throws(()=>f.ingest(f.proof(f.batch([next,conflict]))));assert.equal(f.count(),1);
 assert.equal(f.ingest(f.proof(f.batch([next]))).event_ids.length,1);assert.equal(f.count(),2);
});
test('v1/unscoped signature and unknown scope fields are not accepted as v2',()=>{
 const f=fixture(),b=f.batch([f.event(1)]);delete b.scope;assert.throws(()=>f.ingest(f.proof(b)));
 b.scope={...f.scope,extra:true};assert.throws(()=>f.ingest(f.proof(b)));
 assert.throws(()=>f.receive({...f.ctx,siteId:'other'}));assert.equal(f.count(),0);
});
