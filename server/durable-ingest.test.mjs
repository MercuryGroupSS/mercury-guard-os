import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableIngest} from './durable-ingest.mjs';
import {createIngestHandler} from './ingest-handler.mjs';
function fixture(){
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
 return {ctx,event,batch,proof};
}

test('receipt and event survive close/reopen and lost receipt retry',()=>{
 const dir=mkdtempSync(join(tmpdir(),'mercury-ingest-')), path=join(dir,'test.sqlite');
 const f=fixture(), raw=f.proof(f.batch([f.event(1)])); let db=new DurableIngest(path);
 try { const receipt=db.ingest(raw,f.ctx,1100); db.close(); db=new DurableIngest(path);
 assert.deepEqual(db.ingest(raw,f.ctx,1100),receipt); assert.equal(db.count(),1);
 assert.throws(()=>db.ingest(raw,{...f.ctx,revoked:true},1100));
 assert.throws(()=>db.ingest(raw,f.ctx,2000));
 } finally { db.close(); rmSync(dir,{recursive:true,force:true}); }
});
test('late conflict rolls back rows and sequence; retry retains original scope',()=>{
 const f=fixture(),db=new DurableIngest(':memory:');
 try { const first=f.event(1); db.ingest(f.proof(f.batch([first])),f.ctx,1100);
 const next=f.event(2);
 assert.throws(()=>db.ingest(f.proof(f.batch([next,{...first,sequence:3}])),f.ctx,1100));
 assert.equal(db.count(),1); db.ingest(f.proof(f.batch([next])),f.ctx,1100); assert.equal(db.count(),2);
 db.ingest(f.proof(f.batch([first])),f.ctx,1100); assert.equal(db.count(),2);
 assert.throws(()=>db.ingest(f.proof(f.batch([f.event(2)])),f.ctx,1100));
 const changed=f.batch([first]); changed.scope.assignment_id='different';
 assert.throws(()=>db.ingest(f.proof(changed),{...f.ctx,assignmentId:'different'},1100));
 } finally {db.close();}
});

test('signed batch passes HTTP boundary into durable store and receipt survives restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mercury-http-')),path=join(dir,'test.sqlite');
 const f=fixture(); let db=new DurableIngest(path);
 const raw=f.proof(f.batch([f.event(1),f.event(2,'incident')]));
 const makeHandler=()=>createIngestHandler({authenticate:async header=>header==='Bearer local-test-only'?f.ctx:null,store:db,now:()=>1100});
 const req=token=>new Request('http://localhost/v2/batches',{method:'POST',headers:{'content-type':'application/json',authorization:token},body:raw});
 try {
  assert.equal((await makeHandler()(req('Bearer wrong'))).status,401); assert.equal(db.count(),0);
  const first=await makeHandler()(req('Bearer local-test-only')); assert.equal(first.status,200); const receipt=await first.json();
  db.close(); db=new DurableIngest(path);
  const retry=await makeHandler()(req('Bearer local-test-only')); assert.deepEqual(await retry.json(),receipt); assert.equal(db.count(),2);
  f.ctx.revoked=true; assert.equal((await makeHandler()(req('Bearer local-test-only'))).status,400);
 } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});
