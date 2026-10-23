import {ShiftLifecycle} from './shift-lifecycle.mjs';
import {DispatchFeed} from './dispatch-feed.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,randomUUID} from 'node:crypto';
import {LocalGuardDirectory} from './local-guard-directory.mjs';
import {LocalDeviceAssignments} from './local-device-assignments.mjs';
import {ShiftGrantIssuer} from './shift-grant-issuer.mjs';
import {DurableIngest} from './durable-ingest.mjs';
import {createGrantIngestHandler} from './grant-ingest-handler.mjs';
const rsa=generateKeyPairSync('rsa',{modulusLength:2048});
function setup(actions=['incident'],withLifecycle=false){
 const shiftLifecycle=withLifecycle?new ShiftLifecycle(':memory:'):null;
 const dispatch=new DispatchFeed(':memory:');
 const directory=new LocalGuardDirectory(':memory:'),devices=new LocalDeviceAssignments(':memory:'),store=new DurableIngest(':memory:');
 const issuer=new ShiftGrantIssuer({path:':memory:',privateKey:rsa.privateKey,keyId:'key',issuer:'mercury-local',audience:'mercury-local'});
 const ec=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),spki=ec.publicKey.export({type:'spki',format:'der'}).toString('base64url');
 directory.addVendor({vendorId:'v',kind:'company',active:true});directory.addGuard({guardId:'g',authSubject:'u',vendorId:'v',active:true});
 devices.enroll({deviceId:'d',mode:'site',siteId:'s',active:true,revoked:false,publicKeySpki:spki});
 devices.assign({assignmentId:'a',guardId:'g',vendorId:'v',siteId:'s',startsAt:1000,endsAt:100000,active:true});
 const device=devices.device('d'),identity={subject:'u',guardId:'g',vendorId:'v'};
 const issued=issuer.issue({identity,device,assignment:{assignmentId:'a',guardId:'g',vendorId:'v',deviceId:'d',siteId:'s',startsAt:1000,endsAt:100000,canStart:true},allowedActions:actions,sessionExpiresAt:100000,now:2000});
 const claims=JSON.parse(Buffer.from(issued.payload,'base64url'));
 let now=3000,subject='u';
 const handler=createGrantIngestHandler({directory,devices:new Proxy(devices,{get(target,key){const value=target[key];return typeof value==='function'?async(...args)=>value.apply(target,args):value;}}),store,dispatch,shiftLifecycle,grantIssuer:issuer,verifySession:async()=>({subject,active:true,expiresAt:200000}),now:()=>now});
 const batch={batch_id:randomUUID(),schema_version:2,scope:{guard_id:'g',site_id:'s',assignment_id:'a',device_thumbprint:device.thumbprint,revocation_version:1},events:[{event_id:randomUUID(),sequence:1,at:2000,kind:'incident',data:{capture_grant_id:claims.grant_id,note:'synthetic'}}]};
 const send=async b=>{
  const payload=Buffer.from(JSON.stringify(b)).toString('base64url'),signature=sign('sha256',Buffer.from(`mercury-event-batch-v2\nmercury-local\n${device.thumbprint}\n${payload}`),ec.privateKey).toString('base64url');
  return handler(new Request('https://example.test/v2/batches',{method:'POST',headers:{authorization:'Bearer token','content-type':'application/json'},body:JSON.stringify({version:2,algorithm:'SHA256withECDSA',audience:'mercury-local',device_thumbprint:device.thumbprint,public_key_spki:spki,payload,signature_der:signature})}));
 };
 return {shiftLifecycle,device,identity,dispatch,directory,devices,store,issuer,claims,batch,send,time:t=>{now=t},login:s=>{subject=s},close(){shiftLifecycle?.close();dispatch.close();directory.close();devices.close();store.close();issuer.close();}};
}
test('issued capture grant permits ingestion and retains original vendor attribution',async()=>{
 const f=setup();try{
  assert.equal((await f.send(f.batch)).status,200);assert.equal((await f.send(f.batch)).status,200);assert.equal(f.store.count(),1);
  assert.equal(JSON.parse(f.store.db.prepare('SELECT body FROM events').get().body).vendor_id,'v');
  f.issuer.revoke(f.claims.grant_id);assert.equal((await f.send(f.batch)).status,400);
 }finally{f.close();}
});
test('unknown grant, forbidden action and invalid capture time fail before writes',async()=>{
 const f=setup();try{
  for(const patch of [{data:{capture_grant_id:'made-up'}},{kind:'location'},{at:1000},{at:100000},{at:4000}]){
   const b=structuredClone(f.batch);Object.assign(b.events[0],patch);assert.equal((await f.send(b)).status,400);
  }
  assert.equal(f.store.count(),0);
 }finally{f.close();}
});
test('bounded post-shift uploads retain original scope but still honor cancellation and revocation',async()=>{
 const f=setup();try{
  f.time(200000);assert.equal((await f.send(f.batch)).status,200);
  f.devices.cancel('a');assert.equal((await f.send(f.batch)).status,400);
 }finally{f.close();}
 const old=setup();try{old.time(100000+86400001);assert.equal((await old.send(old.batch)).status,400);}finally{old.close();}
});
test('grant-validated batches accept late sequence gaps without losing deduplication',async()=>{
 const f=setup();try{
  const later=structuredClone(f.batch);later.batch_id=randomUUID();later.events[0].sequence=2;later.events[0].event_id=randomUUID();
  assert.equal((await f.send(later)).status,200);assert.equal((await f.send(f.batch)).status,200);assert.equal(f.store.count(),2);
  assert.equal((await f.send(later)).status,200);assert.equal(f.store.count(),2);
  const conflict=structuredClone(f.batch);conflict.batch_id=randomUUID();conflict.events[0].event_id=randomUUID();assert.equal((await f.send(conflict)).status,400);
 }finally{f.close();}
});

