import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DurableIngest} from './durable-ingest.mjs';
import {LocalDeviceAssignments} from './local-device-assignments.mjs';
import {createCheckInWorker} from './check-in-worker.mjs';
function setup(){
 const store=new DurableIngest(':memory:'),devices=new LocalDeviceAssignments(':memory:');
 function assign(id,startsAt=1000){devices.assign({assignmentId:id,guardId:'guard',vendorId:'vendor',siteId:'site',active:true,startsAt,endsAt:startsAt+120000,checkInPolicy:{revision:1,interval_ms:60000,window_ms:10000,max_evidence_age_ms:5000,max_accuracy_m:100}});}
 return {store,devices,assign,close(){store.close();devices.close();}};
}
test('scheduler detects deadlines without a handset request and repeated ticks preserve misses',async()=>{
 const f=setup();let callback,cancelled=false,now=5000;
 try{
  f.assign('a');const worker=createCheckInWorker({...f,now:()=>now,schedule:fn=>{callback=fn;return 7},cancel:id=>{assert.equal(id,7);cancelled=true}});
  await worker.start();assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM missed_check_ins').get().n,0);
  now=11000;await callback();assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM missed_check_ins').get().n,1);
  await callback();assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM missed_check_ins').get().n,1);
  assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM check_in_alert_outbox WHERE status='pending'").get().n,1);
  await worker.stop();assert.equal(cancelled,true);assert.equal(worker.status().running,false);
  now=80000;await callback();assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM missed_check_ins').get().n,1);
 }finally{f.close();}
});
test('bounded sweeps resume their cursor and finalize ended assignments without duplicate misses',async()=>{
 const f=setup();try{
  f.assign('a');f.assign('b');f.assign('c');f.devices.cancel('b');
  const options={...f,now:()=>200000,batchSize:1};
  assert.equal((await createCheckInWorker(options).run()).processed,1);
  assert.equal((await createCheckInWorker(options).run()).processed,0); // cancelled b, not a again
  assert.equal((await createCheckInWorker(options).run()).processed,1);
  const worker=createCheckInWorker(options);await worker.run();await worker.run();
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM missed_check_ins').get().n,4);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM check_in_worker_runs WHERE finalized=1').get().n,2);
 }finally{f.close();}
});
test('failed schedule does not starve other assignments or become marked successful',async()=>{
 const f=setup();try{
  f.assign('a');f.assign('b');
  f.devices.db.prepare("UPDATE assignments SET body=json_set(body,'$.checkInPolicy.interval_ms',0) WHERE id='a'").run();
  const worker=createCheckInWorker({...f,now:()=>11000});const result=await worker.run();
  assert.equal(result.failed,1);assert.equal(result.processed,1);
  assert.equal(f.store.db.prepare('SELECT assignment FROM check_in_worker_runs').get().assignment,'b');
  assert.equal((await worker.run()).failed,1);
 }finally{f.close();}
});

test('real timer records a newly elapsed deadline and stops cleanly',async()=>{
 const f=setup();let now=5000;const worker=createCheckInWorker({...f,now:()=>now,intervalMs:1000});
 try{
  f.assign('timer-shift');await worker.start();now=11000;
  const stopAt=Date.now()+4000;
  while(f.store.db.prepare('SELECT count(*) AS n FROM missed_check_ins').get().n===0&&Date.now()<stopAt)await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM missed_check_ins').get().n,1);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM check_in_alert_outbox').get().n,1);
 }finally{await worker.stop();f.close();}
});

test('worker uses confirmed shifts and stops generating future misses after early exit',async()=>{
 const {ShiftLifecycle}=await import('./shift-lifecycle.mjs');const f=setup(),shiftLifecycle=new ShiftLifecycle(':memory:');
 try{
  f.assign('a');let now=2000;const worker=createCheckInWorker({...f,shiftLifecycle,now:()=>now});await worker.run();assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM missed_check_ins').get().n,0);
  const assignment=f.devices.scheduledAfter('',1)[0];
  const scope={identity:{subject:'user',guardId:'guard',vendorId:'vendor'},assignment,deviceThumbprint:'a'.repeat(64)};
  shiftLifecycle.transition({...scope,request:{action:'start',request_id:'start',confirmed:true,reason:''},now:3000});
  shiftLifecycle.transition({...scope,request:{action:'end',request_id:'end',confirmed:true,reason:'Synthetic early exit'},now:80000});
  now=130000;await worker.run();
  const misses=f.store.db.prepare('SELECT slot FROM missed_check_ins').all();assert.deepEqual(misses.map(x=>x.slot),[1]);await worker.run();assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM missed_check_ins').get().n,1);
 }finally{shiftLifecycle.close();f.close();}
});

test('async reads coalesce and stop waits without applying stale work',async()=>{
 const f=setup();let release,reads=0;
 try{
  f.assign('a');const rows=f.devices.scheduledAfter('',20);
  const devices={scheduledAfter:()=>{reads++;return new Promise(resolve=>{release=resolve;});}};
  const worker=createCheckInWorker({store:f.store,devices,now:()=>11000});
  const first=worker.run(),second=worker.run();assert.equal(first,second);await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,1);
  let stopped=false;const stopping=worker.stop().then(()=>{stopped=true;});await Promise.resolve();assert.equal(stopped,false);
  release(rows);await stopping;await first;
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM missed_check_ins').get().n,0);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM check_in_worker_state').get().n,0);
  assert.equal(worker.status().inflight,false);
 }finally{f.close();}
});

test('async read failure preserves cursor and later sweep recovers',async()=>{
 const f=setup();let fail=true;
 try{
  f.assign('a');const devices={scheduledAfter:async(...args)=>{if(fail)throw Error('Unavailable');return f.devices.scheduledAfter(...args);}};
  const worker=createCheckInWorker({store:f.store,devices,now:()=>11000});
  await assert.rejects(worker.run());assert.equal(worker.status().totalFailures,1);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM check_in_worker_state').get().n,0);
  fail=false;assert.equal((await worker.run()).processed,1);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM missed_check_ins').get().n,1);
  await worker.stop();
 }finally{f.close();}
});
