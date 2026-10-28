import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
import {PostgresAdministration,AdminDeniedError} from '../postgres-administration.mjs';
import {PostgresDeviceAssignments} from '../postgres-device-assignments.mjs';
import {PostgresDashboardInbox} from '../postgres-dashboard-inbox.mjs';
import {ReceiverMappingOwner} from '../receiver-mapping-owner.mjs';
import {projectDashboardObservation} from '../dashboard-delivery.mjs';
import {createAdminHandler} from '../admin-handler.mjs';
import {createPostgresAuthSessionReader} from '../postgres-auth-session.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
export async function verifyPostgresReceivedReports(connectionString,owner){
 const pool=new Pool({connectionString,max:4,options:'-c role=service_role'}),ownerPool=new Pool({connectionString,max:2});
 try{
  const subject=randomUUID(),guardSubject=randomUUID(),sessionId=randomUUID();
  await owner.query('INSERT INTO auth.users(id,email) VALUES($1,$2),($3,$4)',[subject,'received-admin@example.invalid',guardSubject,'received-guard@example.invalid']);
  await owner.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)',[sessionId,subject]);
  await owner.query('INSERT INTO mercury_guard.admin_accounts(auth_subject,email,active) VALUES($1,$2,true)',[subject,'received-admin@example.invalid']);
  const devices=new PostgresDeviceAssignments(pool),admin=new PostgresAdministration({devices}),session={subject,sessionId,active:true,expiresAt:Math.floor(Date.now()/1000)+3600},ownerMapping=new ReceiverMappingOwner(ownerPool),inbox=new PostgresDashboardInbox(pool);
  const mapping={assignmentId:'received-assignment',guardId:'received-guard',vendorId:'received-company',siteId:'received-site',dashboardShiftId:'received-upstream',destination:'received-isolated',revision:1,active:true},device='c'.repeat(64),at=Date.now();
  const approve=async value=>ownerMapping.approve({mapping:value,requestId:randomUUID(),operator:'Synthetic verifier',reason:'Disposable received-report test'});
  await approve(mapping);
  const project=(kind,data,m=mapping,eventId=randomUUID(),thumbprint=device)=>projectDashboardObservation({vendor_id:m.vendorId,scope:{assignment_id:m.assignmentId,guard_id:m.guardId,site_id:m.siteId,device_thumbprint:thumbprint},event:{event_id:eventId,kind,at,data}},m);
  const save=async value=>{await inbox.accept(value,JSON.stringify(value));return value;};
  const fixtures=[];for(let i=0;i<53;i++)fixtures.push(await save(project('incident',{description:'Synthetic received report '+i})));
  const ids=fixtures.map(value=>value.delivery_id).sort().reverse();
  await owner.query("UPDATE mercury_guard_receiver.observations SET received_at='2099-10-23 12:00:00.123456+00' WHERE delivery_id=ANY($1::text[])",[ids]);
  let page=await admin.catalog(session,'received_reports');assert.equal(page.items.length,50);assert.deepEqual(page.items.map(item=>item.delivery_id),ids.slice(0,50));assert.ok(page.next_cursor);assert.equal(page.items[0].received_at,'2099-10-23T12:00:00.123456Z');assert.ok(page.items.every(item=>item.media.state==='not_applicable'&&item.media.path===null));
  const lateArrival=await save(project('incident',{description:'Arrived after first page'}));await owner.query("UPDATE mercury_guard_receiver.observations SET received_at='2100-01-01 00:00:00+00' WHERE delivery_id=$1",[lateArrival.delivery_id]);
  const next=await admin.catalog(session,'received_reports',page.next_cursor);assert.deepEqual(next.items.slice(0,3).map(item=>item.delivery_id),ids.slice(50));assert.ok(!next.items.some(item=>item.delivery_id===lateArrival.delivery_id));
  await assert.rejects(admin.catalog(session,'received_reports',page.next_cursor+'='));
  const bytes=Buffer.from(readFileSync(new URL('../fixtures/receiver-photo.base64',import.meta.url),'utf8').trim(),'base64'),evidenceId=randomUUID(),photoEventId=randomUUID(),photo=project('photo_evidence',{evidence_id:evidenceId,sha256:hash(bytes),bytes:bytes.length,width:192,height:108,capture:'camera_intent'},mapping,photoEventId);
  const checkData={policy_revision:1,slot:0,biometric:{method:'android_local_biometric',at:at-2000},location:{at:at-1000,latitude:43.7,longitude:-79.4,accuracy_m:5,mock:false},photo_event_id:photoEventId,evidence_id:evidenceId},checkIn=await save(project('check_in',checkData));
  const bringToFront=async values=>owner.query("UPDATE mercury_guard_receiver.observations SET received_at='2200-01-01 00:00:00.123457+00' WHERE delivery_id=ANY($1::text[])",[values.map(value=>value.delivery_id)]);
  await bringToFront([checkIn]);page=await admin.catalog(session,'received_reports');assert.equal(page.items.find(item=>item.delivery_id===checkIn.delivery_id).media.state,'pending');
  await save(photo);await bringToFront([photo]);page=await admin.catalog(session,'received_reports');assert.equal(page.items.find(item=>item.delivery_id===photo.delivery_id).media.state,'pending');
  await inbox.acceptMedia(photo.delivery_id,mapping.destination,bytes);
  page=await admin.catalog(session,'received_reports');for(const value of [photo,checkIn]){const report=page.items.find(item=>item.delivery_id===value.delivery_id);assert.deepEqual(report.media,{state:'stored',path:'/v1/admin/media/'+photo.delivery_id,sha256:hash(bytes),bytes:bytes.length});assert.ok(!JSON.stringify(report).includes('"type":"Buffer"'));assert.equal('raw_body' in report,false);}
  assert.deepEqual((await admin.media(session,photo.delivery_id)).bytes,bytes);assert.equal(await admin.media(session,checkIn.delivery_id),null);assert.equal(await admin.media(session,'e'.repeat(64)),null);
  // Even an existing event ID and stored photo cannot bridge an attribution change.
  for(const key of ['assignmentId','guardId','vendorId','siteId','destination']){
   const other={...mapping,[key]:mapping[key]+'-different'};await approve(other);const value=await save(project('check_in',checkData,other));await bringToFront([value]);assert.equal((await admin.catalog(session,'received_reports')).items.find(item=>item.delivery_id===value.delivery_id).media.state,'pending');
  }
  for(const data of [{...checkData,evidence_id:randomUUID()},{...checkData,photo_event_id:randomUUID()}]){const value=await save(project('check_in',data));await bringToFront([value]);assert.equal((await admin.catalog(session,'received_reports')).items.find(item=>item.delivery_id===value.delivery_id).media.state,'pending');}
  const otherDevice=await save(project('check_in',checkData,mapping,randomUUID(),'d'.repeat(64)));await bringToFront([otherDevice]);assert.equal((await admin.catalog(session,'received_reports')).items.find(item=>item.delivery_id===otherDevice.delivery_id).media.state,'pending');
  await approve({...mapping,revision:2,dashboardShiftId:'received-other-upstream'});const changedMapping={...mapping,revision:2,dashboardShiftId:'received-other-upstream'},changed=await save(project('check_in',checkData,changedMapping));await bringToFront([changed]);assert.equal((await admin.catalog(session,'received_reports')).items.find(item=>item.delivery_id===changed.delivery_id).media.state,'pending');
  // Current source revocation preserves historical audit and original private bytes.
  await approve({...changedMapping,revision:3,active:false});assert.equal((await admin.catalog(session,'received_reports')).items.find(item=>item.delivery_id===checkIn.delivery_id).media.state,'stored');assert.deepEqual((await admin.media(session,photo.delivery_id)).bytes,bytes);
  const activeSession=createPostgresAuthSessionReader(pool),handler=createAdminHandler({admin,verifySession:async token=>token==='synthetic-admin'&&await activeSession(subject,sessionId)?session:token==='synthetic-guard'?{...session,subject:guardSubject}:null});
  const request=token=>new Request('https://mercury.test/v1/admin/media/'+photo.delivery_id,{headers:token?{authorization:'Bearer '+token}:{}});
  assert.equal((await handler(request(null))).status,401);assert.equal((await handler(request('synthetic-guard'))).status,403);let response=await handler(request('synthetic-admin'));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  await owner.query('DELETE FROM auth.sessions WHERE id=$1',[sessionId]);assert.equal((await handler(request('synthetic-admin'))).status,401);
  // Restore this synthetic session so the following case still exercises
  // membership revocation, independently of the exact-session denial above.
  await owner.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)',[sessionId,subject]);
  // A revocation between the HTTP precheck and reading transaction must still deny.
  const racing=createAdminHandler({verifySession:async()=>session,admin:{member:async value=>{const allowed=await admin.member(value);await owner.query('UPDATE mercury_guard.admin_accounts SET active=false WHERE auth_subject=$1',[subject]);return allowed;},media:admin.media.bind(admin)}});assert.equal((await racing(request('synthetic-admin'))).status,403);await assert.rejects(admin.catalog(session,'received_reports'),AdminDeniedError);
  await owner.query('UPDATE mercury_guard.admin_accounts SET active=true WHERE auth_subject=$1',[subject]);
  const original=(await owner.query('SELECT bytes,sha256,receipt FROM mercury_guard_receiver.media WHERE delivery_id=$1',[photo.delivery_id])).rows[0];
  try{
   await owner.query('UPDATE mercury_guard_receiver.media SET bytes=$1 WHERE delivery_id=$2',[Buffer.from(bytes).fill(0,10,20),photo.delivery_id]);await assert.rejects(admin.media(session,photo.delivery_id));
   await owner.query('UPDATE mercury_guard_receiver.media SET bytes=$1,sha256=$2 WHERE delivery_id=$3',[bytes,'a'.repeat(64),photo.delivery_id]);await assert.rejects(admin.media(session,photo.delivery_id));await assert.rejects(admin.catalog(session,'received_reports'));
   await owner.query('UPDATE mercury_guard_receiver.media SET sha256=$1,bytes=$2,receipt=$3 WHERE delivery_id=$4',[original.sha256,bytes.subarray(0,-1),original.receipt,photo.delivery_id]);await assert.rejects(admin.media(session,photo.delivery_id));
   await owner.query('UPDATE mercury_guard_receiver.media SET bytes=$1,receipt=$2 WHERE delivery_id=$3',[bytes,{...original.receipt,evidence_id:randomUUID()},photo.delivery_id]);await assert.rejects(admin.media(session,photo.delivery_id));
  }finally{await owner.query('UPDATE mercury_guard_receiver.media SET bytes=$1,sha256=$2,receipt=$3 WHERE delivery_id=$4',[original.bytes,original.sha256,original.receipt,photo.delivery_id]);}
  const originalBody=JSON.stringify(photo);try{await owner.query('UPDATE mercury_guard_receiver.observations SET raw_body=$1 WHERE delivery_id=$2',[originalBody.replace(mapping.guardId,'changed-guard'),photo.delivery_id]);await assert.rejects(admin.media(session,photo.delivery_id));}finally{await owner.query('UPDATE mercury_guard_receiver.observations SET raw_body=$1 WHERE delivery_id=$2',[originalBody,photo.delivery_id]);}
  const invalidJpeg=Buffer.from('Synthetic content is not an image'),invalidPhoto=await save(project('photo_evidence',{evidence_id:randomUUID(),sha256:hash(invalidJpeg),bytes:invalidJpeg.length,width:1,height:1,capture:'camera_intent'},{...mapping,assignmentId:mapping.assignmentId+'-different'}));await inbox.acceptMedia(invalidPhoto.delivery_id,mapping.destination,invalidJpeg);await assert.rejects(admin.media(session,invalidPhoto.delivery_id));
  for(const role of ['anon','authenticated']){const client=await ownerPool.connect();try{await client.query('BEGIN');await client.query('SET LOCAL ROLE '+role);await assert.rejects(client.query('SELECT bytes FROM mercury_guard_receiver.media'),/permission denied/);}finally{await client.query('ROLLBACK');client.release();}}
  console.log('PASS: protected received-report pagination, exact-scope check-in photos, historical audit, private JPEG integrity, current Auth sessions and transactional admin revocation');
 }finally{await pool.end();await ownerPool.end();}
}