test('two guards share a device without blocking each other or sharing upload authority',async()=>{
 const f=setup();try{
  f.directory.addGuard({guardId:'g2',authSubject:'u2',vendorId:'v',active:true});
  f.devices.assign({assignmentId:'a2',guardId:'g2',vendorId:'v',siteId:'s',startsAt:1000,endsAt:100000,active:true});
  const device=f.devices.device('d');
  const g=f.issuer.issue({identity:{subject:'u2',guardId:'g2',vendorId:'v'},device,assignment:{assignmentId:'a2',guardId:'g2',vendorId:'v',deviceId:'d',siteId:'s',startsAt:1000,endsAt:100000,canStart:true},allowedActions:['incident'],sessionExpiresAt:100000,now:2000});
  const claims=JSON.parse(Buffer.from(g.payload,'base64url'));
  const second=structuredClone(f.batch);second.batch_id=randomUUID();second.scope.guard_id='g2';second.scope.assignment_id='a2';second.events[0].event_id=randomUUID();second.events[0].sequence=2;second.events[0].data.capture_grant_id=claims.grant_id;
  assert.equal((await f.send(second)).status,400);
  f.login('u2');assert.equal((await f.send(second)).status,200);assert.equal((await f.send(f.batch)).status,400);
  f.login('u');assert.equal((await f.send(f.batch)).status,200);assert.equal(f.store.count(),2);
 }finally{f.close();}
});

test('patrol records must match issued route snapshot and cannot double-record a checkpoint',async()=>{
 const f=setup();try{
  const route={routeId:'r',revision:1,checkpoints:[{id:'a',label:'Entrance'},{id:'b',label:'Perimeter'}]};
  const issued=f.issuer.issue({identity:{subject:'u',guardId:'g',vendorId:'v'},device:f.devices.device('d'),assignment:{assignmentId:'a',guardId:'g',vendorId:'v',deviceId:'d',siteId:'s',startsAt:1000,endsAt:100000,canStart:true,patrolRoute:route},allowedActions:['patrol'],sessionExpiresAt:100000,now:2000});
  const claims=JSON.parse(Buffer.from(issued.payload,'base64url'));route.checkpoints.length=0;
  const b=structuredClone(f.batch);b.events[0].kind='patrol_checkpoint';b.events[0].data={capture_grant_id:claims.grant_id,route_id:'r',route_revision:1,checkpoint_id:'b'};
  assert.equal((await f.send(b)).status,200);assert.equal((await f.send(b)).status,200);
  const other=structuredClone(b);other.batch_id=randomUUID();other.events[0].event_id=randomUUID();other.events[0].sequence=2;
  assert.equal((await f.send(other)).status,400);
  other.events[0].data.checkpoint_id='unknown';assert.equal((await f.send(other)).status,400);
  other.events[0].data.checkpoint_id='a';assert.equal((await f.send(other)).status,200);assert.equal(f.store.count(),2);
 }finally{f.close();}
});


