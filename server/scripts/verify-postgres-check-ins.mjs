import {fixtureAuthSession} from './fixture-auth-session.mjs';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,randomUUID,sign} from 'node:crypto';
import {Pool} from 'pg';
import {PostgresDeviceAssignments} from '../postgres-device-assignments.mjs';
import {PostgresShiftLifecycle} from '../postgres-shift-lifecycle.mjs';
import {PostgresShiftGrantIssuer} from '../postgres-shift-grant-issuer.mjs';
import {PostgresDurableIngest} from '../postgres-durable-ingest.mjs';
import {PostgresOpsBindingStore} from '../postgres-ops-binding-store.mjs';
import {PostgresOpsAssignmentSync} from '../postgres-ops-assignment-sync.mjs';
import {createCheckInWorker} from '../check-in-worker.mjs';
export async function verifyPostgresCheckIns(connectionString,admin){
 const pool=new Pool({connectionString,max:4,options:'-c role=service_role'});
 try{
  const devices=new PostgresDeviceAssignments(pool),store=new PostgresDurableIngest(devices),shifts=new PostgresShiftLifecycle(devices),now=Date.now(),startsAt=now-120000;
  const identity={subject:(await admin.query("SELECT auth_subject FROM mercury_guard.guards WHERE guard_id='device-other'")).rows[0].auth_subject,guardId:'device-other',vendorId:'device-vendor'};
  const session=await fixtureAuthSession(admin,identity.subject);
  // The disposable fixture's prior shift is closed before opening this independent policy scenario.
  await admin.query("UPDATE mercury_guard.shift_sessions SET clocked_out=clocked_in+1,reason='Synthetic fixture closeout' WHERE guard='device-other' AND clocked_out IS NULL");
  const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),spki=keys.publicKey.export({type:'spki',format:'der'}).toString('base64url');
  await devices.enroll({deviceId:'check-in-phone',mode:'site',siteId:'device-site',active:true,revoked:false,publicKeySpki:spki});const device=await devices.device('check-in-phone');
  const attention={version:1,profile:'calm_progressive_v1'},policy={revision:1,interval_ms:60000,window_ms:10000,max_evidence_age_ms:5000,max_accuracy_m:100,attention};
  // Reuse one named synthetic capacity placeholder: the prior verifier deliberately
  // filled all 1,000 slots. Keep binding-test untouched for later administration tests.
  const bindings=new PostgresOpsBindingStore(pool),sync=new PostgresOpsAssignmentSync(devices),binding={opsShiftId:'capacity-1',guardId:identity.guardId,vendorId:identity.vendorId,siteId:'device-site',authSubject:identity.subject,revision:2,active:true,checkInPolicy:policy},approval={operator:'synthetic-check-in-owner',reason:'Explicitly approve calm progressive attention within the existing response window',now};
  assert.equal((await bindings.approve(binding,approval)).status,'approved_locally');assert.equal((await bindings.approve(binding,approval)).status,'unchanged');
  const approved=(await admin.query('SELECT body FROM mercury_guard.ops_bindings WHERE source_id=$1',[binding.opsShiftId])).rows[0].body;
  const source={id:binding.opsShiftId,updated_at:new Date(now).toISOString(),scheduled_start:new Date(startsAt).toISOString(),scheduled_end:new Date(now+60000).toISOString(),status:'scheduled'},imported=await sync.apply(source,approved);
  const savedAssignment=async()=>(await admin.query('SELECT to_jsonb(a) body FROM mercury_guard.assignments a WHERE assignment_id=$1',[imported.assignmentId])).rows[0].body;
  const original=await savedAssignment();assert.deepEqual(original.check_in_policy.attention,attention);
  const history=async()=>(await admin.query('SELECT count(*)::int n FROM mercury_guard.ops_assignment_history WHERE source_id=$1',[source.id])).rows[0].n,originalHistory=await history();
  for(const invalid of [null,{version:1,profile:'unknown'},{...attention,interval_ms:30000}]){
   const replacement={...binding,revision:3,checkInPolicy:{...policy,attention:invalid}};
   await assert.rejects(bindings.approve(replacement,approval),/attention/);await assert.rejects(sync.apply(source,replacement),/attention/);
   assert.deepEqual(await savedAssignment(),original);assert.equal(await history(),originalHistory);
   assert.deepEqual((await admin.query('SELECT body FROM mercury_guard.ops_bindings WHERE source_id=$1',[binding.opsShiftId])).rows[0].body,approved);
  }
  // Preserve the legacy fixture ID consumed by the downstream receiver verifier.
  // Seed this independent scenario from the exact imported policy, retaining the
  // original Ops row/history rather than renaming or rewriting either one.
  await devices.cancel(imported.assignmentId);
  const assignment={assignmentId:'check-in-shift',guardId:identity.guardId,vendorId:identity.vendorId,siteId:'device-site',deviceId:device.deviceId,canStart:true,startsAt,endsAt:now+60000,active:true,checkInPolicy:original.check_in_policy};
  await devices.assign(assignment);
  const scope={identity,session,assignment,deviceThumbprint:device.thumbprint};await shifts.transition({...scope,request:{action:'start',confirmed:true,request_id:'check-in-start',reason:''},now:startsAt});
  const issuer=new PostgresShiftGrantIssuer({devices,privateKey:generateKeyPairSync('rsa',{modulusLength:2048}).privateKey,keyId:'check-in',issuer:'mercury-local',audience:'mercury-local'});
  const grant=await issuer.issue({identity,session,assignment,device,now:startsAt,sessionExpiresAt:assignment.endsAt,allowedActions:['photo','check_in']}),claims=JSON.parse(Buffer.from(grant.payload,'base64url'));
  assert.deepEqual(grant.check_in_policy.attention,attention);assert.equal(grant.check_in_policy.window_ms,10000);
  const originalGrant=await issuer.lookup(claims.grant_id);assert.deepEqual(originalGrant.policy.checkInPolicy,original.check_in_policy);
  grant.check_in_policy.attention.profile='mutated-response';assert.deepEqual(await issuer.lookup(claims.grant_id),originalGrant);
  const context={session,subject:identity.subject,guardId:identity.guardId,vendorId:identity.vendorId,siteId:assignment.siteId,assignmentId:assignment.assignmentId,thumbprint:device.thumbprint,publicKeySpki:spki,revocationVersion:1,enrolled:true,revoked:false,audience:'mercury-local',allowedKinds:['check_in','photo_evidence'],notBefore:Math.floor(startsAt/1000)-1,expiresAt:Math.floor(assignment.endsAt/1000)+60,allowHistoricalSequence:true};
  const bytes=Buffer.from([255,216,255,217]);
  async function deliver(slot,received,mediaAt){
   const due=startsAt+slot*60000,evidence_id=randomUUID(),photoId=randomUUID();
   const photo={event_id:photoId,sequence:slot*2+1,at:due+1500,kind:'photo_evidence',data:{capture_grant_id:claims.grant_id,evidence_id,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,width:1,height:1,capture:'camera_intent',check_in_slot:slot,check_in_policy_revision:1}};
   const check={event_id:randomUUID(),sequence:slot*2+2,at:due+2000,kind:'check_in',data:{capture_grant_id:claims.grant_id,policy_revision:1,slot,photo_event_id:photoId,evidence_id,biometric:{method:'android_local_biometric',at:due+1000},location:{at:due+1200,latitude:0,longitude:0,accuracy_m:10,mock:false}}};
   const batch={batch_id:randomUUID(),schema_version:2,scope:{guard_id:context.guardId,site_id:context.siteId,assignment_id:context.assignmentId,device_thumbprint:context.thumbprint,revocation_version:1},events:[photo,check]},payload=Buffer.from(JSON.stringify(batch)).toString('base64url');
   const raw=JSON.stringify({version:2,algorithm:'SHA256withECDSA',audience:context.audience,device_thumbprint:device.thumbprint,public_key_spki:spki,payload,signature_der:sign('sha256',Buffer.from(`mercury-event-batch-v2\n${context.audience}\n${device.thumbprint}\n${payload}`),keys.privateKey).toString('base64url')});
   const receipt=await store.ingest(raw,{...context,receivedAtMs:received},Math.floor(received/1000));assert.deepEqual(await store.ingest(raw,{...context,receivedAtMs:received},Math.floor(received/1000)),receipt);await store.retainPhoto(await store.photoForGuard(identity.guardId,photoId),bytes,mediaAt,session);
  }
  await deliver(0,startsAt+3000,startsAt+4000);
  const detected=startsAt+70001,results=await Promise.all([store.reconcileCheckIns(assignment,detected),store.reconcileCheckIns(assignment,detected)]);assert.deepEqual(results[0],results[1]);
  assert.equal(results[0].slots[0].status,'evidence_received');assert.equal(results[0].slots[1].status,'delivery_missing');assert.equal(results[0].total_deadlines_missed,1);
  assert.equal((await store.alertsAfter(0,100)).length,1);
  await deliver(1,startsAt+80000,startsAt+81000);const late=await store.reconcileCheckIns(assignment,startsAt+90000);
  assert.equal(late.slots[1].status,'evidence_received_after_deadline');assert.equal(late.slots[1].missing_detected_at,detected);
  await admin.query("CREATE FUNCTION mercury_guard.fail_alert_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic alert failure'; END $$; CREATE TRIGGER fail_alert_fixture BEFORE INSERT ON mercury_guard.check_in_alert_outbox FOR EACH ROW EXECUTE FUNCTION mercury_guard.fail_alert_fixture()");
  try{await assert.rejects(store.reconcileCheckIns(assignment,startsAt+130001));assert.equal((await admin.query('SELECT count(*)::int n FROM mercury_guard.missed_check_ins WHERE assignment_id=$1',[assignment.assignmentId])).rows[0].n,1);}finally{await admin.query('DROP TRIGGER fail_alert_fixture ON mercury_guard.check_in_alert_outbox;DROP FUNCTION mercury_guard.fail_alert_fixture()');}
  await shifts.transition({...scope,request:{action:'end',confirmed:true,request_id:'check-in-end',reason:'Synthetic early exit'},now:startsAt+100000});
  const ended=await store.reconcileCheckIns(assignment,assignment.endsAt+1);assert.deepEqual(ended.slots.map(s=>s.slot),[0,1]);assert.equal((await store.alertsAfter(0,100)).length,1);
  const worker=createCheckInWorker({store,devices,shiftLifecycle:shifts,now:()=>assignment.endsAt+1});
  try{assert.equal((await worker.run()).processed,1);assert.equal((await worker.run()).processed,0);}finally{await worker.stop();}
  assert.equal(await store.workerState.finalized(assignment.assignmentId,1),true);
  await assert.rejects(store.reconcileCheckIns({...assignment,checkInPolicy:{...assignment.checkInPolicy,revision:2}},assignment.endsAt+1),/policy mismatch/);
  await assert.rejects(pool.query('DELETE FROM mercury_guard.check_in_alert_outbox'),/permission denied/);
  console.log('PASS: explicitly approved attention survives PostgreSQL assignment/grant snapshots; malformed replacement rolls back; original signed evidence/retry and miss deadlines remain unchanged');
  console.log('PASS: shared check-in deadlines, concurrent reconciliation, late evidence, early exit and scheduler restart state');
 }finally{await pool.end();}
}
