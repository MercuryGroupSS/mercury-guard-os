import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DurableIngest} from './durable-ingest.mjs';
import {DashboardOutbox} from './dashboard-delivery.mjs';
import {DashboardBindings,createDashboardBridge} from './dashboard-bridge.mjs';
test('accepted records wait for explicit mapping; revocation blocks sends without dropping pending data',async()=>{
 const store=new DurableIngest(':memory:'),outbox=new DashboardOutbox(':memory:'),bindings=new DashboardBindings(':memory:');let sent=0,now=1000;
 try{
  const mapping={assignmentId:'a',guardId:'g',vendorId:'v',siteId:'s',dashboardShiftId:'upstream-shift',destination:'isolated-inbox',revision:1,active:true};
  const record={vendor_id:'v',scope:{assignment_id:'a',guard_id:'g',site_id:'s',device_thumbprint:'a'.repeat(64)},event:{event_id:randomUUID(),at:1000,kind:'incident',data:{description:'synthetic'}}};
  store.db.prepare('INSERT INTO events(device,id,sequence,digest,body) VALUES(?,?,?,?,?)').run(record.scope.device_thumbprint,record.event.event_id,1,'test',JSON.stringify(record));
  const bridge=createDashboardBridge({store,outbox,bindings});assert.equal((await bridge.run()).projected,0);assert.equal(outbox.db.prepare('SELECT count(*) AS n FROM dashboard_outbox').get().n,0);
  bindings.approve(mapping);assert.equal((await bridge.run()).delivery,'disabled');assert.equal(outbox.db.prepare('SELECT count(*) AS n FROM dashboard_outbox').get().n,1);
  const sender=createDashboardBridge({store,outbox,bindings,now:()=>now,send:async job=>{sent++;throw Error('offline');}});
  assert.equal((await sender.run()).delivery,'pending');assert.equal(sent,1);
  bindings.approve({...mapping,revision:2,active:false});now=10000;
  assert.equal((await sender.run()).delivery,'pending');assert.equal(sent,1);
  assert.equal(outbox.db.prepare('SELECT status FROM dashboard_outbox').get().status,'pending');
  assert.throws(()=>bindings.approve(mapping));assert.equal(store.count(),1);
 }finally{store.close();outbox.close();bindings.close();}
});

test('confirmed attendance enters mapped queue once and preserves server times and early-exit reason',async()=>{
 const {ShiftLifecycle}=await import('./shift-lifecycle.mjs');const shiftLifecycle=new ShiftLifecycle(':memory:'),store=new DurableIngest(':memory:'),outbox=new DashboardOutbox(':memory:'),bindings=new DashboardBindings(':memory:');
 try{
  const mapping={assignmentId:'a',guardId:'g',vendorId:'v',siteId:'s',dashboardShiftId:'upstream-shift',destination:'isolated-inbox',revision:1,active:true};
  const scope={identity:{subject:'u',guardId:'g',vendorId:'v'},assignment:{assignmentId:'a',guardId:'g',vendorId:'v',siteId:'s',startsAt:1000,endsAt:10000,active:true},deviceThumbprint:'a'.repeat(64)};
  const start={...scope,request:{request_id:'start',action:'start',confirmed:true,reason:''},now:2000};shiftLifecycle.transition(start);shiftLifecycle.transition({...start,now:3000});
  shiftLifecycle.transition({...scope,request:{request_id:'end',action:'end',confirmed:true,reason:'Synthetic early exit'},now:5000});
  const bridge=createDashboardBridge({store,outbox,bindings,shiftLifecycle,batchSize:1});await bridge.run();await bridge.run();assert.equal(outbox.db.prepare('SELECT count(*) AS n FROM dashboard_outbox').get().n,0);
  bindings.approve(mapping);for(let i=0;i<6;i++)await bridge.run();
  const rows=outbox.db.prepare('SELECT body FROM dashboard_outbox ORDER BY rowid').all().map(r=>JSON.parse(r.body));assert.equal(rows.length,2);
  const begin=rows.find(r=>r.observation.kind==='shift_start'),end=rows.find(r=>r.observation.kind==='shift_end');
  assert.equal(begin.observation.occurred_at_ms,2000);assert.equal(end.observation.occurred_at_ms,5000);assert.equal(end.observation.data.reason,'Synthetic early exit');assert.equal(end.observation.data.early_exit,true);assert.equal(end.vendor_id,'v');assert.equal(bridge.status().delivery,'disabled');
  assert.equal(store.count(),0);
 }finally{shiftLifecycle.close();store.close();outbox.close();bindings.close();}
});
