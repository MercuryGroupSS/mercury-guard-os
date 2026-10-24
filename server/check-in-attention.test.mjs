import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign,verify} from 'node:crypto';
import {checkInAttention,checkInPolicy,validateCheckIn,validateMissReason} from './check-in-policy.mjs';
import {OpsBindingStore} from './ops-binding-store.mjs';
import {OpsAssignmentSync} from './ops-assignment-sync.mjs';
import {LocalDeviceAssignments} from './local-device-assignments.mjs';
import {ShiftGrantIssuer} from './shift-grant-issuer.mjs';

const attention={version:1,profile:'calm_progressive_v1'};
const raw={revision:1,interval_ms:60000,window_ms:10000,max_evidence_age_ms:5000,max_accuracy_m:100};
const malformed=[null,false,true,'calm_progressive_v1',[],{},1,{version:'1',profile:attention.profile},{version:2,profile:attention.profile},{version:1,profile:'unknown'},{version:1,profile:attention.profile,interval_ms:30000},{profile:attention.profile},{version:1},undefined];

test('attention omission preserves the exact legacy canonical policy and explicit profile preserves approved windows',()=>{
 const expected='{"revision":1,"starts_at":1000,"ends_at":100000,"interval_ms":60000,"window_ms":10000,"max_evidence_age_ms":5000,"max_accuracy_m":100}';
 assert.equal(JSON.stringify(checkInPolicy(raw,1000,100000)),expected);
 const supplied={...raw,attention:{...attention}},policy=checkInPolicy(supplied,1000,100000);
 assert.equal(JSON.stringify(policy),expected.slice(0,-1)+',"attention":{"version":1,"profile":"calm_progressive_v1"}}');
 supplied.attention.profile='mutated';assert.deepEqual(policy.attention,attention);
 const short=checkInPolicy({...raw,window_ms:1000,max_evidence_age_ms:1000,attention},1000,100000);
 const long=checkInPolicy({...raw,interval_ms:1800000,window_ms:1200000,attention},1000,1801000);
 assert.equal(short.window_ms,1000);assert.equal(short.max_evidence_age_ms,1000);
 assert.equal(long.window_ms,1200000);assert.equal(long.interval_ms,1800000);assert.equal(long.ends_at,1801000);
});

test('a present malformed attention profile is rejected rather than silently removed or replaced',()=>{
 for(const value of malformed){
  assert.throws(()=>checkInAttention(value),/attention/);
  assert.throws(()=>checkInPolicy({...raw,attention:value},1000,100000),/attention/);
 }
 assert.deepEqual(checkInAttention({profile:attention.profile,version:1}),attention);
});

test('approved attention survives immutable history, possession-bound assignment response and grant policy snapshot',()=>{
 const bindings=new OpsBindingStore(':memory:'),devices=new LocalDeviceAssignments(':memory:'),sync=new OpsAssignmentSync(devices);
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048}),issuer=new ShiftGrantIssuer({path:':memory:',privateKey,keyId:'attention-test',issuer:'synthetic',audience:'mercury-local'});
 const enrollment=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),spki=enrollment.publicKey.export({type:'spki',format:'der'}).toString('base64url');
 const shift={id:'synthetic-ops',updated_at:'2026-10-24T10:00:00Z',scheduled_start:'2026-10-24T12:00:00Z',scheduled_end:'2026-10-24T13:00:00Z',status:'scheduled'},now=Date.parse(shift.scheduled_start)+1000;
 const identity={subject:'synthetic-individual',guardId:'synthetic-guard',vendorId:'synthetic-company'},binding={opsShiftId:shift.id,guardId:identity.guardId,vendorId:identity.vendorId,siteId:'synthetic-site',authSubject:identity.subject,revision:1,active:true,checkInPolicy:{...raw,attention:{...attention}}},context={operator:'synthetic-owner',reason:'Explicitly approve the calm progressive profile',now};
 try{
  devices.enroll({deviceId:'synthetic-phone',mode:'site',siteId:binding.siteId,publicKeySpki:spki,active:true,revoked:false});
  assert.equal(bindings.approve(binding,context).status,'approved_locally');assert.equal(bindings.approve(binding,context).status,'unchanged');
  const approved=bindings.list()[0],created=sync.apply(shift,approved);assert.equal(created.status,'assignment_created');
  binding.checkInPolicy.attention.profile='mutated';
  const challenge=devices.challenge(identity,'synthetic-phone',now),device=devices.device('synthetic-phone');
  const proof={version:1,algorithm:'SHA256withECDSA',audience:'mercury-local',request_id:challenge.request_id,challenge:challenge.challenge,device_thumbprint:device.thumbprint,public_key_spki:spki};
  proof.signature_der=sign('sha256',Buffer.from(`mercury-enrollment-proof-v1\nmercury-local\n${challenge.request_id}\n${challenge.challenge}\n${device.thumbprint}`),enrollment.privateKey).toString('base64url');
  const assignment=devices.list(identity,proof,now).assignments[0];assert.deepEqual(assignment.checkInPolicy.attention,attention);
  const issued=issuer.issue({identity,assignment,device,sessionExpiresAt:now+3600000,allowedActions:['check_in','incident'],now}),claims=JSON.parse(Buffer.from(issued.payload,'base64url'));
  assert.equal(verify('sha256',Buffer.from(`mercury-shift-grant-v1.${issued.key_id}.${issued.payload}`),publicKey,Buffer.from(issued.signature,'base64url')),true);
  assert.deepEqual(issued.check_in_policy.attention,attention);assert.deepEqual(issuer.lookup(claims.grant_id).policy.checkInPolicy.attention,attention);
  assert.deepEqual(Object.keys(claims).sort(),['version','grant_id','issuer','audience','guard_id','site_id','assignment_id','device_thumbprint','revocation_version','issued_at_ms','not_before_ms','expires_at_ms','actions'].sort());
  const original=JSON.stringify(issuer.lookup(claims.grant_id));issued.check_in_policy.attention.profile='mutated-response';assert.equal(JSON.stringify(issuer.lookup(claims.grant_id)),original);
  const removed={...approved,revision:2,checkInPolicy:{...raw,revision:2}};
  assert.throws(()=>sync.apply(shift,{...removed,revision:1}),/Conflicting/);
  bindings.approve(removed,context);const replacement=sync.apply(shift,bindings.list()[0]);assert.notEqual(replacement.assignmentId,created.assignmentId);
  const saved=id=>JSON.parse(devices.db.prepare('SELECT body FROM assignments WHERE id=?').get(id).body);
  assert.equal(saved(created.assignmentId).active,false);assert.deepEqual(saved(created.assignmentId).checkInPolicy.attention,attention);
  assert.equal(Object.hasOwn(saved(replacement.assignmentId).checkInPolicy,'attention'),false);assert.equal(JSON.stringify(issuer.lookup(claims.grant_id)),original);
 }finally{issuer.close();devices.close();bindings.close();}
});