test('check-in requires scheduled linked evidence and rejects duplicate slots atomically',async()=>{
 const f=setup();try{
  const policy={revision:1,interval_ms:60000,window_ms:10000,max_evidence_age_ms:5000,max_accuracy_m:100};
  const issued=f.issuer.issue({identity:{subject:'u',guardId:'g',vendorId:'v'},device:f.devices.device('d'),assignment:{assignmentId:'a',guardId:'g',vendorId:'v',deviceId:'d',siteId:'s',startsAt:1000,endsAt:100000,canStart:true,checkInPolicy:policy},allowedActions:['photo','check_in'],sessionExpiresAt:100000,now:2000});
  const claims=JSON.parse(Buffer.from(issued.payload,'base64url'));policy.revision=9;
  assert.equal(issued.check_in_policy.revision,1);
  const b=structuredClone(f.batch),photo={event_id:randomUUID(),sequence:1,at:2500,kind:'photo_evidence',data:{capture_grant_id:claims.grant_id,evidence_id:randomUUID(),sha256:'a'.repeat(64),bytes:4,width:1,height:1,capture:'camera_intent',check_in_slot:0,check_in_policy_revision:1}};
  const check={event_id:randomUUID(),sequence:2,at:2600,kind:'check_in',data:{capture_grant_id:claims.grant_id,policy_revision:1,slot:0,biometric:{method:'android_local_biometric',at:2100},location:{at:2200,latitude:45,longitude:-73,accuracy_m:5,mock:false},photo_event_id:photo.event_id,evidence_id:photo.data.evidence_id}};
  b.events=[photo,check];
  const bad=structuredClone(b);bad.events[1].data.location.mock=true;
  assert.equal((await f.send(bad)).status,400);assert.equal(f.store.count(),0);
  assert.equal((await f.send(b)).status,200);assert.equal((await f.send(b)).status,200);assert.equal(f.store.count(),2);
  const other=structuredClone(b);other.batch_id=randomUUID();other.events[0].event_id=randomUUID();other.events[0].sequence=3;other.events[1].event_id=randomUUID();other.events[1].sequence=4;other.events[1].data.photo_event_id=other.events[0].event_id;
  assert.equal((await f.send(other)).status,400);assert.equal(f.store.count(),2); // Rolls back its photo too.
  f.issuer.revoke(claims.grant_id);assert.equal((await f.send(b)).status,400);
 }finally{f.close();}
});

test('missed delivery reasons append without clearing the original deadline and retries deduplicate',async()=>{
 const f=setup();try{
  const policy={revision:1,interval_ms:60000,window_ms:10000,max_evidence_age_ms:5000,max_accuracy_m:100};
  const issued=f.issuer.issue({identity:{subject:'u',guardId:'g',vendorId:'v'},device:f.devices.device('d'),assignment:{assignmentId:'a',guardId:'g',vendorId:'v',deviceId:'d',siteId:'s',startsAt:1000,endsAt:100000,canStart:true,checkInPolicy:policy},allowedActions:['check_in'],sessionExpiresAt:100000,now:2000});
  const grantId=JSON.parse(Buffer.from(issued.payload,'base64url')).grant_id;
  const b=structuredClone(f.batch);b.events[0].kind='check_in_miss_reason';b.events[0].at=12000;b.events[0].data={capture_grant_id:grantId,policy_revision:1,slot:0,reason:'Offline test connection'};f.time(13000);
  for(const patch of [{reason:' '},{slot:1},{policy_revision:2}]){const bad=structuredClone(b);Object.assign(bad.events[0].data,patch);assert.equal((await f.send(bad)).status,400);}
  assert.equal(f.store.count(),0);
  assert.equal((await f.send(b)).status,200);assert.equal((await f.send(b)).status,200);assert.equal(f.store.count(),1);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM missed_check_ins').get().n,1);
  const note=JSON.parse(f.store.db.prepare('SELECT body FROM events').get().body);assert.equal(note.event.data.reason,'Offline test connection');
 }finally{f.close();}
});


