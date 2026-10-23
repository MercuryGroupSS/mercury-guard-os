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
test('scheduler detects deadlines without a handset request and repeated ticks preserve misses',()=>{
 const f=setup();let callback,cancelled=false,now=5000;
 try{
  f.assign('a');const worker=createCheckInWorker({...f,now:()=>now,schedule:fn=>{callback=fn;return 7},cancel:id=>{assert.equal(id,7);cancelled=true}});
  worker.start();assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM missed_check_ins').get().n,0);
  now=11000;callback();assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM missed_check_ins').get().n,1);
  callback();assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM missed_check_ins').get().n,1);
  assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM check_in_alert_outbox WHERE status='pending'").get().n,1);
  worker.stop();assert.equal(cancelled,true);assert.equal(worker.status().running,false);
 }finally{f.close();}
});
test('bounded sweeps resume their cursor and finalize ended assignments without duplicate misses',()=>{
 const f=setup();try{
  f.assign('a');f.assign('b');f.assign('c');f.devices.cancel('b');
  const options={...f,now:()=>200000,batchSize:1};
  assert.equal(createCheckInWorker(options).run().processed,1);
  assert.equal(createCheckInWorker(options).run().processed,0); // cancelled b, not a again
  assert.equal(createCheckInWorker(options).run().processed,1);
  const worker=createCheckInWorker(options);worker.run();worker.run();
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM missed_check_ins').get().n,4);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM check_in_worker_runs WHERE finalized=1').get().n,2);
 }finally{f.close();}
});
test('failed schedule does not starve other assignments or become marked successful',()=>{
 const f=setup();try{
  f.assign('a');f.assign('b');
  f.devices.db.prepare("UPDATE assignments SET body=json_set(body,'$.checkInPolicy.interval_ms',0) WHERE id='a'").run();
  const worker=createCheckInWorker({...f,now:()=>11000});const result=worker.run();
  assert.equal(result.failed,1);assert.equal(result.processed,1);
  assert.equal(f.store.db.prepare('SELECT assignment FROM check_in_worker_runs').get().assignment,'b');
  assert.equal(worker.run().failed,1);
 }finally{f.close();}
});

test('real timer records a newly elapsed deadline and stops cleanly',async()=>{
 const f=setup();let now=5000;const worker=createCheckInWorker({...f,now:()=>now,intervalMs:1000});
 try{
  f.assign('timer-shift');worker.start();now=11000;
  const stopAt=Date.now()+4000;
  while(f.store.db.prepare('SELECT count(*) AS n FROM missed_check_ins').get().n===0&&Date.now()<stopAt)await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM missed_check_ins').get().n,1);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM check_in_alert_outbox').get().n,1);
 }finally{worker.stop();f.close();}
});

test('worker uses confirmed shifts and stops generating future misses after early exit',async()=>{
 const {ShiftLifecycle}=await import('./shift-lifecycle.mjs');const f=setup(),shiftLifecycle=new ShiftLifecycle(':memory:');
 try{
  f.assign('a');let now=2000;const worker=createCheckInWorker({...f,shiftLifecycle,now:()=>now});worker.run();assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM missed_check_ins').get().n,0);
  const assignment=f.devices.scheduledAfter('',1)[0];
  const scope={identity:{subject:'user',guardId:'guard',vendorId:'vendor'},assignment,deviceThumbprint:'a'.repeat(64)};
  shiftLifecycle.transition({...scope,request:{action:'start',request_id:'start',confirmed:true,reason:''},now:3000});
  shiftLifecycle.transition({...scope,request:{action:'end',request_id:'end',confirmed:true,reason:'Synthetic early exit'},now:80000});
  now=130000;worker.run();
  const misses=f.store.db.prepare('SELECT slot FROM missed_check_ins').all();assert.deepEqual(misses.map(x=>x.slot),[1]);worker.run();assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM missed_check_ins').get().n,1);
 }finally{shiftLifecycle.close();f.close();}
});
