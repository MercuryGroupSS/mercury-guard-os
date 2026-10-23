import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {PostgresDeviceAssignments} from '../postgres-device-assignments.mjs';
import {PostgresShiftLifecycle} from '../postgres-shift-lifecycle.mjs';
import {ShiftTransitionRejected} from '../shift-lifecycle.mjs';
export async function verifyPostgresShifts(connectionString,admin){
 const pool=new Pool({connectionString,max:4,options:'-c role=service_role'});
 try{
  const devices=new PostgresDeviceAssignments(pool),shifts=new PostgresShiftLifecycle(devices),now=Date.now();
  const guard=(await admin.query("SELECT auth_subject FROM mercury_guard.guards WHERE guard_id='device-guard'")).rows[0];
  const identity={subject:guard.auth_subject,guardId:'device-guard',vendorId:'device-vendor'},thumb=(await devices.device('personal-phone')).thumbprint;
  const assignment={assignmentId:'pg-shift',guardId:identity.guardId,vendorId:identity.vendorId,siteId:'device-site',startsAt:now-1000,endsAt:now+60000,active:true};
  await devices.assign(assignment);await devices.assign({...assignment,assignmentId:'pg-shift-two'});
  const scope={identity,assignment,deviceThumbprint:thumb},request={action:'start',request_id:'pg-start',confirmed:true,reason:''};
  const started=await Promise.all([shifts.transition({...scope,request,now}),shifts.transition({...scope,request,now:now+1})]);assert.deepEqual(started[0],started[1]);
  await assert.rejects(shifts.transition({...scope,request:{...request,reason:'changed'},now}),/request changed/);
  await assert.rejects(shifts.transition({...scope,assignment:{...assignment,assignmentId:'pg-shift-two'},request:{...request,request_id:'pg-conflict'},now}),e=>e instanceof ShiftTransitionRejected&&e.receipt.code==='active_shift_conflict');
  const restarted=new PostgresShiftLifecycle(devices);assert.equal((await restarted.snapshot({...identity,siteId:assignment.siteId,assignmentId:assignment.assignmentId,deviceThumbprint:thumb})).state,'active');
  assert.equal(await restarted.permitsCapture({...identity,siteId:assignment.siteId,assignmentId:assignment.assignmentId,deviceThumbprint:thumb},now),true);
  const badEnd={...scope,request:{action:'end',request_id:'pg-end-bad',confirmed:true,reason:''},now:now+10};let rejection;
  try{await shifts.transition(badEnd);}catch(e){assert.ok(e instanceof ShiftTransitionRejected);rejection=e.receipt;}
  assert.equal(rejection.code,'early_exit_reason_required');
  await assert.rejects(restarted.transition({...badEnd,now:now+20}),e=>{assert.deepEqual(e.receipt,rejection);return true;});
  const ending={...scope,request:{action:'end',request_id:'pg-end',confirmed:true,reason:'Synthetic early exit'},now:now+100,allowStart:false};
  const ended=await restarted.transition(ending);assert.equal(ended.early_exit,true);
  assert.deepEqual(await restarted.transition({...scope,request,now:now+200,allowStart:false}),started[0]);
  assert.equal(await restarted.permitsCapture({...identity,siteId:assignment.siteId,assignmentId:assignment.assignmentId,deviceThumbprint:thumb},now+99),true);
  assert.equal(await restarted.permitsCapture({...identity,siteId:assignment.siteId,assignmentId:assignment.assignmentId,deviceThumbprint:thumb},now+100),false);
  assert.deepEqual(await restarted.checkInWindow(assignment),{startsAt:now,endsAt:now+100});
  assert.equal((await restarted.dashboardAfter(0,20)).length,2);
  await devices.assign({...assignment,assignmentId:'pg-shift-three'});
  const competing=await Promise.allSettled(['pg-shift-two','pg-shift-three'].map((assignmentId,i)=>shifts.transition({...scope,assignment:{...assignment,assignmentId},request:{...request,request_id:'pg-compete-'+i},now:now+200})));
  assert.equal(competing.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(competing.filter(r=>r.status==='rejected'&&r.reason instanceof ShiftTransitionRejected&&r.reason.receipt.code==='active_shift_conflict').length,1);
  await devices.assign({...assignment,assignmentId:'pg-shift-cancelled'});await devices.cancel('pg-shift-cancelled');
  await assert.rejects(shifts.transition({...scope,assignment:{...assignment,assignmentId:'pg-shift-cancelled'},request:{...request,request_id:'pg-cancel-race'},now:now+200}),e=>e instanceof ShiftTransitionRejected&&e.receipt.code==='shift_cannot_start');
  await assert.rejects(pool.query('DELETE FROM mercury_guard.shift_transitions'),/permission denied/);
  await assert.rejects(pool.query('UPDATE mercury_guard.shift_sessions SET clocked_in=clocked_in+1'),/permission denied/);
  await assert.rejects(admin.query("INSERT INTO mercury_guard.shift_sessions SELECT 'pg-shift-two',guard,vendor,site,device,starts_at,ends_at,clocked_in,clocked_in-1,'invalid' FROM mercury_guard.shift_sessions WHERE assignment='pg-shift'"),/check constraint/);
  console.log('PASS: PostgreSQL confirmed shifts, concurrent retry, active-shift conflict, durable rejections, cancelled closeout and capture cutoff');
 }finally{await pool.end();}
}