test('signed acknowledgements retain exact message version and reject foreign or invented content',async()=>{
 const f=setup(['dispatch_ack']);try{
  const scope={guardId:'g',vendorId:'v',siteId:'s',assignmentId:'a'};
  const msg={message_id:'instruction',version:1,state:'active',title:'Test',body:'Synthetic instruction',issued_at:1500,due_at:null};
  f.dispatch.publish(scope,msg);
  const b=structuredClone(f.batch);b.events[0].kind='dispatch_ack';b.events[0].data={capture_grant_id:f.claims.grant_id,message_id:'instruction',message_version:1};
  for(const patch of [{message_version:2},{message_id:'foreign'},{message_version:'1'},{extra:'untrusted'}]){
   const invalid=structuredClone(b);Object.assign(invalid.events[0].data,patch);assert.equal((await f.send(invalid)).status,400);
  }
  f.dispatch.publish({...scope,guardId:'other'},{...msg,message_id:'foreign'});
  const foreign=structuredClone(b);foreign.events[0].data.message_id='foreign';assert.equal((await f.send(foreign)).status,400);
  assert.equal(f.store.count(),0);
  f.dispatch.publish(scope,{...msg,version:2,state:'retracted',title:'',body:''});
  assert.equal((await f.send(b)).status,200);assert.equal((await f.send(b)).status,200);assert.equal(f.store.count(),1);
  const saved=JSON.parse(f.store.db.prepare('SELECT body FROM events').get().body);
  assert.equal(saved.event.data.message_version,1);assert.equal(saved.vendor_id,'v');
  const withdrawn=structuredClone(b);withdrawn.events[0].data.message_version=2;assert.equal((await f.send(withdrawn)).status,400);
 }finally{f.close();}
 const denied=setup();try{
  const b=structuredClone(denied.batch);b.events[0].kind='dispatch_ack';b.events[0].data={capture_grant_id:denied.claims.grant_id,message_id:'instruction',message_version:1};assert.equal((await denied.send(b)).status,400);assert.equal(denied.store.count(),0);
 }finally{denied.close();}
});


test('confirmed shift gates ingestion while preserving pre-exit uploads and retries',async()=>{
 const f=setup(['incident'],true);try{
  assert.equal((await f.send(f.batch)).status,400);
  const assignment={assignmentId:'a',guardId:'g',vendorId:'v',siteId:'s',startsAt:1000,endsAt:100000,active:true};
  const scope={identity:f.identity,assignment,deviceThumbprint:f.device.thumbprint};
  f.shiftLifecycle.transition({...scope,request:{action:'start',request_id:'start',confirmed:true,reason:''},now:2000});
  assert.equal((await f.send(f.batch)).status,200);
  f.shiftLifecycle.transition({...scope,request:{action:'end',request_id:'end',confirmed:true,reason:'Synthetic early exit'},now:2500});
  assert.equal((await f.send(f.batch)).status,200);
  for(const at of [1999,2500,2600]){
   const b=structuredClone(f.batch);b.batch_id=randomUUID();b.events[0].event_id=randomUUID();b.events[0].sequence=2;b.events[0].at=at;
   assert.equal((await f.send(b)).status,400);
  }
  const delayed=structuredClone(f.batch);delayed.batch_id=randomUUID();delayed.events[0].event_id=randomUUID();delayed.events[0].sequence=2;delayed.events[0].at=2499;
  assert.equal((await f.send(delayed)).status,200);assert.equal(f.store.count(),2);
 }finally{f.close();}
});
