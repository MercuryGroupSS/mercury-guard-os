import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {PostgresDeviceAssignments} from '../postgres-device-assignments.mjs';
import {PostgresDashboardBindings,PostgresDashboardOutbox} from '../postgres-dashboard-delivery.mjs';
import {createDashboardInboxHandler} from '../dashboard-inbox.mjs';
import {PostgresDashboardInbox} from '../postgres-dashboard-inbox.mjs';
import {ReceiverMappingOwner} from '../receiver-mapping-owner.mjs';
import {createDashboardRouter} from '../dashboard-router.mjs';
import {deliverDashboardOnce} from '../dashboard-delivery.mjs';
export async function verifyPostgresDashboard(connectionString,admin){
 const pool=new Pool({connectionString,max:4,query_timeout:5000,statement_timeout:5000,options:'-c role=service_role'});let server,inbox,handler,receiverPool,ownerPool,receiverCreated=false;
 const receiverName='mercury_receiver_verify_'+randomUUID().replaceAll('-',''),receiverUrl=new URL(connectionString);receiverUrl.pathname='/'+receiverName;
 const receiverOptions={connectionString:receiverUrl.toString(),max:4,query_timeout:5000,statement_timeout:5000};
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
  // The actual HTTP destination has its own database and approval ledger.
  await admin.query('CREATE DATABASE '+receiverName);receiverCreated=true;ownerPool=new Pool(receiverOptions);
  await ownerPool.query(readFileSync(new URL('../../supabase/migrations/20261023222717_guard_dashboard_receiver.sql',import.meta.url),'utf8'));
  await ownerPool.query("CREATE SCHEMA billing;CREATE TABLE public.shifts(id text);INSERT INTO public.shifts VALUES('untouched');CREATE TABLE public.guard_checkins(id text);INSERT INTO public.guard_checkins VALUES('untouched');CREATE TABLE billing.vendors(id text);INSERT INTO billing.vendors VALUES('untouched')");
  const owner=new ReceiverMappingOwner(ownerPool),approval={requestId:randomUUID(),mapping,operator:'synthetic-test-owner',reason:'Approve the isolated delivery destination'};
  assert.equal((await owner.review(approval)).current,null);assert.equal((await ownerPool.query('SELECT count(*)::int n FROM mercury_guard_receiver.mapping_history')).rows[0].n,0);
  const approved=await Promise.all([owner.approve(approval),owner.approve(approval)]);assert.deepEqual(approved[0],approved[1]);
  await assert.rejects(owner.approve({...approval,reason:'Different request contents'}),/conflict/);
  receiverPool=new Pool({...receiverOptions,options:'-c role=service_role'});inbox=new PostgresDashboardInbox(receiverPool);
  const token='synthetic-only-dashboard-token-'.repeat(3);handler=createDashboardInboxHandler({token,destination:mapping.destination,inbox,loadMapping:scope=>inbox.get(scope)});
  server=createServer(async(req,res)=>{try{const response=await handler(new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers,body:Readable.toWeb(req),duplex:'half'}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());}catch{res.writeHead(500);res.end();}});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const send=createDashboardRouter({destinations:[{destination:mapping.destination,endpoint:`http://127.0.0.1:${server.address().port}/v1/mercury-one/observations`,token}],allowLocal:true});
  const receipt=await send(ready);await receiverPool.end();receiverPool=new Pool({...receiverOptions,options:'-c role=service_role'});inbox=new PostgresDashboardInbox(receiverPool);handler=createDashboardInboxHandler({token,destination:mapping.destination,inbox,loadMapping:scope=>inbox.get(scope)});
  const retries=await Promise.all(Array.from({length:8},()=>send(ready)));for(const r of retries)assert.deepEqual(r,receipt);await second.accepted(ready,receipt);assert.equal(await first.claim(200000),null);assert.equal((await ownerPool.query('SELECT count(*)::int n FROM mercury_guard_receiver.observations')).rows[0].n,1);
  const value=JSON.parse(ready.body),changed=structuredClone(value);changed.observation.data.description='Altered retry';await assert.rejects(inbox.accept(changed,JSON.stringify(changed)),/conflict/);
  await assert.rejects(inbox.accept({...value,guard_id:'someone-else'},ready.body));
  await assert.rejects(new ReceiverMappingOwner(receiverPool).approve({...approval,requestId:randomUUID(),mapping:{...mapping,revision:2}}),/owner/);
  await assert.rejects(receiverPool.query("UPDATE mercury_guard_receiver.observations SET raw_body='changed'"),/permission denied/);await assert.rejects(receiverPool.query('DELETE FROM mercury_guard_receiver.observations'),/permission denied/);await assert.rejects(receiverPool.query('UPDATE mercury_guard_receiver.bindings SET active=false'),/permission denied/);await assert.rejects(receiverPool.query('DELETE FROM mercury_guard_receiver.mapping_history'),/permission denied/);
  for(const role of ['anon','authenticated'])assert.equal((await ownerPool.query('SELECT has_schema_privilege($1,\'mercury_guard_receiver\',\'USAGE\') AS allowed',[role])).rows[0].allowed,false);
  // Revocation between the HTTP mapping read and the storage transaction must
  // deny even an exact retry of a previously accepted event.
  let entered,release;const beforeCommit=new Promise(r=>{entered=r;}),proceed=new Promise(r=>{release=r;});
  const delayed=createDashboardInboxHandler({token,destination:mapping.destination,loadMapping:scope=>inbox.get(scope),inbox:{accept:async(v,raw)=>{entered();await proceed;return inbox.accept(v,raw);}}});
  const pending=delayed(new Request('http://127.0.0.1/v1/mercury-one/observations',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:ready.body}));await beforeCommit;
  const revoked={...approval,requestId:randomUUID(),mapping:{...mapping,revision:2,active:false}};await owner.approve(revoked);release();assert.equal((await pending).status,400);await assert.rejects(send(ready));assert.deepEqual(await owner.approve(approval),approved[0]);assert.equal((await inbox.get(mapping)).active,false);
  await ownerPool.query("CREATE FUNCTION mercury_guard_receiver.fail_mapping_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic receiver mapping failure'; END $$;CREATE TRIGGER fail_mapping_fixture BEFORE UPDATE ON mercury_guard_receiver.bindings FOR EACH ROW EXECUTE FUNCTION mercury_guard_receiver.fail_mapping_fixture()");
  try{await assert.rejects(owner.approve({...approval,requestId:randomUUID(),mapping:{...mapping,revision:3}}));assert.equal((await inbox.get(mapping)).revision,2);assert.equal((await ownerPool.query('SELECT count(*)::int n FROM mercury_guard_receiver.mapping_history')).rows[0].n,2);}finally{await ownerPool.query('DROP TRIGGER fail_mapping_fixture ON mercury_guard_receiver.bindings;DROP FUNCTION mercury_guard_receiver.fail_mapping_fixture()');}
  const sentinels=(await ownerPool.query("SELECT (SELECT id FROM public.shifts) AS shifts,(SELECT id FROM public.guard_checkins) AS checkins,(SELECT id FROM billing.vendors) AS vendors")).rows[0];assert.deepEqual(sentinels,{shifts:'untouched',checkins:'untouched',vendors:'untouched'});
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
  console.log('PASS: separate PostgreSQL sender/receiver databases, real HTTP receipts, restart/concurrent retry, immutable observations, independent owner approvals, revocation race and audit rollback; existing business tables untouched');
 }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await receiverPool?.end();await ownerPool?.end();if(receiverCreated){await admin.query('DROP DATABASE '+receiverName);console.log('PASS: isolated PostgreSQL receiver database removed');}await pool.end();}
}