test('invalid optional attention never enters approved history or replaces a valid assignment',()=>{
 const store=new OpsBindingStore(':memory:'),devices=new LocalDeviceAssignments(':memory:'),sync=new OpsAssignmentSync(devices),binding={opsShiftId:'synthetic-ops',guardId:'guard',vendorId:'company',siteId:'site',authSubject:'individual',revision:1,active:true,checkInPolicy:{...raw,attention}},context={operator:'synthetic-owner',reason:'Synthetic explicit policy approval',now:1000};
 const shift={id:binding.opsShiftId,updated_at:'2026-10-24T10:00:00Z',scheduled_start:'2026-10-24T12:00:00Z',scheduled_end:'2026-10-24T13:00:00Z',status:'scheduled'};
 try{
  store.approve(binding,context);const original=sync.apply(shift,store.list()[0]),saved=devices.db.prepare('SELECT body FROM assignments WHERE id=?').get(original.assignmentId).body;
  for(const value of malformed){
   const changed={...binding,revision:2,checkInPolicy:{...raw,attention:value}};
   assert.throws(()=>store.approve(changed,context),/attention/);assert.throws(()=>sync.apply(shift,changed),/attention/);
   assert.equal(devices.db.prepare('SELECT body FROM assignments WHERE id=?').get(original.assignmentId).body,saved);
  }
  assert.equal(store.db.prepare('SELECT count(*) n FROM ops_binding_history').get().n,1);assert.deepEqual(store.list()[0],binding);
  assert.equal(devices.db.prepare('SELECT count(*) n FROM ops_assignment_history').get().n,1);assert.equal(devices.db.prepare('SELECT count(*) n FROM assignments').get().n,1);
 }finally{devices.close();store.close();}
});

test('attention does not complete check-ins, accept silence as evidence, or change missed-check deadlines',()=>{
 const scope={guard_id:'guard',site_id:'site',assignment_id:'assignment',device_thumbprint:'a'.repeat(64),revocation_version:1},policy=checkInPolicy({...raw,attention},1000,100000);
 const photo={scope:{...scope},event:{kind:'photo_evidence',event_id:randomUUID(),at:4000,data:{evidence_id:randomUUID(),sha256:'a'.repeat(64),bytes:4,width:1,height:1,capture:'camera_intent',check_in_slot:0,check_in_policy_revision:1}}};
 const event={at:5000,data:{policy_revision:1,slot:0,biometric:{method:'android_local_biometric',at:2000},location:{at:3000,latitude:0,longitude:0,accuracy_m:8,mock:false},photo_event_id:photo.event.event_id,evidence_id:photo.event.data.evidence_id}};
 assert.deepEqual(validateCheckIn(policy,event,photo,scope),validateCheckIn(checkInPolicy(raw,1000,100000),event,photo,scope));
 for(const mutate of [e=>{delete e.data.biometric;e.data.silenced=true;},e=>{e.data.location.mock=true;},e=>{e.data.location.at=1000;},e=>{e.at=11000;}]){const changed=structuredClone(event);mutate(changed);assert.throws(()=>validateCheckIn(policy,changed,photo,scope));}
 assert.throws(()=>validateCheckIn(policy,event,null,scope));
 const reason={at:10999,data:{policy_revision:1,slot:0,reason:'Synthetic missed response'}};assert.throws(()=>validateMissReason(policy,reason),/has not closed/);reason.at=11000;assert.equal(validateMissReason(policy,reason),0);
 const long=checkInPolicy({...raw,interval_ms:1800000,window_ms:1200000,attention},1000,1801000);reason.at=601000;assert.throws(()=>validateMissReason(long,reason),/has not closed/);reason.at=1201000;assert.equal(validateMissReason(long,reason),0);
});
