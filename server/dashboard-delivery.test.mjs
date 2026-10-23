import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {DashboardOutbox,createDashboardTransport,deliverDashboardOnce,projectDashboardObservation} from './dashboard-delivery.mjs';
import {DashboardInbox,createDashboardInboxHandler} from './dashboard-inbox.mjs';
const token='synthetic-integration-token-'.repeat(3);
function fixture(){return {record:{vendor_id:'vendor',scope:{guard_id:'guard',site_id:'site',assignment_id:'assignment',device_thumbprint:'a'.repeat(64)},event:{event_id:randomUUID(),at:10000,kind:'incident',data:{description:'Synthetic test report',capture_grant_id:'private-grant',unapproved:'must not transfer'}}},mapping:{active:true,revision:1,destination:'local-dashboard-test',dashboardShiftId:'homebase-shift',guardId:'guard',vendorId:'vendor',siteId:'site',assignmentId:'assignment'}};}
test('projection requires explicit identity mappings and excludes unrelated source fields',()=>{
 const {record,mapping}=fixture(),p=projectDashboardObservation(record,mapping);
 assert.equal(p.dashboard_shift_id,'homebase-shift');assert.deepEqual(p.observation.data,{description:'Synthetic test report'});assert.equal(p.source,'mercury_one');
 for(const patch of [{active:false},{guardId:'other'},{vendorId:'other'},{siteId:'other'},{assignmentId:'other'}])assert.throws(()=>projectDashboardObservation(record,{...mapping,...patch}));
 assert.throws(()=>projectDashboardObservation({...record,event:{...record.event,kind:'clock_out'}},mapping));
});
test('outbox survives restart and rejects remapping; a stale lease cannot clear a newer attempt',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dashboard-outbox-')),path=join(dir,'outbox.db');let box=new DashboardOutbox(path);
 try{
  const {record,mapping}=fixture(),id=box.enqueue(record,mapping);assert.equal(box.enqueue(record,mapping),id);
  assert.throws(()=>box.enqueue(record,{...mapping,dashboardShiftId:'other'}));const first=box.claim(1000);assert.equal(box.claim(1001),null);
  box.close();box=new DashboardOutbox(path);const next=box.claim(121000);assert.equal(next.id,id);assert.notEqual(next.lease,first.lease);
  const receipt={delivery_id:id,destination:mapping.destination,payload_sha256:first.hash,status:'stored_in_integration_inbox'};
  assert.throws(()=>box.accepted(first,receipt));box.accepted(next,receipt);assert.equal(box.claim(200000),null);
 }finally{box.close();rmSync(dir,{recursive:true,force:true});}
});
test('false or mismatched receipts and network errors leave delivery pending with backoff',async()=>{
 const {record,mapping}=fixture(),box=new DashboardOutbox(':memory:');try{
  box.enqueue(record,mapping);let now=1000;
  assert.equal(await deliverDashboardOnce(box,async()=>({status:'ok'}),()=>now),'pending');
  assert.equal(box.db.prepare('SELECT status FROM dashboard_outbox').get().status,'pending');assert.equal(box.claim(1001),null);
  now=10000;assert.equal(await deliverDashboardOnce(box,async()=>{throw Error('offline')},()=>now),'pending');
 }finally{box.close();}
});
test('inbox authenticates dedicated credentials, rejects unknown mapping and detects altered retries',async()=>{
 const {record,mapping}=fixture(),box=new DashboardOutbox(':memory:'),inbox=new DashboardInbox(':memory:');let approved=true;
 try{
  box.enqueue(record,mapping);const job=box.claim(1000);
  const handler=createDashboardInboxHandler({token,destination:mapping.destination,inbox,loadMapping:async()=>approved?mapping:null});
  const req=(body=job.body,auth=token)=>new Request('https://example.test/v1/mercury-one/observations',{method:'POST',headers:{authorization:`Bearer ${auth}`,'content-type':'application/json'},body});
  assert.equal((await handler(req(job.body,'wrong'))).status,401);approved=false;assert.equal((await handler(req())).status,403);approved=true;
  assert.equal((await handler(req())).status,200);assert.equal((await handler(req())).status,200);
  const altered=JSON.parse(job.body);altered.observation.data.description='changed';assert.equal((await handler(req(JSON.stringify(altered)))).status,400);
  assert.equal(inbox.db.prepare('SELECT count(*) AS n FROM mercury_one_inbox').get().n,1);
  approved=false;assert.equal((await handler(req())).status,403);
 }finally{box.close();inbox.close();}
});
test('inbox awaits asynchronous commit and never acknowledges a failed write',async()=>{
 const {record,mapping}=fixture(),body=JSON.stringify(projectDashboardObservation(record,mapping));let finish,entered;
 const started=new Promise(resolve=>{entered=resolve;}),committed=new Promise(resolve=>{finish=resolve;});
 const receipt={delivery_id:JSON.parse(body).delivery_id,destination:mapping.destination,payload_sha256:'a'.repeat(64),status:'stored_in_integration_inbox'};
 const req=()=>new Request('https://example.test/v1/mercury-one/observations',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body});
 let returned=false;const handler=createDashboardInboxHandler({token,destination:mapping.destination,loadMapping:async()=>mapping,inbox:{accept:async()=>{entered();await committed;return receipt;}}});
 const pending=handler(req()).then(r=>{returned=true;return r;});await started;assert.equal(returned,false);finish();const result=await pending;assert.equal(result.status,200);assert.deepEqual(await result.json(),receipt);
 const failing=createDashboardInboxHandler({token,destination:mapping.destination,loadMapping:async()=>mapping,inbox:{accept:async()=>{throw Error('Commit failed');}}});
 const failed=await failing(req());assert.equal(failed.status,400);assert.deepEqual(await failed.json(),{error:'observation_rejected'});
});
test('transport rejects insecure endpoints, redirects and oversized receipts',async()=>{
 for(const endpoint of ['http://example.test/v1/mercury-one/observations','https://user:pass@example.test/path','https://example.test/path?token=x'])assert.throws(()=>createDashboardTransport({endpoint,token}));
 const {record,mapping}=fixture(),box=new DashboardOutbox(':memory:');try{
  box.enqueue(record,mapping);const job=box.claim(1000);
  for(const response of [new Response('',{status:302,headers:{location:'https://elsewhere.test'}}),new Response('x'.repeat(4097))])await assert.rejects(createDashboardTransport({endpoint:'https://example.test/v1/mercury-one/observations',token,fetchImpl:async(url,options)=>{assert.equal(options.redirect,'manual');return response;}})(job));
 }finally{box.close();}
});
test('real local HTTP delivery obtains a persisted inbox receipt without modifying other applications',async()=>{
 const {record,mapping}=fixture(),box=new DashboardOutbox(':memory:'),inbox=new DashboardInbox(':memory:');
 const handler=createDashboardInboxHandler({token,destination:mapping.destination,inbox,loadMapping:async()=>mapping});
 const server=createServer(async(req,res)=>{const result=await handler(new Request(`http://127.0.0.1${req.url}`,{method:req.method,headers:req.headers,body:Readable.toWeb(req),duplex:'half'}));res.writeHead(result.status,Object.fromEntries(result.headers));res.end(await result.text());});
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  box.enqueue(record,mapping);const send=createDashboardTransport({endpoint:`http://127.0.0.1:${server.address().port}/v1/mercury-one/observations`,token,allowLocal:true});
  assert.equal(await deliverDashboardOnce(box,send),'delivered');assert.equal(await deliverDashboardOnce(box,send),'idle');
  assert.equal(inbox.db.prepare('SELECT count(*) AS n FROM mercury_one_inbox').get().n,1);
  assert.equal(box.db.prepare('SELECT status FROM dashboard_outbox').get().status,'delivered');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));box.close();inbox.close();}
});

