import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Pool} from 'pg';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {PostgresDeviceAssignments} from '../postgres-device-assignments.mjs';
import {PostgresDashboardBindings,PostgresDashboardOutbox} from '../postgres-dashboard-delivery.mjs';
import {DashboardInbox,createDashboardInboxHandler} from '../dashboard-inbox.mjs';
import {createDashboardTransport,deliverDashboardOnce} from '../dashboard-delivery.mjs';
export async function verifyPostgresDashboard(connectionString,admin){
 const pool=new Pool({connectionString,max:4,query_timeout:5000,statement_timeout:5000,options:'-c role=service_role'});let server,inbox,folder,handler;
 try{
  const devices=new PostgresDeviceAssignments(pool),bindings=new PostgresDashboardBindings(devices),first=new PostgresDashboardOutbox(devices),second=new PostgresDashboardOutbox(devices);
  const record=(await admin.query("SELECT body FROM mercury_guard.ingested_events WHERE assignment_id='events-shift' AND body#>>'{event,kind}'='incident'")).rows[0].body;
  const mapping={assignmentId:record.scope.assignment_id,guardId:record.scope.guard_id,vendorId:record.vendor_id,siteId:record.scope.site_id,dashboardShiftId:'synthetic-upstream',destination:'isolated-inbox',revision:1,active:true};
  const approvals=await Promise.allSettled([bindings.approve(mapping),bindings.approve(mapping)]);assert.equal(approvals.filter(r=>r.status==='fulfilled').length,1);
  const ids=await Promise.all([first.enqueue(record,mapping),second.enqueue(record,mapping)]);assert.equal(ids[0],ids[1]);
  const claimed=await Promise.all([first.claim(1000),second.claim(1000)]);assert.equal(claimed.filter(Boolean).length,1);const old=claimed.find(Boolean);
  const job=await new PostgresDashboardOutbox(devices).claim(121000);assert.equal(job.id,old.id);assert.notEqual(job.lease,old.lease);
  const expected={delivery_id:job.id,destination:mapping.destination,payload_sha256:job.hash,status:'stored_in_integration_inbox'};
  await assert.rejects(first.accepted(old,expected));assert.equal(await first.retry(old,122000),false);
  await assert.rejects(first.accepted({...job,body:'changed'},expected));
  await assert.rejects(first.accepted(job,{...expected,status:'ok'}));
  assert.equal(await second.retry(job,122000),true);assert.equal(await first.claim(123000),null);const ready=await first.claim(126000);assert.equal(ready.body,job.body);
  folder=mkdtempSync(join(tmpdir(),'mercury-dashboard-receiver-'));const inboxPath=join(folder,'inbox.sqlite');inbox=new DashboardInbox(inboxPath);const token='synthetic-only-dashboard-token-'.repeat(3);handler=createDashboardInboxHandler({token,destination:mapping.destination,inbox,loadMapping:async()=>mapping});
  server=createServer(async(req,res)=>{try{const response=await handler(new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers,body:Readable.toWeb(req),duplex:'half'}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());}catch{res.writeHead(500);res.end();}});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const send=createDashboardTransport({endpoint:`http://127.0.0.1:${server.address().port}/v1/mercury-one/observations`,token,allowLocal:true});
  const receipt=await send(ready);inbox.close();inbox=new DashboardInbox(inboxPath);handler=createDashboardInboxHandler({token,destination:mapping.destination,inbox,loadMapping:async()=>mapping});assert.deepEqual(await send(ready),receipt);await second.accepted(ready,receipt);assert.equal(await first.claim(200000),null);assert.equal(inbox.db.prepare('SELECT count(*) n FROM mercury_one_inbox').get().n,1);
  const photo=(await admin.query("SELECT body FROM mercury_guard.ingested_events WHERE assignment_id='events-shift' AND body#>>'{event,kind}'='photo_evidence'")).rows[0].body;
  const photoId=await first.enqueue(photo,mapping);
  const spare=(await admin.query("SELECT body FROM mercury_guard.ingested_events WHERE assignment_id='check-in-shift' AND body#>>'{event,kind}'='photo_evidence' LIMIT 1")).rows[0].body;
  const spareMapping={...mapping,assignmentId:spare.scope.assignment_id,guardId:spare.scope.guard_id,vendorId:spare.vendor_id,siteId:spare.scope.site_id};await bindings.approve(spareMapping);const spareId=await first.enqueue(spare,spareMapping),ordered=[photoId,spareId].sort();
  await admin.query('BEGIN');try{await admin.query('SELECT 1 FROM mercury_guard.dashboard_outbox WHERE id=$1 FOR UPDATE',[ordered[0]]);assert.equal((await second.claim(200000)).id,ordered[1]);}finally{await admin.query('ROLLBACK');}
  await bindings.approve({...spareMapping,revision:2,active:false});
  await bindings.approve({...mapping,revision:2,active:false});let sends=0;
  assert.equal(await deliverDashboardOnce(second,async()=>{sends++;throw Error('Must not send');},()=>200000),'idle');assert.equal(sends,0);
  assert.equal((await admin.query('SELECT status FROM mercury_guard.dashboard_outbox WHERE id=$1',[photoId])).rows[0].status,'pending');
  await bindings.approve({...mapping,revision:3,destination:'another-isolated',dashboardShiftId:'new-synthetic-upstream'});
  await assert.rejects(first.enqueue(photo,{...mapping,revision:3,destination:'another-isolated',dashboardShiftId:'new-synthetic-upstream'}),/attribution/);
  await assert.rejects(pool.query("UPDATE mercury_guard.dashboard_outbox SET body='changed'"),/permission denied/);await assert.rejects(pool.query('DELETE FROM mercury_guard.dashboard_mapping_history'),/permission denied/);
  await admin.query("CREATE FUNCTION mercury_guard.fail_mapping_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic mapping failure'; END $$;CREATE TRIGGER fail_mapping_fixture BEFORE UPDATE ON mercury_guard.dashboard_bindings FOR EACH ROW EXECUTE FUNCTION mercury_guard.fail_mapping_fixture()");
  try{await assert.rejects(bindings.approve({...mapping,revision:4}));assert.equal((await bindings.get(mapping)).revision,3);assert.equal((await admin.query('SELECT count(*)::int n FROM mercury_guard.dashboard_mapping_history WHERE assignment_id=\'events-shift\'')).rows[0].n,3);}finally{await admin.query('DROP TRIGGER fail_mapping_fixture ON mercury_guard.dashboard_bindings;DROP FUNCTION mercury_guard.fail_mapping_fixture()');}
  await first.bridgeState.save('events',123);assert.equal(await second.bridgeState.get('events'),123);
  console.log('PASS: shared delivery leases, immutable retries, mapping revocation/audit rollback and real isolated HTTP receipts');
 }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}inbox?.close();if(folder)rmSync(folder,{recursive:true,force:true});await pool.end();}
}
