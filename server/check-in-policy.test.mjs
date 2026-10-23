import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {checkInPolicy,validateCheckIn} from './check-in-policy.mjs';
function fixture(){
 const p=checkInPolicy({revision:1,interval_ms:60000,window_ms:10000,max_evidence_age_ms:5000,max_accuracy_m:100},1000,100000);
 const scope={guard_id:'g',site_id:'s',assignment_id:'a',device_thumbprint:'a'.repeat(64),revocation_version:1};
 const photo={scope:{...scope},event:{kind:'photo_evidence',event_id:randomUUID(),at:4000,data:{evidence_id:randomUUID(),sha256:'a'.repeat(64),bytes:4,width:1,height:1,capture:'camera_intent',check_in_slot:0,check_in_policy_revision:1}}};
 const event={at:5000,data:{policy_revision:1,slot:0,biometric:{method:'android_local_biometric',at:2000},location:{at:3000,latitude:45,longitude:-73,accuracy_m:8,mock:false},photo_event_id:photo.event.event_id,evidence_id:photo.event.data.evidence_id}};
 return {p,scope,photo,event};
}
test('check-in policy explicitly bounds schedule, evidence freshness and accuracy',()=>{
 const f=fixture();assert.deepEqual(validateCheckIn(f.p,f.event,f.photo,f.scope),{slot:0,revision:1,due_at:1000});
 for(const patch of [{revision:0},{interval_ms:0},{window_ms:60001},{max_evidence_age_ms:10001},{max_accuracy_m:NaN}])assert.throws(()=>checkInPolicy({...f.p,...patch},1000,100000));
 assert.throws(()=>validateCheckIn(null,f.event,f.photo,f.scope));
});
test('stale, early, late, mock and inaccurate observations never complete a check-in',()=>{
 const mutations=[f=>f.event.at=11000,f=>f.event.at=999,f=>f.event.data.slot=2,f=>f.event.data.policy_revision=2,
  f=>f.event.data.biometric.at=-1,f=>f.event.data.biometric.method='none',f=>f.event.data.location.at=1000,
  f=>f.event.data.location.mock=true,f=>f.event.data.location.accuracy_m=101,f=>f.event.data.location.latitude=91,
  f=>f.event.data.location.longitude='-73',f=>{f.event.at=10000;},f=>f.event.data.biometric=null];
 for(const mutate of mutations){const f=fixture();mutate(f);assert.throws(()=>validateCheckIn(f.p,f.event,f.photo,f.scope));}
});
test('photo linkage rejects unrelated guards, devices, assignments, evidence and slots',()=>{
 for(const mutate of [f=>f.photo=null,f=>f.photo.scope.guard_id='other',f=>f.photo.scope.assignment_id='other',f=>f.photo.scope.device_thumbprint='b'.repeat(64),f=>f.photo.event.data.check_in_slot=1,f=>f.photo.event.at=1000,f=>f.event.data.evidence_id=randomUUID(),f=>f.event.data.photo_event_id=randomUUID()]){
  const f=fixture();mutate(f);assert.throws(()=>validateCheckIn(f.p,f.event,f.photo,f.scope));
 }
});