test('lost response plus sender and receiver restart reuses the durable receipt without duplicate insert',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dashboard-restart-')),outPath=join(dir,'out.db'),inPath=join(dir,'in.db');
 let box=new DashboardOutbox(outPath),inbox=new DashboardInbox(inPath);const {record,mapping}=fixture();let firstReceipt;
 try{
  box.enqueue(record,mapping);
  assert.equal(await deliverDashboardOnce(box,async job=>{firstReceipt=inbox.accept(JSON.parse(job.body),job.body);throw Error('response lost after commit')},()=>1000),'pending');
  box.close();inbox.close();box=new DashboardOutbox(outPath);inbox=new DashboardInbox(inPath);
  assert.equal(await deliverDashboardOnce(box,async job=>{const r=inbox.accept(JSON.parse(job.body),job.body);assert.deepEqual(r,firstReceipt);return r},()=>10000),'delivered');
  box.close();box=new DashboardOutbox(outPath);
  assert.deepEqual(JSON.parse(box.db.prepare('SELECT receipt FROM dashboard_outbox').get().receipt),firstReceipt);
  assert.equal(inbox.db.prepare('SELECT count(*) AS n FROM mercury_one_inbox').get().n,1);
 }finally{box.close();inbox.close();rmSync(dir,{recursive:true,force:true});}
});
test('acknowledgement uses the saved immutable payload rather than a modified in-memory job',()=>{
 const box=new DashboardOutbox(':memory:'),{record,mapping}=fixture();try{
  box.enqueue(record,mapping);const job=box.claim(1000);
  const receipt={delivery_id:job.id,destination:mapping.destination,payload_sha256:'b'.repeat(64),status:'stored_in_integration_inbox'};
  assert.throws(()=>box.accepted({...job,hash:receipt.payload_sha256},receipt));
  assert.equal(box.db.prepare('SELECT status FROM dashboard_outbox').get().status,'pending');
  box.db.prepare('UPDATE dashboard_outbox SET body=?').run('{}');box.retry(job,1000);
  assert.throws(()=>box.claim(10000));
 }finally{box.close();}
});

