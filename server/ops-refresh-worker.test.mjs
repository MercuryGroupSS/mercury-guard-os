import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LocalDeviceAssignments} from './local-device-assignments.mjs';
import {LocalGuardDirectory} from './local-guard-directory.mjs';
import {OpsAssignmentSync} from './ops-assignment-sync.mjs';
import {createOpsRefreshWorker} from './ops-refresh-worker.mjs';
const shift={id:'upstream',updated_at:'2026-10-23T10:00:00Z',scheduled_start:'2026-10-23T12:00:00Z',scheduled_end:'2026-10-23T20:00:00Z',status:'scheduled'};
const binding={opsShiftId:'upstream',guardId:'guard',vendorId:'vendor',siteId:'site',authSubject:'subject',revision:1,active:true};
function fixture(){const devices=new LocalDeviceAssignments(':memory:'),directory=new LocalGuardDirectory(':memory:');directory.addVendor({vendorId:'vendor',kind:'company',active:true});directory.addGuard({guardId:'guard',vendorId:'vendor',authSubject:'subject',active:true});return {devices,directory,sync:new OpsAssignmentSync(devices),close(){devices.close();directory.close();}};}
test('worker composes approved mapping, roster validation and transactional cancellation; missing rows preserve state',async()=>{
 const f=fixture();let rows=[shift];const worker=createOpsRefreshWorker({...f,loadBindings:async()=>[binding],readShifts:async()=>({rows})});
 try{
  assert.equal((await worker.run()).processed,1);
  rows=[];assert.equal((await worker.run()).missing,1);
  assert.equal(JSON.parse(f.devices.db.prepare('SELECT body FROM assignments').get().body).active,true);
  rows=[{...shift,updated_at:'2026-10-23T10:01:00Z',status:'cancelled'}];assert.equal((await worker.run()).processed,1);
  assert.equal(JSON.parse(f.devices.db.prepare('SELECT body FROM assignments').get().body).active,false);
  f.directory.setVendorActive('vendor',false);assert.equal((await worker.run()).failed,1);
 }finally{f.close();}
});
test('changed approvals and stopping an in-flight read prevent activation; concurrent calls coalesce',async()=>{
 const f=fixture();let approve=[binding],release;
 const worker=createOpsRefreshWorker({...f,loadBindings:async()=>approve,readShifts:()=>new Promise(r=>{release=r;})});
 try{
  const first=worker.run();assert.equal(worker.run(),first);await new Promise(r=>setImmediate(r));approve=[{...binding,active:false,revision:2}];release({rows:[shift]});assert.equal((await first).changedMappings,1);
  assert.equal(f.devices.db.prepare('SELECT count(*) n FROM assignments').get().n,0);
  approve=[binding];const pending=worker.run();await new Promise(r=>setImmediate(r));worker.stop();release({rows:[shift]});await pending;
  assert.equal(f.devices.db.prepare('SELECT count(*) n FROM assignments').get().n,0);
 }finally{f.close();}
});
test('approved revocation works without upstream access and stale snapshots cannot restore access',async()=>{
 const f=fixture();let approved=[binding],reads=0;
 const worker=createOpsRefreshWorker({...f,loadBindings:async()=>approved,readShifts:async()=>{reads++;if(reads>1)throw Error('offline');return {rows:[shift]};}});
 try{
  assert.equal((await worker.run()).processed,1);
  approved=[{...binding,active:false,revision:2}];assert.equal((await worker.run()).processed,1);assert.equal(reads,1);
  assert.equal(JSON.parse(f.devices.db.prepare('SELECT body FROM assignments').get().body).active,false);
  assert.throws(()=>f.sync.apply(shift,binding),/Revoked/);
  assert.throws(()=>f.sync.apply(shift,{...binding,revision:2}),/Revoked/);
  assert.equal(f.sync.apply(shift,{...binding,revision:3}).status,'assignment_created');
  assert.throws(()=>f.sync.revokeBinding(approved[0]),/Stale/);
 }finally{f.close();}
});

test('async synchronization failures are counted and not reported as successful',async()=>{
 const f=fixture();let approved=[binding],rejectApply=true;
 const sync={apply:async(...args)=>{if(rejectApply)throw Error('Database unavailable');return f.sync.apply(...args);},revokeBinding:async()=>{throw Error('Database unavailable');}};
 const worker=createOpsRefreshWorker({...f,sync,loadBindings:async()=>approved,readShifts:async()=>({rows:[shift]})});
 try{
  let result=await worker.run();assert.equal(result.failed,1);assert.equal(result.processed,0);
  rejectApply=false;result=await worker.run();assert.equal(result.processed,1);assert.equal(result.failed,0);
  approved=[{...binding,revision:2,active:false}];result=await worker.run();assert.equal(result.failed,1);assert.equal(result.processed,0);
 }finally{await worker.stop();f.close();}
});

test('shutdown drains an in-flight synchronization and does not begin the next item',async()=>{
 const f=fixture();let release,applied=0,callback,cancelled=false;
 const other={...binding,opsShiftId:'upstream-two'};
 const sync={revokeBinding:async()=>{},apply:()=>{applied++;return new Promise(resolve=>{release=resolve;});}};
 const worker=createOpsRefreshWorker({...f,sync,loadBindings:async()=>[binding,other],readShifts:async()=>({rows:[shift,{...shift,id:other.opsShiftId}]}),schedule:fn=>{callback=fn;return 1;},cancel:()=>{cancelled=true;}});
 try{
  worker.start();const pending=worker.run();await new Promise(resolve=>setImmediate(resolve));assert.equal(applied,1);
  let stopped=false;const stopping=worker.stop().then(()=>{stopped=true;});await Promise.resolve();assert.equal(stopped,false);assert.equal(cancelled,true);
  release({status:'assignment_created'});await stopping;const result=await pending;
  assert.equal(result.processed,1);assert.equal(applied,1);assert.equal(worker.status().inflight,false);
  await callback();assert.equal(applied,1);
 }finally{await worker.stop();f.close();}
});
