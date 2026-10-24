import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {patrolRoute,patrolRoutePolicy} from './patrol-route.mjs';
import {locationDigest,locationPolicySnapshot} from './location-policy.mjs';
import {validatePatrolCheckpoint,projectPatrolLocation} from './patrol-location.mjs';
import {projectDashboardObservation,validateProjectedDashboardObservation} from './dashboard-delivery.mjs';
import {prepareOpsBinding} from './ops-binding-input.mjs';
import {LocalDeviceAssignments} from './local-device-assignments.mjs';
export function patrolGpsFixture(){
 const notice='Synthetic checkpoint-fix purpose, shown before consent. No operational tracking.',policy={version:1,revision:2,notice_revision:3,notice_text:notice,notice_sha256:locationDigest(notice),sample_interval_ms:12000,min_distance_m:0,max_fix_age_ms:20000,max_accuracy_m:30,max_capture_lease_ms:60000,geofence:null},snapshot=locationPolicySnapshot(policy);
 const route={routeId:'route',revision:4,checkpoints:[{id:'entrance',label:'Entrance'}],gps_required:true,rounds:[{id:'opening',label:'Opening'},{id:'closing',label:'Closing'}]},grant={grant_id:randomUUID(),actions:['patrol','location'],not_before_ms:1000,expires_at_ms:61000,location:{consent_id:randomUUID(),policy_sha256:snapshot.policy_sha256,policy_payload:snapshot.policy_payload}},event={event_id:randomUUID(),kind:'patrol_checkpoint',at:3000,data:{capture_grant_id:grant.grant_id,route_id:'route',route_revision:4,checkpoint_id:'entrance',round_id:'closing',location:{requested_at_ms:1000,fix_at_ms:2000,consent_id:grant.location.consent_id,policy_revision:2,notice_revision:3,policy_sha256:snapshot.policy_sha256,notice_sha256:policy.notice_sha256,latitude:0,longitude:0,accuracy_m:10,mock:false}}};
 return {policy,route,grant,event};
}
test('GPS-required policy is explicit, paired with a complete approved notice; legacy route shape is unchanged',()=>{
 const f=patrolGpsFixture(),{gps_required,...manual}=f.route;assert.deepEqual(patrolRoute(manual),manual);assert.deepEqual(patrolRoutePolicy(f.route,f.policy),f.route);
 for(const value of [false,null,'true',1])assert.throws(()=>patrolRoute({...f.route,gps_required:value}));
 for(const p of [undefined,null,{}, {...f.policy,notice_sha256:'a'.repeat(64)}])assert.throws(()=>patrolRoutePolicy(f.route,p));
 const binding={opsShiftId:'ops',guardId:'guard',vendorId:'company',siteId:'site',authSubject:'subject',revision:1,active:true,patrolRoute:f.route},approval={operator:'synthetic-owner',reason:'Exact reviewed notice covers checkpoint fixes',now:1000};assert.throws(()=>prepareOpsBinding(binding,approval));assert.ok(prepareOpsBinding({...binding,locationPolicy:f.policy},approval).body.includes('gps_required'));
 const devices=new LocalDeviceAssignments(':memory:');try{const a={assignmentId:'shift',guardId:'guard',vendorId:'company',siteId:'site',active:true,startsAt:1000,endsAt:10000,patrolRoute:f.route};assert.throws(()=>devices.assign(a));devices.assign({...a,locationPolicy:f.policy});}finally{devices.close();}
});
test('checkpoint requires original notice, signed capability and a fresh request followed by a nonmock fix',()=>{
 const f=patrolGpsFixture(),proof=validatePatrolCheckpoint(f.route,f.event,f.grant,4000);assert.equal(proof.status,'validated_device_observation');assert.equal(proof.notice_revision,3);assert.equal(proof.geofence.state,'not_configured');
 for(const patch of [{requested_at_ms:999},{requested_at_ms:2001},{fix_at_ms:3001},{fix_at_ms:999},{fix_at_ms:NaN},{consent_id:randomUUID()},{policy_revision:3},{notice_revision:4},{policy_sha256:'a'.repeat(64)},{notice_sha256:'a'.repeat(64)},{latitude:91},{longitude:-181},{accuracy_m:31},{accuracy_m:0},{mock:true},{extra:true}]){const e=structuredClone(f.event);Object.assign(e.data.location,patch);assert.throws(()=>validatePatrolCheckpoint(f.route,e,f.grant,4000));}
 for(const patch of [{location:undefined},{actions:['patrol']}])assert.throws(()=>validatePatrolCheckpoint(f.route,f.event,{...f.grant,...patch},4000));
 const missing=structuredClone(f.event);delete missing.data.location;assert.throws(()=>validatePatrolCheckpoint(f.route,missing,f.grant,4000));
 for(const at of [999,61000,23001])assert.throws(()=>validatePatrolCheckpoint(f.route,{...f.event,at},f.grant,at));assert.throws(()=>validatePatrolCheckpoint(f.route,f.event,f.grant,2999));
 const {gps_required,...manual}=f.route;assert.throws(()=>validatePatrolCheckpoint(manual,f.event,f.grant,4000));delete missing.data.location;assert.equal(validatePatrolCheckpoint(manual,missing,f.grant,4000),null);
});
test('GPS checkpoint projection retains exact notice/proof while manual projection stays byte-compatible',()=>{
 const f=patrolGpsFixture(),mapping={guardId:'guard',vendorId:'company',siteId:'site',assignmentId:'shift',dashboardShiftId:'ops',destination:'receiver',revision:1,active:true},record={scope:{guard_id:'guard',site_id:'site',assignment_id:'shift',device_thumbprint:'a'.repeat(64)},vendor_id:'company',event:f.event,checkpoint_location_validation:validatePatrolCheckpoint(f.route,f.event,f.grant,4000)},projected=projectDashboardObservation(record,mapping);
 assert.equal(projected.observation.data.location.notice_revision,3);assert.equal(projected.observation.data.location.server_validation.consent_id,f.grant.location.consent_id);assert.deepEqual(validateProjectedDashboardObservation(projected,mapping),projected);
 assert.throws(()=>projectPatrolLocation({...record,checkpoint_location_validation:undefined}));const corrupt=structuredClone(projected);corrupt.observation.data.location.server_validation.notice_revision++;assert.throws(()=>validateProjectedDashboardObservation(corrupt,mapping));
 const manual=structuredClone(record);delete manual.event.data.location;delete manual.checkpoint_location_validation;const old=projectDashboardObservation(manual,mapping);assert.equal(JSON.stringify(old.observation.data),JSON.stringify({route_id:'route',route_revision:4,checkpoint_id:'entrance',round_id:'closing'}));assert.deepEqual(validateProjectedDashboardObservation(old,mapping),old);
});
