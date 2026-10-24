import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {DurableIngest} from './durable-ingest.mjs';import {createEvidenceHandler} from './evidence-handler.mjs';import {createAdminHandler} from './admin-handler.mjs';
import {PHOTO_CHUNK_BYTES as C,PHOTO_CHUNK_TTL_MS,photoHash,photoChunkSize,assemblePhotoChunks,evidenceChunkMessage} from './photo-chunks.mjs';
import {createDashboardMediaTransport,dashboardMediaReceipt,dashboardMediaChunkReceipt,dashboardMediaStatus,createDashboardMediaHandler} from './dashboard-media.mjs';
function fixture(size=C+7){
 const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),spki=keys.publicKey.export({type:'spki',format:'der'}).toString('base64url'),thumb=photoHash(Buffer.from(spki,'base64url'));const bytes=Buffer.alloc(size,17);bytes.set([255,216,255]);bytes.set([255,217],size-2);const id=randomUUID(),scope={guard_id:'g',site_id:'s',assignment_id:'a',device_thumbprint:thumb,revocation_version:1};
 const record={vendor_id:'v',scope,event:{event_id:id,at:100,kind:'photo_evidence',data:{capture_grant_id:'grant',evidence_id:randomUUID(),sha256:photoHash(bytes),bytes:size,width:1,height:1,capture:'camera_intent'}}},store=new DurableIngest(':memory:');store.db.prepare('INSERT INTO events(device,id,sequence,digest,body) VALUES(?,?,?,?,?)').run(scope.device_thumbprint,id,1,'synthetic',JSON.stringify(record));
 let active=true,subject='u',valid=true,revoked=false;const handler=createEvidenceHandler({store,now:()=>200,directory:{loadGuardsForSubject:s=>s==='u'?[{authSubject:'u',guardId:'g',vendorId:'v',active}]:[],loadVendor:()=>({vendorId:'v',kind:'company',active:true})},verifySession:async()=>valid?{subject,sessionId:'synthetic-session',active:true,expiresAt:100}:null,devices:{deviceByThumbprint:async()=>({publicKeySpki:spki}),authorizes:async()=>!revoked},grantIssuer:{lookup:async()=>revoked?null:{subject:'u',vendorId:'v',claims:{...scope,audience:'mercury-local',actions:['photo'],not_before_ms:50,expires_at_ms:150}}}});
 const proof=(index,digest,size)=>sign('sha256',Buffer.from(evidenceChunkMessage(record,record.event.data,index,digest,size,'mercury-local')),keys.privateKey).toString('base64url');
 const call=(suffix,data,type='application/octet-stream',digest=photoHash(data),signature=undefined)=>{if(signature===undefined&&suffix.startsWith('/chunks/'))try{signature=proof(Number(suffix.split('/').at(-1)),digest,data.length)}catch{signature='invalid'};return handler(new Request('https://guard.test/v1/evidence/'+id+suffix,{method:'POST',headers:{authorization:'Bearer synthetic-only','content-type':type,'x-mercury-chunk-sha256':digest,...(signature===null?{}:{'x-mercury-chunk-signature':signature??''})},body:data}));};
 return {bytes,record,store,handler,call,proof,chunk:i=>call('/chunks/'+i,bytes.subarray(i*C,(i+1)*C)),finalize:()=>call('/finalize',Buffer.from('{}'),'application/json'),invalidSession:()=>{valid=false},revoke:()=>{revoked=true},other:()=>{subject='other'},inactive:()=>{active=false}};
}
test('chunk plan bounds exact1MiB pieces including full20MiB without gaps',()=>{
 for(const size of [1,C,C+1,20*C]){const count=Math.ceil(size/C);assert.equal(Array.from({length:count},(_,i)=>photoChunkSize({bytes:size},i)).reduce((a,b)=>a+b),size);assert.throws(()=>photoChunkSize({bytes:size},count));}
 for(const [bytes,index] of [[0,0],[20*C+1,0],[1,-1],[1,0.5],[1,20]])assert.throws(()=>photoChunkSize({bytes},index));
});
test('same guard bearer cannot poison staging without the original phone chunk proof',async()=>{
 const f=fixture();try{
  const bytes=f.bytes.subarray(0,C),digest=photoHash(bytes),proof=f.proof(0,digest,C),other=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),otherProof=sign('sha256',Buffer.from(evidenceChunkMessage(f.record,f.record.event.data,0,digest,C,'mercury-local')),other.privateKey).toString('base64url');
  for(const signature of [null,'invalid',otherProof,f.proof(1,photoHash(f.bytes.subarray(C)),7),proof+'='])assert.equal((await f.call('/chunks/0',bytes,'application/octet-stream',digest,signature)).status,403);
  const changed=Buffer.from(bytes);changed[100]^=1;assert.equal((await f.call('/chunks/0',changed,'application/octet-stream',photoHash(changed),proof)).status,403);assert.equal(f.store.db.prepare('SELECT count(*) n FROM evidence_chunks').get().n,0);
  const first=await(await f.call('/chunks/0',bytes,'application/octet-stream',digest,proof)).json();assert.deepEqual(await(await f.call('/chunks/0',bytes,'application/octet-stream',digest,proof)).json(),first);assert.equal(f.store.db.prepare('SELECT count(*) n FROM evidence_chunks').get().n,1);
 }finally{f.store.close();}
});
test('20MiB HTTP fragments are durable, reorderable/idempotent and final-only receipt preserves raw original',async()=>{
 const f=fixture(20*C);try{
  for(let i=19;i>=0;i--){const response=await f.chunk(i);assert.equal(response.status,200);const receipt=await response.json();assert.equal(receipt.status,'evidence_chunk_retained');assert.equal(receipt.chunk_sha256,photoHash(f.bytes.subarray(i*C,(i+1)*C)));}
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM media').get().n,0);assert.equal((await f.chunk(2)).status,200);assert.equal(f.store.db.prepare('SELECT count(*) n FROM evidence_chunks').get().n,20);
  const response=await f.finalize();assert.equal(response.status,200);const receipt=await response.json();assert.equal(receipt.status,'evidence_accepted_local_only');assert.equal(receipt.sha256,photoHash(f.bytes));assert.deepEqual(Buffer.from(f.store.db.prepare('SELECT bytes FROM media').get().bytes),f.bytes);assert.equal(f.store.db.prepare('SELECT count(*) n FROM evidence_chunks').get().n,0);
  assert.deepEqual(await(await f.finalize()).json(),receipt);assert.deepEqual(await(await f.call('',f.bytes,'image/jpeg')).json(),receipt);assert.equal((await f.chunk(0)).status,200);assert.equal(f.store.db.prepare('SELECT count(*) n FROM evidence_chunks').get().n,0);
  f.revoke();assert.equal((await f.finalize()).status,403);assert.equal((await f.chunk(0)).status,403);
 }finally{f.store.close();}
});
test('incomplete/conflicting fragments never become accepted media or overwrite originals',async()=>{
 const f=fixture();try{
  assert.equal((await f.call('/chunks/0',f.bytes.subarray(0,C),'application/octet-stream','b'.repeat(64))).status,400);assert.equal(f.store.db.prepare('SELECT count(*) n FROM evidence_chunks').get().n,0);
  assert.equal((await f.chunk(0)).status,200);assert.equal((await f.finalize()).status,400);assert.equal(f.store.db.prepare('SELECT count(*) n FROM evidence_chunks').get().n,1);
  const changed=Buffer.from(f.bytes.subarray(0,C));changed[8]^=1;assert.equal((await f.call('/chunks/0',changed)).status,400);assert.equal(f.store.db.prepare('SELECT count(*) n FROM media').get().n,0);
  assert.equal((await f.call('/chunks/20',Buffer.from('x'))).status,400);assert.equal((await f.call('/chunks/00',Buffer.from('x'))).status,404);assert.equal((await f.call('/chunks/0',Buffer.alloc(C+1),'application/octet-stream',photoHash(Buffer.alloc(C+1)),f.proof(0,photoHash(Buffer.alloc(C+1)),C))).status,413);assert.equal((await f.call('/finalize',Buffer.from('{"replace":true}'),'application/json')).status,400);
  f.other();assert.equal((await f.chunk(1)).status,403);assert.equal(f.store.db.prepare('SELECT count(*) n FROM evidence_chunks').get().n,1);
 }finally{f.store.close();}
});
test('session loss during upload and expired fragments fail closed while retained media survives cleanup',async()=>{
 const f=fixture();try{
  let pulls=0;const stream=new ReadableStream({pull(c){if(pulls++===0)c.enqueue(f.bytes.subarray(0,C));else{f.invalidSession();c.close();}}});
  const response=await f.handler(new Request('https://guard.test/v1/evidence/'+f.record.event.event_id+'/chunks/0',{method:'POST',headers:{authorization:'Bearer synthetic-only','content-type':'application/octet-stream','x-mercury-chunk-sha256':photoHash(f.bytes.subarray(0,C)),'x-mercury-chunk-signature':f.proof(0,photoHash(f.bytes.subarray(0,C)),C)},body:stream,duplex:'half'}));assert.equal(response.status,403);assert.equal(f.store.db.prepare('SELECT count(*) n FROM evidence_chunks').get().n,0);
  f.store.retainPhotoChunk(f.record,0,f.bytes.subarray(0,C),1000);assert.throws(()=>f.store.finalizePhotoChunks(f.record,1000+PHOTO_CHUNK_TTL_MS+1));assert.equal(f.store.cleanupPhotoChunks(1000+PHOTO_CHUNK_TTL_MS+1,1),1);
  f.store.retainPhoto(f.record,f.bytes,1001);assert.equal(f.store.cleanupPhotoChunks(9999999999999,40),0);assert.deepEqual(Buffer.from(f.store.db.prepare('SELECT bytes FROM media').get().bytes),f.bytes);
 }finally{f.store.close();}
});
test('protected ranges return exactboundedpieces with original hash and repeat current authorization',async()=>{
 const bytes=Buffer.alloc(C+7,5),id='a'.repeat(64),sha=photoHash(bytes);let allowed=true,valid=true,reads=0;
 const handler=createAdminHandler({now:()=>1000,verifySession:async()=>valid?{subject:'admin',active:true,expiresAt:1000}:null,admin:{member:async()=>allowed,media:async()=>{reads++;return {bytes,sha256:sha}}}});
 const call=range=>handler(new Request('https://guard.test/v1/admin/media/'+id,{headers:{authorization:'Bearer synthetic-only',...(range?{range}:{})}}));
 let response=await call('bytes=0-1048575');assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 0-1048575/1048583');assert.equal(response.headers.get('etag'),'"'+sha+'"');assert.equal((await response.arrayBuffer()).byteLength,C);response=await call('bytes=1048576-1048582');assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,7);
 for(const range of ['bytes=0-1048576','bytes=0-','bytes=-2','bytes=1-0','bytes=0-0,2-3','bytes=00-1','bytes=1048583-1048583'])assert.equal((await call(range)).status,416);
 const before=reads;allowed=false;assert.equal((await call('bytes=0-1')).status,403);assert.equal(reads,before);allowed=true;valid=false;assert.equal((await call('bytes=0-1')).status,401);
});
test('dashboard large-media sender and receiver exchange bounded chunks before original final receipt',async()=>{
 const f=fixture(2*C+7),meta={...f.record.event.data,delivery_id:'c'.repeat(64),destination:'isolated',event_id:f.record.event.event_id},value={version:1,source:'mercury_one',delivery_id:meta.delivery_id,destination:meta.destination,observation:{event_id:meta.event_id,kind:'photo_evidence',data:f.record.event.data}},raw=JSON.stringify(value),job={id:meta.delivery_id,body:raw,hash:photoHash(raw),bytes:f.bytes},chunks=new Map(),receipt=dashboardMediaReceipt(value),token='synthetic-receiver-only-'.repeat(3);let finalized=false;
 try{
  const handler=createDashboardMediaHandler({token,destination:meta.destination,inbox:{mediaMetadata:async()=>meta,mediaStatus:async()=>dashboardMediaStatus(meta,[...chunks.values()],finalized?receipt:null),acceptMedia:async()=>{throw Error('Raw large upload forbidden')},acceptMediaChunk:async(_id,_destination,i,bytes)=>{chunks.set(i,{chunk_index:i,sha256:photoHash(bytes),bytes});return dashboardMediaChunkReceipt(meta,i,bytes)},finalizeMediaChunks:async()=>{assert.deepEqual(assemblePhotoChunks(meta,[...chunks.values()]),f.bytes);finalized=true;return receipt}}});
  const calls=[],transport=createDashboardMediaTransport({endpoint:'https://inbox.test/v1/mercury-one/media',token,fetchImpl:async(url,options)=>{assert(options.body.length<=C);calls.push(url);return handler(new Request(url,options))}});assert.deepEqual({...await transport(job)},receipt);assert.equal(finalized,true);assert.equal(calls.length,5);assert(calls.at(-1).endsWith('/finalize'));
  const bad=createDashboardMediaTransport({endpoint:'https://inbox.test/v1/mercury-one/media',token,fetchImpl:async()=>Response.json({...dashboardMediaChunkReceipt(meta,0,f.bytes.subarray(0,C)),chunk_sha256:'f'.repeat(64)})});await assert.rejects(bad(job),/progress mismatch/);
 }finally{f.store.close();}
});
test('interrupted dashboard transfer resumes only matching verified pieces and expired progress restarts original',async()=>{
 const f=fixture(2*C+7),meta={...f.record.event.data,delivery_id:'d'.repeat(64),destination:'isolated',event_id:f.record.event.event_id},value={version:1,source:'mercury_one',delivery_id:meta.delivery_id,destination:meta.destination,observation:{event_id:meta.event_id,kind:'photo_evidence',data:f.record.event.data}},body=JSON.stringify(value),job={id:meta.delivery_id,body,hash:photoHash(body),bytes:f.bytes},chunks=new Map(),receipt=dashboardMediaReceipt(value),token='synthetic-receiver-only-'.repeat(3);let fail=true,finalized=false,wrongProgress=false;const calls=[];
 try{
  const handler=createDashboardMediaHandler({token,destination:meta.destination,inbox:{mediaMetadata:async()=>meta,mediaStatus:async()=>{const status=dashboardMediaStatus(meta,[...chunks.values()],finalized?receipt:null);if(wrongProgress&&status.chunks.length)status.chunks[0].sha256='f'.repeat(64);return status},acceptMedia:async()=>{throw Error('No raw upload')},acceptMediaChunk:async(_id,_d,index,bytes)=>{chunks.set(index,{chunk_index:index,sha256:photoHash(bytes),bytes});return dashboardMediaChunkReceipt(meta,index,bytes)},finalizeMediaChunks:async()=>{assert.deepEqual(assemblePhotoChunks(meta,[...chunks.values()].sort((a,b)=>a.chunk_index-b.chunk_index)),f.bytes);finalized=true;return receipt}}});
  const send=()=>createDashboardMediaTransport({endpoint:'https://inbox.test/v1/mercury-one/media',token,fetchImpl:async(url,options)=>{calls.push(url);const response=await handler(new Request(url,options));if(fail&&url.endsWith('/chunks/1'))throw Error('Synthetic worker budget exhausted after commit');return response}})(job);
  await assert.rejects(send(),/budget/);assert.equal(chunks.size,2);assert.equal(finalized,false);fail=false;calls.length=0;assert.deepEqual({...await send()},receipt);assert.equal(calls.length,3);assert(!calls.some(url=>url.endsWith('/chunks/0')||url.endsWith('/chunks/1')));
  calls.length=0;assert.deepEqual({...await send()},receipt);assert.equal(calls.length,1); // Only a validated final receipt can skip finalization.
  finalized=false;chunks.clear();calls.length=0;assert.deepEqual({...await send()},receipt);assert.equal(calls.filter(url=>url.includes('/chunks/')).length,3); // Expired staging never loses the original bytes.
  finalized=false;wrongProgress=true;calls.length=0;assert.deepEqual({...await send()},receipt);assert(calls.some(url=>url.endsWith('/chunks/0'))); // A mismatched progress hash is never trusted.
 }finally{f.store.close();}
});
