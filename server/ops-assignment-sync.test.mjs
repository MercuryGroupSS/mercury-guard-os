import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LocalDeviceAssignments} from './local-device-assignments.mjs';
import {OpsAssignmentSync} from './ops-assignment-sync.mjs';
const shift={id:'upstream',updated_at:'2026-10-23T10:00:00Z',scheduled_start:'2026-10-23T12:00:00Z',scheduled_end:'2026-10-23T20:00:00Z',status:'scheduled'};
const binding={opsShiftId:'upstream',guardId:'guard',vendorId:'vendor',siteId:'site',revision:1,active:true};
test('source refresh preserves scope, schedule replacement retains cancelled original and stale rows cannot restore it',()=>{
 const devices=new LocalDeviceAssignments(':memory:'),sync=new OpsAssignmentSync(devices);
 const row=id=>JSON.parse(devices.db.prepare('SELECT body FROM assignments WHERE id=?').get(id).body);
 try{
  const first=sync.apply(shift,binding);assert.equal(first.status,'assignment_created');
  assert.equal(sync.apply(shift,binding).status,'unchanged');
  const refresh={...shift,updated_at:'2026-10-23T10:01:00Z',status:'late'};
  assert.equal(sync.apply(refresh,binding).assignmentId,first.assignmentId);
  const changed={...refresh,updated_at:'2026-10-23T10:02:00Z',scheduled_end:'2026-10-23T21:00:00Z'};
  const next=sync.apply(changed,binding);assert.notEqual(next.assignmentId,first.assignmentId);
  assert.equal(row(first.assignmentId).active,false);assert.equal(row(first.assignmentId).endsAt,Date.parse(shift.scheduled_end));assert.equal(row(next.assignmentId).active,true);
  assert.throws(()=>sync.apply(shift,binding),/Stale/);
  const cancelled={...changed,updated_at:'2026-10-23T10:03:00Z',status:'cancelled'};sync.apply(cancelled,binding);assert.equal(row(next.assignmentId).active,false);
  assert.throws(()=>sync.apply({...cancelled,status:'scheduled'},binding),/Conflicting/);
  assert.throws(()=>sync.apply({...cancelled,status:'scheduled'},{...binding,revision:2}),/Conflicting/);
  assert.throws(()=>sync.apply({...cancelled,updated_at:'2026-10-23T10:04:00Z'},{...binding,guardId:'other'}),/Conflicting/);
  const reopened=sync.apply({...cancelled,updated_at:'2026-10-23T10:04:00Z',status:'scheduled'},binding);assert.notEqual(reopened.assignmentId,next.assignmentId);
  assert.equal(devices.db.prepare('SELECT count(*) n FROM ops_assignment_history').get().n,5);
 }finally{devices.close();}
});
test('failed replacement rolls back cancellation and sync history together',()=>{
 const d=new LocalDeviceAssignments(':memory:'),sync=new OpsAssignmentSync(d);
 try{
  const first=sync.apply(shift,binding);
  assert.throws(()=>sync.apply({...shift,updated_at:'2026-10-23T10:01:00Z'},{...binding,revision:2,checkInPolicy:{invalid:true}}));
  assert.equal(JSON.parse(d.db.prepare('SELECT body FROM assignments WHERE id=?').get(first.assignmentId).body).active,true);
  assert.equal(d.db.prepare('SELECT count(*) n FROM ops_assignment_history').get().n,1);
  assert.throws(()=>sync.apply(shift,{...binding,opsShiftId:'other'}));
 }finally{d.close();}
});
