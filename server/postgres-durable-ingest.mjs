import {validateLocationSample} from './location-policy.mjs';
import {reconcilePostgresCheckIns} from './postgres-check-in-status.mjs';
import {postgresCheckInWorkerState} from './check-in-worker-state.mjs';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {verifyScopedBatch} from './verify-batch.mjs';
import {photoMetadata} from './photo-metadata.mjs';
import {PHOTO_CHUNK_BYTES,PHOTO_CHUNK_TTL_MS,photoChunkReceipt,validatePhotoChunk,assemblePhotoChunks,validateWholePhoto} from './photo-chunks.mjs';
import {permitsCheckpoint,patrolRoundKey} from './patrol-route.mjs';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const actions={incident:'incident',patrol_checkpoint:'patrol',check_in:'check_in',check_in_miss_reason:'check_in',photo_evidence:'photo',location:'location',dispatch_ack:'dispatch_ack'};
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
export class PostgresDurableIngest{
 constructor(devices,{locationConsents=null}={}){if(typeof devices?.transaction!=='function'||typeof devices?.pool?.query!=='function')throw Error('Transactional PostgreSQL devices required');this.devices=devices;this.pool=devices.pool;this.locationConsents=locationConsents;this.workerState=postgresCheckInWorkerState(this.pool);}
 async lockAuthority(client,c,batch){
  if(!uuid(c.subject)||typeof c.vendorId!=='string')throw Error('Verified individual identity required');
  const r=(await client.query(`SELECT h.clocked_in,h.clocked_out,h.ends_at FROM mercury_guard.assignments a
   JOIN mercury_guard.guards g ON g.guard_id=a.guard_id AND g.vendor_id=a.vendor_id
   JOIN mercury_guard.vendors v ON v.vendor_id=g.vendor_id JOIN mercury_guard.sites s ON s.site_id=a.site_id
   JOIN mercury_guard.devices d ON d.thumbprint=$1
   JOIN mercury_guard.shift_sessions h ON h.assignment=a.assignment_id AND h.guard=g.guard_id AND h.vendor=v.vendor_id AND h.site=s.site_id AND h.device=d.thumbprint
   WHERE a.assignment_id=$2 AND g.guard_id=$3 AND v.vendor_id=$4 AND s.site_id=$5 AND g.auth_subject=$6::uuid
    AND a.active AND g.active AND v.active AND s.active AND d.active AND NOT d.revoked
    AND d.revocation_version=$7 AND d.public_key_spki=$8
    AND ((d.mode='site' AND d.site_id=a.site_id) OR (d.mode='personal' AND d.guard_id=g.guard_id))
   FOR SHARE OF a,g,v,s,d,h`,[c.thumbprint,c.assignmentId,c.guardId,c.vendorId,c.siteId,c.subject,c.revocationVersion,c.publicKeySpki])).rows[0];
  if(!r||!Number.isSafeInteger(c.receivedAtMs)||c.receivedAtMs<Number(r.clocked_in)||c.receivedAtMs>Number(r.ends_at)+86400000)throw Error('Current capture authority unavailable');
  for(const e of batch.events){
   if(e.at>c.receivedAtMs||e.at<Number(r.clocked_in)||e.at>=Number(r.ends_at)||(r.clocked_out!==null&&e.at>=Number(r.clocked_out)))throw Error('Observation outside confirmed shift');
   if(!uuid(e.data.capture_grant_id))throw Error('Capture grant required');
  }
  const ids=[...new Set(batch.events.map(e=>e.data.capture_grant_id))].sort();
  const grants=(await client.query('SELECT id,subject,vendor_id,payload,policy FROM mercury_guard.capture_grants WHERE id=ANY($1::uuid[]) AND NOT revoked ORDER BY id FOR SHARE',[ids])).rows;
  const lookup=new Map(grants.map(g=>[g.id,g]));
  const validations=new Map();
  for(const e of batch.events){const saved=lookup.get(e.data.capture_grant_id),g=saved?JSON.parse(Buffer.from(saved.payload,'base64url').toString('utf8')):null;
   if(!g||saved.subject!==c.subject||saved.vendor_id!==c.vendorId||g.guard_id!==c.guardId||g.site_id!==c.siteId||g.assignment_id!==c.assignmentId||g.device_thumbprint!==c.thumbprint||g.revocation_version!==c.revocationVersion||g.audience!==c.audience||!g.actions.includes(actions[e.kind])||e.at<g.not_before_ms||e.at>=g.expires_at_ms)throw Error('Capture grant unavailable');
   if(e.kind==='patrol_checkpoint'&&!permitsCheckpoint(saved.policy?.patrolRoute,e.data))throw Error('Checkpoint round not authorized');
   if(e.kind==='location'){
    if(!this.locationConsents||JSON.stringify(saved.policy?.location)!==JSON.stringify(g.location))throw Error('Current original location consent unavailable');
    await this.locationConsents.forIngest(client,{...c,locationEventAt:e.at},g.location);
    validations.set(e.event_id,validateLocationSample(g.location,e,g,c.receivedAtMs));
   }
  }
  return validations;
 }
 async ingest(raw,c,now){
  const verified=verifyScopedBatch(raw,c,now),batch=verified.batch,hash=digest({hash:verified.payloadHash,vendorId:c.vendorId});
  const received=c.receivedAtMs??now*1000;if(!Number.isSafeInteger(received)||received<=0)throw Error('Trusted receipt time required');
  return this.devices.transaction(async client=>{
   // Serialize through commit for stable event cursors, sequence and retry receipts.
   await client.query('SELECT pg_advisory_xact_lock(724910621355083::bigint)');
   const validations=await this.lockAuthority(client,{...c,receivedAtMs:received},batch);
   const old=(await client.query('SELECT digest,body FROM mercury_guard.ingest_receipts WHERE device=$1 AND id=$2',[c.thumbprint,batch.batch_id])).rows[0];
   if(old){if(old.digest!==hash)throw Error('Batch ID content conflict');if(validations.size)await this.locationConsents.requireSession(client,c.session);return old.body;}
   let last=Number((await client.query('SELECT COALESCE(MAX(sequence),0) n FROM mercury_guard.ingested_events WHERE device=$1',[c.thumbprint])).rows[0].n);
   for(const e of batch.events){
    const record={scope:batch.scope,event:e,vendor_id:c.vendorId,...(validations.has(e.event_id)?{location_validation:validations.get(e.event_id)}:{})},eventHash=digest(record);
    const prior=(await client.query('SELECT digest FROM mercury_guard.ingested_events WHERE device=$1 AND id=$2',[c.thumbprint,e.event_id])).rows[0];
    if(prior){if(prior.digest!==eventHash)throw Error('Event ID content or scope conflict');continue;}
    if(e.sequence<=last&&c.allowHistoricalSequence!==true)throw Error('Device sequence rollback');
    await client.query('INSERT INTO mercury_guard.ingested_events(device,id,sequence,digest,body,received_at,guard_id,vendor_id,assignment_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[c.thumbprint,e.event_id,e.sequence,eventHash,record,received,c.guardId,c.vendorId,c.assignmentId]);
    if(e.kind==='check_in'&&c.allowHistoricalSequence===true)await client.query('INSERT INTO mercury_guard.ingested_check_ins VALUES($1,$2,$3,$4,$5,$6)',[c.guardId,c.assignmentId,e.data.policy_revision,e.data.slot,c.thumbprint,e.event_id]);
    if(e.kind==='patrol_checkpoint'&&c.allowHistoricalSequence===true)await client.query('INSERT INTO mercury_guard.ingested_checkpoints(guard_id,assignment_id,route,revision,checkpoint,device,event_id,round_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[c.guardId,c.assignmentId,e.data.route_id,e.data.route_revision,e.data.checkpoint_id,c.thumbprint,e.event_id,patrolRoundKey(e.data)]);
    last=e.sequence;
   }
   const receipt={batch_id:batch.batch_id,event_ids:batch.events.map(e=>e.event_id),status:'accepted_local_only'};
   await client.query('INSERT INTO mercury_guard.ingest_receipts VALUES($1,$2,$3,$4)',[c.thumbprint,batch.batch_id,hash,receipt]);if(validations.size)await this.locationConsents.requireSession(client,c.session);return receipt;
  });
 }
 async photoForGuard(guardId,eventId){if(!uuid(eventId))return null;const rows=(await this.pool.query('SELECT body FROM mercury_guard.ingested_events WHERE id=$1 AND guard_id=$2',[eventId,guardId])).rows;return rows.length===1&&rows[0].body.event.kind==='photo_evidence'?rows[0].body:null;}
 async retainPhoto(record,bytes,receivedAt=Date.now()){
  const meta=photoMetadata(record.event.data);
  if(bytes.length!==meta.bytes||createHash('sha256').update(bytes).digest('hex')!==meta.sha256)throw Error('Evidence mismatch');
  return this.withPhotoAuthority(record,receivedAt,async(client,{device,eventId})=>{
   const prior=(await client.query('SELECT sha256,octet_length(bytes) size FROM mercury_guard.ingested_media WHERE device=$1 AND event_id=$2',[device,eventId])).rows[0];
   if(prior){if(prior.sha256!==meta.sha256||prior.size!==bytes.length)throw Error('Evidence conflict');}
   else await client.query('INSERT INTO mercury_guard.ingested_media VALUES($1,$2,$3,$4,$5)',[device,eventId,meta.sha256,bytes,receivedAt]);
   return this.photoReceipt(record,meta);
  });
 }
 photoReceipt(record,meta){return {event_id:record.event.event_id,evidence_id:meta.evidence_id,sha256:meta.sha256,bytes:meta.bytes,status:'evidence_accepted_local_only'};}
 async withPhotoAuthority(record,receivedAt,fn){
  if(!Number.isSafeInteger(receivedAt)||receivedAt<=0)throw Error('Trusted receipt time required');
  return this.devices.transaction(async client=>{
   await client.query('SELECT pg_advisory_xact_lock(724910621355083::bigint)');
   const {device_thumbprint:device,guard_id:guard}=record.scope,eventId=record.event.event_id;
   const stored=(await client.query('SELECT body FROM mercury_guard.ingested_events WHERE device=$1 AND id=$2 AND guard_id=$3',[device,eventId,guard])).rows[0];
   if(!stored||stored.body.event.kind!=='photo_evidence'||!isDeepStrictEqual(stored.body,record))throw Error('Evidence event unavailable');
   const grant=(await client.query('SELECT subject,payload FROM mercury_guard.capture_grants WHERE id=$1 AND NOT revoked',[record.event.data.capture_grant_id])).rows[0];
   const enrolled=(await client.query('SELECT public_key_spki FROM mercury_guard.devices WHERE thumbprint=$1',[device])).rows[0];
   if(!grant||!enrolled)throw Error('Evidence authority unavailable');
   await this.lockAuthority(client,{subject:grant.subject,vendorId:record.vendor_id,guardId:guard,assignmentId:record.scope.assignment_id,siteId:record.scope.site_id,thumbprint:device,revocationVersion:record.scope.revocation_version,publicKeySpki:enrolled.public_key_spki,audience:JSON.parse(Buffer.from(grant.payload,'base64url')).audience,receivedAtMs:receivedAt},{events:[record.event]});
   const assignment=(await client.query('SELECT ends_at_ms FROM mercury_guard.assignments WHERE assignment_id=$1',[record.scope.assignment_id])).rows[0];
   return fn(client,{device,eventId,expiresAt:Math.min(receivedAt+PHOTO_CHUNK_TTL_MS,Number(assignment.ends_at_ms)+PHOTO_CHUNK_TTL_MS)});
  });
 }
 async retainPhotoChunk(record,index,bytes,receivedAt=Date.now()){
  const meta=photoMetadata(record.event.data),sha=validatePhotoChunk(meta,index,bytes);
  return this.withPhotoAuthority(record,receivedAt,async(client,{device,eventId,expiresAt})=>{
   const accepted=(await client.query('SELECT sha256,bytes FROM mercury_guard.ingested_media WHERE device=$1 AND event_id=$2',[device,eventId])).rows[0];
   if(accepted){validateWholePhoto(meta,accepted.bytes);if(accepted.sha256!==meta.sha256||!accepted.bytes.subarray(index*PHOTO_CHUNK_BYTES,index*PHOTO_CHUNK_BYTES+bytes.length).equals(bytes))throw Error('Immutable photo conflict');}
   else{
    // Expired fragments can be reconstructed only from the original retained
    // handset JPEG. This never deletes an accepted original or an event/receipt.
    await client.query('DELETE FROM mercury_guard.evidence_chunks WHERE device=$1 AND event_id=$2 AND expires_at<$3',[device,eventId,receivedAt]);
    const prior=(await client.query('SELECT sha256,bytes FROM mercury_guard.evidence_chunks WHERE device=$1 AND event_id=$2 AND chunk_index=$3',[device,eventId,index])).rows[0];
    if(prior){if(prior.sha256!==sha||!prior.bytes.equals(bytes))throw Error('Immutable photo chunk conflict');}
    else await client.query('INSERT INTO mercury_guard.evidence_chunks(device,event_id,chunk_index,sha256,bytes,received_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[device,eventId,index,sha,bytes,receivedAt,expiresAt]);
   }
   return photoChunkReceipt(eventId,meta,index,bytes);
  });
 }
 async finalizePhotoChunks(record,receivedAt=Date.now()){
  const meta=photoMetadata(record.event.data);
  return this.withPhotoAuthority(record,receivedAt,async(client,{device,eventId})=>{
   const accepted=(await client.query('SELECT sha256,bytes FROM mercury_guard.ingested_media WHERE device=$1 AND event_id=$2',[device,eventId])).rows[0];
   if(accepted){if(accepted.sha256!==meta.sha256)throw Error('Immutable photo conflict');validateWholePhoto(meta,accepted.bytes);}
   else{
    const rows=(await client.query('SELECT chunk_index,sha256,bytes,expires_at FROM mercury_guard.evidence_chunks WHERE device=$1 AND event_id=$2 ORDER BY chunk_index',[device,eventId])).rows;
    if(rows.some(row=>Number(row.expires_at)<receivedAt))throw Error('Incomplete photo fragments expired');
    const bytes=assemblePhotoChunks(meta,rows);await client.query('INSERT INTO mercury_guard.ingested_media VALUES($1,$2,$3,$4,$5)',[device,eventId,meta.sha256,bytes,receivedAt]);
   }
   await client.query('DELETE FROM mercury_guard.evidence_chunks WHERE device=$1 AND event_id=$2',[device,eventId]);
   return this.photoReceipt(record,meta);
  });
 }
 async cleanupPhotoChunks(now=Date.now(),limit=40){
  if(!Number.isSafeInteger(now)||now<=0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('Bounded cleanup required');
  return (await this.pool.query('DELETE FROM mercury_guard.evidence_chunks WHERE (device,event_id,chunk_index) IN (SELECT device,event_id,chunk_index FROM mercury_guard.evidence_chunks WHERE expires_at<$1 ORDER BY expires_at LIMIT $2)',[now,limit])).rowCount;
 }
 reconcileCheckIns(assignment,now){return reconcilePostgresCheckIns(this,assignment,now);}
 async hasMissedCheckIn(guard,assignment,revision,slot){return (await this.pool.query('SELECT 1 FROM mercury_guard.missed_check_ins WHERE guard_id=$1 AND assignment_id=$2 AND revision=$3 AND slot=$4',[guard,assignment,revision,slot])).rowCount===1;}
 async alertsAfter(cursor,limit){if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('Bounded alert page required');return (await this.pool.query('SELECT cursor,body FROM mercury_guard.check_in_alert_outbox WHERE cursor>$1 ORDER BY cursor LIMIT $2',[cursor,limit])).rows.map(r=>({cursor:Number(r.cursor),body:JSON.stringify(r.body)}));}
 async count(){return Number((await this.pool.query('SELECT count(*) n FROM mercury_guard.ingested_events')).rows[0].n);}
 async eventsAfter(cursor,limit){if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('Bounded event page required');return (await this.pool.query('SELECT cursor,body FROM mercury_guard.ingested_events WHERE cursor>$1 ORDER BY cursor LIMIT $2',[cursor,limit])).rows.map(r=>({cursor:Number(r.cursor),body:JSON.stringify(r.body)}));}
 close(){}
}
