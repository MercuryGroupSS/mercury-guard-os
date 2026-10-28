import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
import {PostgresAdministration,AdminDeniedError} from '../postgres-administration.mjs';
import {PostgresDeviceAssignments} from '../postgres-device-assignments.mjs';
import {PostgresDashboardInbox} from '../postgres-dashboard-inbox.mjs';
import {ReceiverMappingOwner} from '../receiver-mapping-owner.mjs';
import {projectDashboardObservation} from '../dashboard-delivery.mjs';
import {fixtureAuthSession} from './fixture-auth-session.mjs';

// This runs only in the canonical runner's disposable PostgreSQL database.
// Authority results come from real queries; a separate owner connection deletes
// the exact synthetic session after a selected real query has completed.
export async function verifyPostgresAdminSessionFences(connectionString,owner){
 const pool=new Pool({connectionString,max:4,options:'-c role=service_role',connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:12000}),ownerPool=new Pool({connectionString,max:2});
 const prefix='admin-session-'+randomUUID(),subject=randomUUID(),other=randomUUID(),hash=b=>createHash('sha256').update(b).digest('hex');
 try{
  await owner.query('INSERT INTO auth.users(id,email) VALUES($1,$2),($3,$4)',[subject,prefix+'@example.invalid',other,prefix+'-other@example.invalid']);
  await owner.query('INSERT INTO mercury_guard.admin_accounts(auth_subject,email,active) VALUES($1,$2,true)',[subject,prefix+'@example.invalid']);
  const session=await fixtureAuthSession(owner,subject),independent=await fixtureAuthSession(owner,subject),otherSession=await fixtureAuthSession(owner,other),devices=new PostgresDeviceAssignments(pool),admin=new PostgresAdministration({devices});
  const revoke=()=>owner.query('DELETE FROM auth.sessions WHERE id=$1 AND user_id=$2',[session.sessionId,subject]);
  const restore=()=>owner.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2) ON CONFLICT(id) DO NOTHING',[session.sessionId,subject]);
  const request=(suffix)=>({request_id:randomUUID(),action:'vendor.create',reason:'Disposable exact-session administration regression',payload:{vendorId:prefix+'-'+suffix,kind:'company',active:true}});
  function afterQuery(pattern,hook=revoke){
   let fired=0;
   const wrapped=Object.create(devices);
   wrapped.transaction=(fn,existingClient=null)=>devices.transaction(client=>fn({query:async(...args)=>{const result=await client.query(...args);if(!fired&&pattern.test(args[0])){fired++;await hook();}return result;}}),existingClient);
   return {admin:new PostgresAdministration({devices:wrapped}),fired:()=>fired};
  }
  // Regression: membership remains active but the exact signed-in session is
  // deleted while a private catalog is being read. No page may escape.
  const catalogRace=afterQuery(/FROM mercury_guard\.vendors WHERE/);
  await assert.rejects(catalogRace.admin.catalog(session,'vendors'),AdminDeniedError);assert.equal(catalogRace.fired(),1);await restore();
  for(const invalid of [{...session,sessionId:undefined},{...session,sessionId:otherSession.sessionId},{...session,expiresAt:Math.floor(Date.now()/1000)},{...session,expiresAt:Number.MAX_SAFE_INTEGER}]){
   assert.equal(await admin.member(invalid),false);await assert.rejects(admin.catalog(invalid,'vendors'),AdminDeniedError);
  }
  await revoke();assert.equal(await admin.member(session),false);assert.equal(await admin.member(independent),true);await assert.rejects(admin.settle(session,request('revoked')),AdminDeniedError);await restore();
  await owner.query("UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 second' WHERE id=$1",[session.sessionId]);assert.equal(await admin.member(session),false);assert.equal(await admin.member(independent),true);await owner.query('UPDATE auth.sessions SET not_after=NULL WHERE id=$1',[session.sessionId]);
  for(const pattern of [/^INSERT INTO mercury_guard\.vendors/,/^INSERT INTO mercury_guard\.admin_audit/]){
   const value=request('rollback-'+randomUUID()),race=afterQuery(pattern);
   await assert.rejects(race.admin.apply(session,value),AdminDeniedError);assert.equal(race.fired(),1);
   assert.equal((await owner.query('SELECT count(*)::int n FROM mercury_guard.vendors WHERE vendor_id=$1',[value.payload.vendorId])).rows[0].n,0);
   assert.equal((await owner.query('SELECT count(*)::int n FROM mercury_guard.admin_audit WHERE request_id=$1',[value.request_id])).rows[0].n,0);await restore();
   assert.equal((await admin.apply(independent,value)).status,'applied');
  }
  const closed=request('closed'),settleRace=afterQuery(/^INSERT INTO mercury_guard\.admin_audit/);
  await assert.rejects(settleRace.admin.settle(session,closed),AdminDeniedError);assert.equal(settleRace.fired(),1);assert.equal((await owner.query('SELECT count(*)::int n FROM mercury_guard.admin_audit WHERE request_id=$1',[closed.request_id])).rows[0].n,0);await restore();
  const receipt=await admin.apply(independent,request('historical')),closedReceipt=await admin.settle(independent,closed);
  for(const [method,saved] of [['apply',receipt],['settle',receipt],['apply',closedReceipt],['settle',closedReceipt]]){
   const row=(await owner.query('SELECT input,receipt::text raw FROM mercury_guard.admin_audit WHERE request_id=$1',[saved.request_id])).rows[0],value={request_id:saved.request_id,...row.input},race=afterQuery(/^SELECT actor_subject,request_digest,receipt FROM mercury_guard\.admin_audit/);
   await assert.rejects(race.admin[method](session,value),AdminDeniedError);assert.equal(race.fired(),1);
   assert.deepEqual(await admin[method](independent,value),saved);assert.equal((await owner.query('SELECT receipt::text raw FROM mercury_guard.admin_audit WHERE request_id=$1',[saved.request_id])).rows[0].raw,row.raw);await restore();
  }
  // Private report metadata, JPEG bytes and a missing media result all require
  // the same final session check, without granting any new Auth privileges.
  const mapping={assignmentId:prefix+'-assignment',guardId:prefix+'-guard',vendorId:prefix+'-vendor',siteId:prefix+'-site',dashboardShiftId:prefix+'-upstream',destination:prefix+'-isolated',revision:1,active:true};
  await new ReceiverMappingOwner(ownerPool).approve({mapping,requestId:randomUUID(),operator:'Synthetic verifier',reason:'Isolated administrator session fence regression'});
  const bytes=Buffer.from(readFileSync(new URL('../fixtures/receiver-photo.base64',import.meta.url),'utf8').trim(),'base64'),photo=projectDashboardObservation({vendor_id:mapping.vendorId,scope:{assignment_id:mapping.assignmentId,guard_id:mapping.guardId,site_id:mapping.siteId,device_thumbprint:hash(prefix)},event:{event_id:randomUUID(),kind:'photo_evidence',at:Date.now(),data:{evidence_id:randomUUID(),sha256:hash(bytes),bytes:bytes.length,width:192,height:108,capture:'camera_intent'}}},mapping),inbox=new PostgresDashboardInbox(pool);
  await inbox.accept(photo,JSON.stringify(photo));await inbox.acceptMedia(photo.delivery_id,mapping.destination,bytes);
  for(const [kind,path,pattern] of [['catalog','received_reports',/FROM mercury_guard_receiver\.observations o /],['media',photo.delivery_id,/receipt,bytes FROM mercury_guard_receiver\.media/],['media','f'.repeat(64),/FROM mercury_guard_receiver\.observations WHERE delivery_id=/]]){
   const race=afterQuery(pattern);await assert.rejects(race.admin[kind](session,path),AdminDeniedError);assert.equal(race.fired(),1);await restore();
  }
  assert.deepEqual((await admin.media(independent,photo.delivery_id)).bytes,bytes);
  // Prove the service retained only its pre-existing narrow Auth read rights.
  await assert.rejects(pool.query('SELECT test_secret FROM auth.sessions'),/permission denied/);
  console.log('PASS: administrator exact-session fences; concurrent catalog/report/JPEG denial, mutation and resolution rollback, immutable historical retries, independent-session recovery and narrow Auth grants');
 }finally{await pool.end();await ownerPool.end();}
}
