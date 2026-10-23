import test from 'node:test';
import assert from 'node:assert/strict';
import { mapAssignment, projectObservation } from './ops-dashboard-adapter.mjs';
const shift = {id:'synthetic-shift', guard_name:'Same Name', site_name:'Demo', status:'scheduled', scheduled_start:'2026-10-22T12:00:00Z', scheduled_end:'2026-10-22T20:00:00Z', updated_at:'2026-10-22T10:00:00Z'};
const binding = {assignment_id:shift.id, guard_id:'guard-a', site_id:'site-a', auth_subject:'subject-a', active:true};
const event = {id:'event-a', assignment_id:shift.id, guard_id:'guard-a', site_id:'site-a', kind:'check_in', occurred_at:'2026-10-22T12:30:00Z'};
test('projects explicit identity and schedule without exposing roster names', () => {
 const a = mapAssignment(shift,binding); assert.equal(a.guard_id,'guard-a'); assert.equal(a.guard_name,undefined);
 assert.equal(projectObservation(event,a).source,'mercury_one'); assert.equal(shift.status,'scheduled');
});
test('names alone and inactive or mismatched bindings cannot authorize assignment',()=>{
 for(const b of [undefined,{...binding,active:false},{...binding,assignment_id:'other'},{...binding,auth_subject:''}]) assert.throws(()=>mapAssignment(shift,b));
});
test('completed and invalid schedules fail closed',()=>{
 for(const patch of [{status:'completed'},{scheduled_end:shift.scheduled_start},{scheduled_start:'yesterday'},{updated_at:null}]) assert.throws(()=>mapAssignment({...shift,...patch},binding));
});
test('each observation scope dimension must match',()=>{
 const a=mapAssignment(shift,binding); for(const key of ['assignment_id','guard_id','site_id']) assert.throws(()=>projectObservation({...event,[key]:'other'},a));
});
test('no unsupported kind, invalid timestamp or false delivery claim',()=>{
 const a=mapAssignment(shift,binding);
 assert.throws(()=>projectObservation({...event,kind:'whatsapp_reader'},a));
 assert.throws(()=>projectObservation({...event,occurred_at:null},a));
 assert.equal(projectObservation(event,a).delivery_status,'local_projection_only');
});
