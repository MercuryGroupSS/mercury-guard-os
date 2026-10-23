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
