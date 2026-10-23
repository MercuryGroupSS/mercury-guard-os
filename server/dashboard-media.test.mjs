import {test} from 'node:test';import assert from 'node:assert/strict';import {createHash,randomUUID} from 'node:crypto';
import {projectDashboardObservation,validateProjectedDashboardObservation} from './dashboard-delivery.mjs';import {createDashboardMediaRouter} from './dashboard-router.mjs';import {createDashboardInboxHandler} from './dashboard-inbox.mjs';
import {createDashboardMediaHandler,createDashboardMediaTransport,dashboardMediaReceipt} from './dashboard-media.mjs';
const token='synthetic-private-media-credential-'.repeat(2),hash=x=>createHash('sha256').update(x).digest('hex');
function fixture(){const bytes=Buffer.from([255,216,255,217]),mapping={assignmentId:'assignment',guardId:'guard',vendorId:'vendor',siteId:'site',dashboardShiftId:'upstream',destination:'isolated',revision:1,active:true},value=projectDashboardObservation({vendor_id:'vendor',scope:{assignment_id:'assignment',guard_id:'guard',site_id:'site',device_thumbprint:'a'.repeat(64)},event:{event_id:randomUUID(),kind:'photo_evidence',at:1000,data:{evidence_id:randomUUID(),sha256:hash(bytes),bytes:bytes.length,width:1,height:1,capture:'camera_intent'}}},mapping),body=JSON.stringify(value);return {bytes,mapping,value,job:{id:value.delivery_id,hash:hash(body),body,bytes}};}
test('projected photo metadata is accepted without adding a local capture marker to the wire format',async()=>{
 const {mapping,value,job}=fixture();assert.equal(value.observation.data.capture,undefined);assert.doesNotThrow(()=>validateProjectedDashboardObservation(value,mapping));
 const handler=createDashboardInboxHandler({token,destination:mapping.destination,loadMapping:async()=>mapping,inbox:{accept:async()=>({stored:true})}});assert.equal((await handler(new Request('https://example.test/v1/mercury-one/observations',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:job.body}))).status,200);
 const changed=structuredClone(value);changed.observation.data.capture='camera_intent';assert.throws(()=>validateProjectedDashboardObservation(changed,mapping));
});
test('private media receiver authenticates, bounds uploads and awaits the separate byte receipt',async()=>{
 const {value,job,bytes}=fixture(),receipt=dashboardMediaReceipt(value);let accepted=0,finish,entered;
 const began=new Promise(resolve=>{entered=resolve;}),committed=new Promise(resolve=>{finish=resolve;});
 const handler=createDashboardMediaHandler({token,destination:'isolated',inbox:{mediaMetadata:async()=>value.observation.data,acceptMedia:async(id,destination,actual)=>{accepted++;assert.deepEqual(actual,bytes);entered();await committed;return receipt;}}});
 const req=(body=bytes,credential=token,type='image/jpeg')=>new Request('https://example.test/v1/mercury-one/media/'+job.id,{method:'POST',headers:{authorization:'Bearer '+credential,'content-type':type},body});
 assert.equal((await handler(req(bytes,'wrong'))).status,401);assert.equal((await handler(req(bytes,token,'application/json'))).status,415);assert.equal((await handler(req(Buffer.alloc(bytes.length+1)))).status,413);assert.equal(accepted,0);
 let returned=false;const pending=handler(req()).then(r=>{returned=true;return r;});await began;assert.equal(returned,false);finish();const result=await pending;assert.equal(result.status,200);assert.deepEqual(await result.json(),receipt);
 const failed=createDashboardMediaHandler({token,destination:'isolated',inbox:{mediaMetadata:async()=>value.observation.data,acceptMedia:async()=>{throw Error('Commit failed');}}});assert.equal((await failed(req())).status,400);
});
test('media routing verifies original bytes and selects the explicit destination before transmission',async()=>{
 const {job,value}=fixture(),calls=[],send=createDashboardMediaRouter({destinations:[{destination:'isolated',endpoint:'https://example.test/v1/mercury-one/observations',mediaEndpoint:'https://photos.example.test/v1/mercury-one/media',token}],fetchImpl:async(url,options)=>{calls.push({url:String(url),authorization:options.headers.authorization});assert.equal(options.redirect,'manual');assert.deepEqual(options.body,job.bytes);return new Response(JSON.stringify(dashboardMediaReceipt(value)));}});
 const receipt=await send(job);assert.equal(receipt.status,'media_stored_in_integration_inbox');assert.deepEqual(calls,[{url:'https://photos.example.test/v1/mercury-one/media/'+job.id,authorization:'Bearer '+token}]);
 await assert.rejects(send({...job,bytes:Buffer.from('changed')}));await assert.rejects(send({...job,hash:'0'.repeat(64)}));assert.equal(calls.length,1);
 assert.equal(createDashboardMediaRouter({destinations:[{destination:'isolated',endpoint:'https://example.test/path',token}]}),null);
 const other=createDashboardMediaRouter({destinations:[{destination:'other',endpoint:'https://other.example.test/path',mediaEndpoint:'https://other.example.test/media',token}],fetchImpl:async()=>{throw Error('Must not send');}});await assert.rejects(other(job),/not configured/);
});
test('media transport rejects redirects and false, oversized or mismatched receipts',async()=>{
 const {job,value}=fixture();assert.throws(()=>createDashboardMediaTransport({endpoint:'http://example.test/media',token}));
 for(const response of [new Response('',{status:302}),new Response('x'.repeat(4097)),new Response(JSON.stringify({...dashboardMediaReceipt(value),sha256:'0'.repeat(64)})),new Response(JSON.stringify({status:'ok'}))])await assert.rejects(createDashboardMediaTransport({endpoint:'https://example.test/media',token,fetchImpl:async()=>response})(job));
});
