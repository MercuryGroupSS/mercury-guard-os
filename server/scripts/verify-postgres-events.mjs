import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign,createHash} from 'node:crypto';
import {Pool} from 'pg';
import {PostgresDeviceAssignments} from '../postgres-device-assignments.mjs';
import {PostgresShiftLifecycle} from '../postgres-shift-lifecycle.mjs';
import {PostgresShiftGrantIssuer} from '../postgres-shift-grant-issuer.mjs';
import {PostgresDurableIngest} from '../postgres-durable-ingest.mjs';
export async function verifyPostgresEvents(connectionString,admin){
 const pool=new Pool({connectionString,max:4,options:'-c role=service_role'});
 try{
  const devices=new PostgresDeviceAssignments(pool),store=new PostgresDurableIngest(devices),other=new PostgresDurableIngest(devices),now=Date.now();
  const identity={subject:(await admin.query("SELECT auth_subject FROM mercury_guard.guards WHERE guard_id='device-other'")).rows[0].auth_subject,guardId:'device-other',vendorId:'device-vendor'};
  const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),spki=keys.publicKey.export({type:'spki',format:'der'}).toString('base64url');
  await devices.enroll({deviceId:'events-phone',mode:'site',siteId:'device-site',active:true,revoked:false,publicKeySpki:spki});
  const device=await devices.device('events-phone'),assignment={assignmentId:'events-shift',guardId:identity.guardId,vendorId:identity.vendorId,siteId:'device-site',deviceId:device.deviceId,canStart:true,startsAt:now-1000,endsAt:now+60000,active:true};
  await devices.assign(assignment);await new PostgresShiftLifecycle(devices).transition({identity,assignment,deviceThumbprint:device.thumbprint,request:{action:'start',confirmed:true,request_id:'events-start',reason:''},now});
  const issuer=new PostgresShiftGrantIssuer({devices,privateKey:generateKeyPairSync('rsa',{modulusLength:2048}).privateKey,keyId:'events',issuer:'mercury-local',audience:'mercury-local'});
  const signed=await issuer.issue({identity,assignment,device,now,sessionExpiresAt:now+60000,allowedActions:['incident','photo']}),claims=JSON.parse(Buffer.from(signed.payload,'base64url'));
  const c={subject:identity.subject,guardId:identity.guardId,vendorId:identity.vendorId,siteId:assignment.siteId,assignmentId:assignment.assignmentId,thumbprint:device.thumbprint,publicKeySpki:spki,revocationVersion:1,enrolled:true,revoked:false,audience:'mercury-local',allowedKinds:['incident','photo_evidence'],notBefore:Math.floor(now/1000)-1,expiresAt:Math.floor(now/1000)+120,receivedAtMs:now+1000,allowHistoricalSequence:true};
  const scope={guard_id:c.guardId,site_id:c.siteId,assignment_id:c.assignmentId,device_thumbprint:c.thumbprint,revocation_version:1};
  const event={event_id:randomUUID(),sequence:1,at:now,kind:'incident',data:{description:'Synthetic shared event',capture_grant_id:claims.grant_id}};
  const batch={batch_id:randomUUID(),schema_version:2,scope,events:[event]};
  const raw=b=>{const payload=Buffer.from(JSON.stringify(b)).toString('base64url');return JSON.stringify({version:2,algorithm:'SHA256withECDSA',audience:c.audience,device_thumbprint:c.thumbprint,public_key_spki:spki,payload,signature_der:sign('sha256',Buffer.from(`mercury-event-batch-v2\n${c.audience}\n${c.thumbprint}\n${payload}`),keys.privateKey).toString('base64url')});};
  const results=await Promise.all([store.ingest(raw(batch),c,Math.floor(now/1000)),other.ingest(raw(batch),c,Math.floor(now/1000))]);assert.deepEqual(results[0],results[1]);assert.equal(await store.count(),1);
  await assert.rejects(other.ingest(raw({...batch,events:[{...event,data:{...event.data,description:'changed'}}]}),c,Math.floor(now/1000)));
  await assert.rejects(other.ingest(raw({...batch,batch_id:randomUUID(),events:[{...event,data:{...event.data,description:'changed'}}]}),c,Math.floor(now/1000)));
  await assert.rejects(store.ingest(raw({...batch,batch_id:randomUUID(),events:[{...event,event_id:randomUUID(),sequence:2},{...event,event_id:randomUUID(),sequence:1}]}),c,Math.floor(now/1000)));assert.equal(await store.count(),1);
  const bytes=Buffer.from([255,216,255,217]),photo={event_id:randomUUID(),sequence:3,at:now,kind:'photo_evidence',data:{capture_grant_id:claims.grant_id,evidence_id:randomUUID(),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,width:1,height:1,capture:'camera_intent'}};
  await store.ingest(raw({...batch,batch_id:randomUUID(),events:[photo]}),c,Math.floor(now/1000));
  const record=await other.photoForGuard(c.guardId,photo.event_id);assert.ok(record);assert.equal(await other.photoForGuard('other-guard',photo.event_id),null);
  const media=await Promise.all([store.retainPhoto(record,bytes,now+1000),other.retainPhoto(record,bytes,now+1000)]);assert.deepEqual(media[0],media[1]);
  // A second real signed fixture remains available for independent dashboard
  // media-delivery tests without changing the first observation's attribution.
  const secondPhoto={...photo,event_id:randomUUID(),sequence:4,data:{...photo.data,evidence_id:randomUUID()}};
  await store.ingest(raw({...batch,batch_id:randomUUID(),events:[secondPhoto]}),c,Math.floor(now/1000));await store.retainPhoto(await store.photoForGuard(c.guardId,secondPhoto.event_id),bytes,now+1000);
  await assert.rejects(other.retainPhoto(record,Buffer.from('wrong'),now+1000));
  assert.equal((await other.eventsAfter(0,1)).length,1);
  await assert.rejects(pool.query('UPDATE mercury_guard.ingested_events SET digest=repeat(\'0\',64)'),/permission denied/);
  await assert.rejects(pool.query('DELETE FROM mercury_guard.ingest_receipts'),/permission denied/);
  await issuer.revoke(claims.grant_id);await assert.rejects(other.ingest(raw(batch),c,Math.floor(now/1000)));await assert.rejects(other.retainPhoto(record,bytes,now+1000));
  console.log('PASS: shared PostgreSQL event retries, conflicts, atomic rollback, photo persistence and revocation rechecks');
 }finally{await pool.end();}
}
