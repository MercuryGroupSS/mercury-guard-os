import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {DurableIngest} from './durable-ingest.mjs';
import {createEvidenceHandler} from './evidence-handler.mjs';
import {photoMetadata} from './photo-metadata.mjs';
function fixture(){
 const bytes=Buffer.from([255,216,255,217]);const eventId=randomUUID();
 const scope={guard_id:'g',site_id:'s',assignment_id:'a',device_thumbprint:'a'.repeat(64),revocation_version:1};
 const record={vendor_id:'v',scope,event:{event_id:eventId,at:100,kind:'photo_evidence',data:{capture_grant_id:'grant',evidence_id:randomUUID(),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,width:1,height:1,capture:'camera_intent'}}};
 const store=new DurableIngest(':memory:');store.db.prepare('INSERT INTO events(device,id,sequence,digest,body) VALUES(?,?,?,?,?)').run(scope.device_thumbprint,eventId,1,'synthetic-record',JSON.stringify(record));
 let active=true,revoked=false,subject='u';
 const directory={loadGuardsForSubject:s=>s==='u'?[{authSubject:'u',guardId:'g',vendorId:'v',active}]:[],loadVendor:()=>({vendorId:'v',kind:'company',active:true})};
 const handler=createEvidenceHandler({directory,store,now:()=>200,verifySession:async()=>({subject,active:true,expiresAt:100}),devices:{deviceByThumbprint:async()=>({publicKeySpki:'key'}),authorizes:async()=>!revoked},grantIssuer:{lookup:()=>revoked?null:{subject:'u',vendorId:'v',claims:{...scope,actions:['photo'],not_before_ms:50,expires_at_ms:150}}}});
 const send=(data=bytes,id=eventId)=>handler(new Request('https://guard.test/v1/evidence/'+id,{method:'POST',headers:{authorization:'Bearer token','content-type':'image/jpeg'},body:data}));
 return {store,record,bytes,send,setActive:x=>{active=x},revoke:()=>{revoked=true},other:()=>{subject='other'}};
}
test('matching evidence has idempotent receipt and one retained blob',async()=>{
 const f=fixture();try{
  const first=await f.send();assert.equal(first.status,200);const receipt=await first.json();assert.equal(receipt.status,'evidence_accepted_local_only');
  assert.deepEqual(await (await f.send()).json(),receipt);assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM media').get().n,1);
  f.revoke();assert.equal((await f.send()).status,403);
 }finally{f.store.close();}
});
test('wrong hash, missing metadata, oversized body and another guard cannot upload',async()=>{
 const f=fixture();try{
  assert.equal((await f.send(Buffer.from('xxxx'))).status,400);
  assert.equal((await f.send(Buffer.alloc(5))).status,413);
  assert.equal((await f.send(f.bytes,randomUUID())).status,403);
  f.other();assert.equal((await f.send()).status,403);assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM media').get().n,0);
 }finally{f.store.close();}
});
test('photo metadata rejects invalid dimensions, sizes and identifiers',()=>{
 const f=fixture();try{
  assert.equal(photoMetadata(f.record.event.data).bytes,4);
  for(const patch of [{evidence_id:'../escape'},{bytes:0},{bytes:20971521},{width:100000000},{sha256:'bad'}])assert.throws(()=>photoMetadata({...f.record.event.data,...patch}));
 }finally{f.store.close();}
});
