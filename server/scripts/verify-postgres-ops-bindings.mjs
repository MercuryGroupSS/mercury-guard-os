import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {PostgresGuardDirectory} from '../postgres-guard-directory.mjs';
import {PostgresDeviceAssignments} from '../postgres-device-assignments.mjs';
import {PostgresOpsAssignmentSync} from '../postgres-ops-assignment-sync.mjs';
import {openLocalOpsRefresh} from '../local-ops-refresh.mjs';
import {PostgresOpsBindingStore} from '../postgres-ops-binding-store.mjs';
export async function verifyPostgresOpsBindings(connectionString,admin){
 const pool=new Pool({connectionString,max:4,options:'-c role=service_role'});
 try{
  const store=new PostgresOpsBindingStore(pool),binding={opsShiftId:'binding-test',guardId:'g',vendorId:'v',siteId:'s',authSubject:'u',revision:1,active:true},context={operator:'test',reason:'synthetic',now:1000};
  const results=await Promise.all([store.approve(binding,context),store.approve(binding,context)]);
  assert.deepEqual(results.map(x=>x.status).sort(),['approved_locally','unchanged']);
  assert.deepEqual(await new PostgresOpsBindingStore(pool).list(),[binding]);
  await assert.rejects(store.approve({...binding,guardId:'other'},context));
  await store.approve({...binding,revision:2,active:false},context);
  await assert.rejects(store.approve(binding,context));
  assert.equal((await store.list())[0].active,false);
  assert.equal((await admin.query("SELECT count(*)::int n FROM mercury_guard.ops_binding_history")).rows[0].n,2);
  await admin.query("CREATE FUNCTION mercury_guard.fail_binding_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$; CREATE TRIGGER fail_binding_test BEFORE INSERT ON mercury_guard.ops_binding_history FOR EACH ROW EXECUTE FUNCTION mercury_guard.fail_binding_test()");
  try{await assert.rejects(store.approve({...binding,revision:3,active:true},context));assert.equal((await store.list())[0].active,false);}finally{await admin.query('DROP TRIGGER fail_binding_test ON mercury_guard.ops_binding_history;DROP FUNCTION mercury_guard.fail_binding_test()');}
  await assert.rejects(pool.query('DELETE FROM mercury_guard.ops_binding_history'),/permission denied/);
  await assert.rejects(pool.query("UPDATE mercury_guard.ops_binding_history SET reason='changed'"),/permission denied/);
  await assert.rejects(store.approve({...binding,revision:3,password:'unexpected'},context));
  const subject=(await admin.query("SELECT auth_subject FROM mercury_guard.guards WHERE guard_id='device-guard'")).rows[0].auth_subject;
  await store.approve({...binding,revision:3,guardId:'device-guard',vendorId:'device-vendor',siteId:'device-site',authSubject:subject},context);
  const refresh=openLocalOpsRefresh({mode:'local',config:{API_URL:'http://127.0.0.1:55321',SERVICE_ROLE_KEY:'synthetic.test.key'},directory:new PostgresGuardDirectory({client:pool}),sync:new PostgresOpsAssignmentSync(new PostgresDeviceAssignments(pool)),fetchImpl:async()=>Response.json([{id:binding.opsShiftId,scheduled_start:'2026-10-23T12:00:00Z',scheduled_end:'2026-10-23T20:00:00Z',updated_at:'2026-10-23T10:00:00Z',status:'scheduled'}])});
  try{assert.equal((await refresh.run()).processed,1);}finally{await refresh.close();}
  await admin.query("INSERT INTO mercury_guard.ops_bindings SELECT 'capacity-'||n,1,jsonb_build_object('opsShiftId','capacity-'||n,'revision',1) FROM generate_series(1,998) n");
  const capacity=await Promise.allSettled(['capacity-last-a','capacity-last-b'].map(opsShiftId=>store.approve({...binding,opsShiftId},context)));
  assert.equal(capacity.filter(x=>x.status==='fulfilled').length,1);
  assert.equal((await store.list()).length,1000);
  console.log('PASS: shared Ops approvals, concurrent exact retry, immutable audit, rollback and concurrent capacity limit');
 }finally{await pool.end();}
}
