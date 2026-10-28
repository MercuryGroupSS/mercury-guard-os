import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {Pool} from 'pg';
import {PostgresDeviceAssignments} from '../postgres-device-assignments.mjs';
import {PostgresAdministration,AdminDeniedError,AdminConflictError} from '../postgres-administration.mjs';
import {fixtureAuthSession} from './fixture-auth-session.mjs';
export async function verifyPostgresAdministration(connectionString,owner){
 const pool=new Pool({connectionString,max:4,options:'-c role=service_role'});
 try{
  const adminSubject=randomUUID(),subjects=[randomUUID(),randomUUID()],email='admin@example.invalid';
  await owner.query('INSERT INTO auth.users(id,email) VALUES($1,$2),($3,$4),($5,$6)',[adminSubject,email,subjects[0],'a@example.invalid',subjects[1],'b@example.invalid']);
  await owner.query('INSERT INTO mercury_guard.admin_accounts(auth_subject,email,active) VALUES($1,$2,true)',[adminSubject,email]);
  const devices=new PostgresDeviceAssignments(pool),accounts=new Map(subjects.map((subject,i)=>[subject,{subject,email:i?'b@example.invalid':'a@example.invalid',confirmed:true,enabled:true}]));
  const admin=new PostgresAdministration({devices,loadAuthAccount:async subject=>accounts.get(subject)}),session=await fixtureAuthSession(owner,adminSubject);
  const action=(name,payload)=>({request_id:randomUUID(),action:name,reason:'Synthetic administration test',payload});
  assert.equal(await admin.member({...session,subject:subjects[0],user_metadata:{admin:true}}),false);
  const create=action('vendor.create',{vendorId:'admin-vendor',kind:'company',active:true}),created=await Promise.all([admin.apply(session,create),admin.apply(session,create)]);assert.deepEqual(created[0],created[1]);
  await assert.rejects(admin.apply(session,{...create,payload:{...create.payload,active:false}}),AdminConflictError);
  assert.deepEqual(await admin.settle(session,create),created[0]);
  const closed=action('vendor.create',{vendorId:'admin-closed',kind:'company',active:true}),closedReceipt=await admin.settle(session,closed);assert.equal(closedReceipt.status,'not_applied');assert.deepEqual(await admin.apply(session,closed),closedReceipt);assert.equal((await pool.query("SELECT 1 FROM mercury_guard.vendors WHERE vendor_id='admin-closed'")).rowCount,0);
  const racing=action('vendor.create',{vendorId:'admin-resolution-race',kind:'company',active:true}),race=await Promise.all([admin.apply(session,racing),admin.settle(session,racing)]);assert.deepEqual(race[0],race[1]);assert.equal((await pool.query("SELECT 1 FROM mercury_guard.vendors WHERE vendor_id='admin-resolution-race'")).rowCount,race[0].status==='applied'?1:0);
  await admin.apply(session,action('site.create',{siteId:'admin-site',active:true}));
  for(let i=0;i<2;i++)await admin.apply(session,action('guard.link',{guardId:'admin-guard-'+i,vendorId:'admin-vendor',authSubject:subjects[i].toUpperCase(),email:accounts.get(subjects[i]).email,active:true}));
  await admin.apply(session,action('guard.status',{guardId:'admin-guard-0',active:false}));accounts.get(subjects[0]).confirmed=false;
  await assert.rejects(admin.apply(session,action('guard.status',{guardId:'admin-guard-0',active:true})));assert.equal((await pool.query("SELECT active FROM mercury_guard.guards WHERE guard_id='admin-guard-0'")).rows[0].active,false);
  accounts.get(subjects[0]).confirmed=true;await admin.apply(session,action('guard.status',{guardId:'admin-guard-0',active:true}));
  await owner.query('INSERT INTO mercury_guard.admin_accounts(auth_subject,email,active) VALUES($1,$2,true)',[subjects[1],accounts.get(subjects[1]).email]);
  const otherAdminSession=await fixtureAuthSession(owner,subjects[1]);
  await assert.rejects(admin.apply(otherAdminSession,create),AdminConflictError);
  await assert.rejects(admin.settle(otherAdminSession,closed),AdminConflictError);
  const page=await admin.catalog(session,'ops_bindings');assert.equal(page.items.length,50);assert.ok(page.next_cursor);const next=await admin.catalog(session,'ops_bindings',page.next_cursor);assert.ok(next.items.every(x=>x.source_id>page.next_cursor));
  assert.equal((await admin.catalog(session,'guards')).items.filter(g=>g.vendor_id==='admin-vendor').length,2);
  const key=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),enrollment={deviceId:'admin-phone',mode:'site',siteId:'admin-site',active:true,revoked:false,publicKeySpki:key.publicKey.export({type:'spki',format:'der'}).toString('base64url')};
  await admin.apply(session,action('device.enroll',enrollment));const revoke=action('device.revoke',{deviceId:'admin-phone'});await Promise.all([admin.apply(session,revoke),admin.apply(session,revoke)]);assert.equal((await devices.device('admin-phone')).revocationVersion,2);
  const binding={opsShiftId:'binding-test',guardId:'admin-guard-0',vendorId:'admin-vendor',siteId:'admin-site',authSubject:subjects[0].toUpperCase(),revision:4,active:true};await admin.apply(session,action('ops_binding.approve',binding));
  const now=Date.now(),assignment={assignmentId:'admin-assignment',guardId:'admin-guard-0',vendorId:'admin-vendor',siteId:'admin-site',startsAt:now-1000,endsAt:now+60000,active:true};await devices.assign(assignment);
  const mapping={assignmentId:assignment.assignmentId,guardId:assignment.guardId,vendorId:assignment.vendorId,siteId:assignment.siteId,dashboardShiftId:'admin-upstream',destination:'isolated',revision:1,active:true};await admin.apply(session,action('dashboard_mapping.approve',mapping));
  const publication={scope:{guardId:assignment.guardId,vendorId:assignment.vendorId,siteId:assignment.siteId,assignmentId:assignment.assignmentId},message:{message_id:'admin-message',version:1,state:'active',title:'Synthetic',body:'No operational instruction',issued_at:now,due_at:null}};await admin.apply(session,action('dispatch.publish',publication));
  const originalBindingAssignment=(await pool.query("SELECT assignment_id FROM mercury_guard.ops_assignment_sync WHERE source_id='binding-test'")).rows[0].assignment_id;
  await owner.query("CREATE FUNCTION mercury_guard.fail_admin_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$;CREATE TRIGGER fail_admin_fixture BEFORE INSERT ON mercury_guard.admin_audit FOR EACH ROW EXECUTE FUNCTION mercury_guard.fail_admin_fixture()");
  try{for(const change of [action('vendor.status',{vendorId:'admin-vendor',active:false}),action('device.revoke',{deviceId:'admin-phone'}),action('ops_binding.approve',{...binding,revision:5,active:false}),action('dashboard_mapping.approve',{...mapping,revision:2,active:false}),action('dispatch.publish',{...publication,message:{...publication.message,version:2}})])await assert.rejects(admin.apply(session,change));}finally{await owner.query('DROP TRIGGER fail_admin_fixture ON mercury_guard.admin_audit;DROP FUNCTION mercury_guard.fail_admin_fixture()');}
  assert.equal((await pool.query('SELECT active FROM mercury_guard.assignments WHERE assignment_id=$1',[originalBindingAssignment])).rows[0].active,true);
  assert.ok((await admin.catalog(session,'audit')).items.length>0);
  assert.equal((await pool.query("SELECT active FROM mercury_guard.vendors WHERE vendor_id='admin-vendor'")).rows[0].active,true);assert.equal((await devices.device('admin-phone')).revocationVersion,2);
  assert.equal(Number((await pool.query("SELECT revision FROM mercury_guard.ops_bindings WHERE source_id='binding-test'")).rows[0].revision),4);
  assert.equal(Number((await pool.query("SELECT revision FROM mercury_guard.dashboard_bindings WHERE assignment_id='admin-assignment'")).rows[0].revision),1);
  assert.equal((await pool.query("SELECT count(*)::int n FROM mercury_guard.dispatch_changes WHERE assignment_id='admin-assignment'")).rows[0].n,1);
  await assert.rejects(pool.query('UPDATE mercury_guard.admin_accounts SET active=true'),/permission denied/);await assert.rejects(pool.query('DELETE FROM mercury_guard.admin_audit'),/permission denied/);
  await owner.query('UPDATE mercury_guard.admin_accounts SET active=false WHERE auth_subject=$1',[adminSubject]);assert.equal(await admin.member(session),false);await assert.rejects(admin.apply(session,create),AdminDeniedError);await assert.rejects(admin.settle(session,closed),AdminDeniedError);await assert.rejects(admin.catalog(session,'guards'),AdminDeniedError);
  console.log('PASS: explicit admin membership, company-to-many guard linking, idempotent audited actions, nested rollback and revocation');
 }finally{await pool.end();}
}