test('acknowledgement projection carries only exact message ID and version',()=>{
 const {record,mapping}=fixture();record.event.kind='dispatch_ack';record.event.data={message_id:'instruction',message_version:2,capture_grant_id:'private',unapproved:'omit'};
 const projected=projectDashboardObservation(record,mapping);
 assert.deepEqual(projected.observation.data,{message_id:'instruction',message_version:2});
 for(const patch of [{message_version:'2'},{message_version:0},{message_id:''}])assert.throws(()=>projectDashboardObservation({...record,event:{...record.event,data:{...record.event.data,...patch}}},mapping));
});
test('patrol delivery preserves explicit round identity without rewriting legacy event projections',()=>{
 const {record,mapping}=fixture();record.event.kind='patrol_checkpoint';record.event.data={route_id:'route',route_revision:2,checkpoint_id:'entrance'};const legacy=projectDashboardObservation(record,mapping);assert.deepEqual(legacy.observation.data,record.event.data);
 record.event.data.round_id='opening';const round=projectDashboardObservation(record,mapping);assert.equal(round.delivery_id,legacy.delivery_id);assert.deepEqual(round.observation.data,{route_id:'route',route_revision:2,checkpoint_id:'entrance',round_id:'opening'});
 for(const round_id of ['',null,0,'bad/id'])assert.throws(()=>projectDashboardObservation({...record,event:{...record.event,data:{...record.event.data,round_id}}},mapping));
 const outbox=new DashboardOutbox(':memory:');try{outbox.enqueue({...record,event:{...record.event,data:legacy.observation.data}},mapping);assert.throws(()=>outbox.enqueue(record,mapping));assert.deepEqual(JSON.parse(outbox.claim(1000).body).observation.data,legacy.observation.data);}finally{outbox.close();}
});
