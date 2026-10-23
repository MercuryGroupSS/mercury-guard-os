import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableIngest} from './durable-ingest.mjs';
import {createIngestHandler} from './ingest-handler.mjs';
import {createAuthorization} from './authorization.mjs';
import {DatabaseSync} from 'node:sqlite';
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
 const authenticate=createAuthorization({verifySession:async token=>token==='local-test-only'?{subject:'synthetic-subject',active:true,expiresAt:1900}:null,loadAuthorization:async()=>({...f.ctx,subject:'synthetic-subject',active:true}),audience:f.ctx.audience,now:()=>1100});
 const makeHandler=()=>createIngestHandler({authenticate,store:db,now:()=>1100});
 const req=token=>new Request('http://localhost/v2/batches',{method:'POST',headers:{'content-type':'application/json',authorization:token},body:raw});
 try {
  assert.equal((await makeHandler()(req('Bearer wrong'))).status,401); assert.equal(db.count(),0);
  const first=await makeHandler()(req('Bearer local-test-only')); assert.equal(first.status,200); const receipt=await first.json();
  db.close(); db=new DurableIngest(path);
  const retry=await makeHandler()(req('Bearer local-test-only')); assert.deepEqual(await retry.json(),receipt); assert.equal(db.count(),2);
  f.ctx.revoked=true; assert.equal((await makeHandler()(req('Bearer local-test-only'))).status,401);
 } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});

test('grant-authorized out-of-order delivery retains uniqueness and rejects sequence reuse',()=>{
 const f=fixture(),db=new DurableIngest(':memory:'),ctx={...f.ctx,allowHistoricalSequence:true,vendorId:'vendor'};
 try{
  const second=f.event(2,'incident'),first=f.event(1,'incident');
  db.ingest(f.proof(f.batch([second])),ctx,1100);
  db.ingest(f.proof(f.batch([first])),ctx,1100);assert.equal(db.count(),2);
  db.ingest(f.proof(f.batch([first])),ctx,1100);assert.equal(db.count(),2);
  assert.throws(()=>db.ingest(f.proof(f.batch([f.event(1,'incident')])),ctx,1100));
  assert.throws(()=>db.ingest(f.proof(f.batch([{...first,data:{note:'changed'}}])),ctx,1100));
  assert.equal(db.count(),2);
 }finally{db.close();}
});
test('checkpoint ledger upgrade preserves legacy entries while distinct rounds survive restart and reject duplicates',()=>{
 const directory=mkdtempSync(join(tmpdir(),'mercury-round-ledger-')),path=join(directory,'events.sqlite'),legacy=new DatabaseSync(path);
 legacy.exec('CREATE TABLE checkpoints(guard TEXT,assignment TEXT,route TEXT,revision INTEGER,checkpoint TEXT,event_id TEXT,PRIMARY KEY(guard,assignment,route,revision,checkpoint))');legacy.prepare('INSERT INTO checkpoints VALUES(?,?,?,?,?,?)').run('old-guard','old-assignment','old-route',1,'entrance','old-event');legacy.close();
 const f=fixture(),context={...f.ctx,allowedKinds:['patrol_checkpoint'],allowHistoricalSequence:true,vendorId:'company'},event=round=>({...f.event(round==='opening'?1:2,'patrol_checkpoint'),data:{route_id:'route',route_revision:2,checkpoint_id:'entrance',round_id:round}}),first=f.batch([event('opening')]),second=f.batch([event('closing')]);let store=new DurableIngest(path);
 try{
  assert.equal(store.db.prepare('SELECT round FROM checkpoints WHERE guard=?').get('old-guard').round,'');const receipt=store.ingest(f.proof(first),context,1100);store.ingest(f.proof(second),context,1100);store.close();store=new DurableIngest(path);assert.deepEqual(store.ingest(f.proof(first),context,1100),receipt);
  const duplicate=f.batch([{...event('opening'),sequence:3}]);assert.throws(()=>store.ingest(f.proof(duplicate),context,1100));assert.equal(store.count(),2);assert.equal(store.db.prepare('SELECT count(*) n FROM checkpoints').get().n,3);assert.deepEqual(store.db.prepare('SELECT round FROM checkpoints WHERE guard=? ORDER BY round').all(context.guardId).map(row=>row.round),['closing','opening']);
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
