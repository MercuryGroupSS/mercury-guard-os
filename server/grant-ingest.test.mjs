import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,randomUUID} from 'node:crypto';
import {LocalGuardDirectory} from './local-guard-directory.mjs';
import {LocalDeviceAssignments} from './local-device-assignments.mjs';
import {ShiftGrantIssuer} from './shift-grant-issuer.mjs';
import {DurableIngest} from './durable-ingest.mjs';
import {createGrantIngestHandler} from './grant-ingest-handler.mjs';
const rsa=generateKeyPairSync('rsa',{modulusLength:2048});
function setup(){
 const directory=new LocalGuardDirectory(':memory:'),devices=new LocalDeviceAssignments(':memory:'),store=new DurableIngest(':memory:');
 const issuer=new ShiftGrantIssuer({path:':memory:',privateKey:rsa.privateKey,keyId:'key',issuer:'mercury-local',audience:'mercury-local'});
 const ec=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),spki=ec.publicKey.export({type:'spki',format:'der'}).toString('base64url');
 directory.addVendor({vendorId:'v',kind:'company',active:true});directory.addGuard({guardId:'g',authSubject:'u',vendorId:'v',active:true});
 devices.enroll({deviceId:'d',mode:'site',siteId:'s',active:true,revoked:false,publicKeySpki:spki});
 devices.assign({assignmentId:'a',guardId:'g',vendorId:'v',siteId:'s',startsAt:1000,endsAt:100000,active:true});
 const device=devices.device('d'),identity={subject:'u',guardId:'g',vendorId:'v'};
 const issued=issuer.issue({identity,device,assignment:{assignmentId:'a',guardId:'g',vendorId:'v',deviceId:'d',siteId:'s',startsAt:1000,endsAt:100000,canStart:true},allowedActions:['incident'],sessionExpiresAt:100000,now:2000});
 const claims=JSON.parse(Buffer.from(issued.payload,'base64url'));
 let now=3000,subject='u';
 const handler=createGrantIngestHandler({directory,devices,store,grantIssuer:issuer,verifySession:async()=>({subject,active:true,expiresAt:200000}),now:()=>now});
 const batch={batch_id:randomUUID(),schema_version:2,scope:{guard_id:'g',site_id:'s',assignment_id:'a',device_thumbprint:device.thumbprint,revocation_version:1},events:[{event_id:randomUUID(),sequence:1,at:2000,kind:'incident',data:{capture_grant_id:claims.grant_id,note:'synthetic'}}]};
 const send=async b=>{
  const payload=Buffer.from(JSON.stringify(b)).toString('base64url'),signature=sign('sha256',Buffer.from(`mercury-event-batch-v2\nmercury-local\n${device.thumbprint}\n${payload}`),ec.privateKey).toString('base64url');
  return handler(new Request('https://example.test/v2/batches',{method:'POST',headers:{authorization:'Bearer token','content-type':'application/json'},body:JSON.stringify({version:2,algorithm:'SHA256withECDSA',audience:'mercury-local',device_thumbprint:device.thumbprint,public_key_spki:spki,payload,signature_der:signature})}));
 };
 return {directory,devices,store,issuer,claims,batch,send,time:t=>{now=t},login:s=>{subject=s},close(){directory.close();devices.close();store.close();issuer.close();}};
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
