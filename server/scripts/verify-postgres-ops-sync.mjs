import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {PostgresDeviceAssignments} from '../postgres-device-assignments.mjs';
import {PostgresOpsAssignmentSync} from '../postgres-ops-assignment-sync.mjs';
export async function verifyPostgresOpsSync(connectionString,admin){
 const pool=new Pool({connectionString,max:4,options:'-c role=service_role'});
 try{
  const devices=new PostgresDeviceAssignments(pool),sync=new PostgresOpsAssignmentSync(devices);
  const shift={id:'pg-upstream',updated_at:'2026-10-23T10:00:00Z',scheduled_start:'2026-10-23T12:00:00Z',scheduled_end:'2026-10-23T20:00:00Z',status:'scheduled'};
  const binding={opsShiftId:shift.id,guardId:'device-guard',vendorId:'device-vendor',siteId:'device-site',revision:1,active:true};
  const results=await Promise.all([sync.apply(shift,binding),sync.apply(shift,binding)]);
  assert.deepEqual(results.map(r=>r.status).sort(),['assignment_created','unchanged']);
  const first=results[0].assignmentId;
  const read=async id=>(await admin.query('SELECT * FROM mercury_guard.assignments WHERE assignment_id=$1',[id])).rows[0];
  const count=async()=>(await admin.query('SELECT count(*)::int n FROM mercury_guard.ops_assignment_history WHERE source_id=$1',[shift.id])).rows[0].n;
  assert.equal(await count(),1);
  const changed={...shift,updated_at:'2026-10-23T10:01:00Z',scheduled_end:'2026-10-23T21:00:00Z'};
  await assert.rejects(sync.apply(changed,{...binding,revision:2,checkInPolicy:{invalid:true}}));
  assert.equal((await read(first)).active,true);assert.equal(await count(),1);
  const next=await sync.apply(changed,binding);assert.notEqual(next.assignmentId,first);assert.equal((await read(first)).active,false);
  assert.equal(Number((await read(first)).ends_at_ms),Date.parse(shift.scheduled_end));
  await assert.rejects(sync.apply(shift,binding),/Stale/);
  await assert.rejects(sync.apply({...changed,status:'cancelled'},binding),/Conflicting/);
  const disabled={...binding,revision:2,active:false};
  const race=await Promise.allSettled([sync.revokeBinding(disabled),sync.apply({...changed,updated_at:'2026-10-23T10:02:00Z'},binding)]);
  assert.equal(race[0].status,'fulfilled');assert.equal((await read(next.assignmentId)).active,false);
  await assert.rejects(sync.apply(changed,binding),/Revoked/);
  await assert.rejects(sync.apply(changed,{...binding,revision:2}),/Revoked/);
  const reopened=await new PostgresOpsAssignmentSync(devices).apply({...changed,updated_at:'2026-10-23T10:03:00Z'},{...binding,revision:3});
  assert.notEqual(reopened.assignmentId,next.assignmentId);
  await assert.rejects(sync.revokeBinding(disabled),/Stale/);
  assert.equal((await read(reopened.assignmentId)).active,true);
  await assert.rejects(pool.query('DELETE FROM mercury_guard.ops_assignment_history'),/permission denied/);
  await assert.rejects(pool.query("UPDATE mercury_guard.ops_assignment_history SET status='source_refreshed'"),/permission denied/);
  const privileges=(await admin.query("SELECT has_table_privilege('anon','mercury_guard.ops_assignment_sync','SELECT') a,has_table_privilege('authenticated','mercury_guard.ops_assignment_sync','SELECT') b")).rows[0];assert.equal(privileges.a,false);assert.equal(privileges.b,false);
  console.log('PASS: PostgreSQL Ops concurrency, transactional rollback, immutable history, stale-source and revocation protection');
 }finally{await pool.end();}
}
