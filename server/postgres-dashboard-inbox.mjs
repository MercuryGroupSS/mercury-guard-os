import {createHash} from 'node:crypto';
import {strictJson} from './verify-batch.mjs';
import {validateProjectedDashboardObservation} from './dashboard-delivery.mjs';
import {receiverMappingKeys,receiverMappingLock,receiverRow,receiverScope,receiverTransaction} from './dashboard-receiver-input.mjs';
import {dashboardPhoto,dashboardMediaReceipt,dashboardMediaChunkReceipt,dashboardMediaStatus} from './dashboard-media.mjs';
import {PHOTO_CHUNK_BYTES,PHOTO_CHUNK_TTL_MS,validatePhotoChunk,assemblePhotoChunks,validateWholePhoto} from './photo-chunks.mjs';
export class PostgresDashboardInbox{
 constructor(pool,{authorizeCommit=null}={}){if(typeof pool?.connect!=='function'||typeof pool?.query!=='function'||authorizeCommit!==null&&typeof authorizeCommit!=='function')throw Error('Receiver PostgreSQL pool required');this.pool=pool;this.authorizeCommit=authorizeCommit;}
 async get(scope){const s=receiverScope(scope);return receiverRow((await this.pool.query('SELECT * FROM mercury_guard_receiver.bindings WHERE assignment_id=$1 AND guard_id=$2 AND vendor_id=$3 AND site_id=$4 AND destination=$5',receiverMappingKeys(s))).rows[0]);}
 async accept(value,raw){
  if(typeof raw!=='string'||Buffer.byteLength(raw)>64000||JSON.stringify(strictJson(raw))!==JSON.stringify(value))throw Error('Immutable raw observation required');
  const scope=receiverScope({assignmentId:value?.assignment_id,guardId:value?.guard_id,vendorId:value?.vendor_id,siteId:value?.site_id,destination:value?.destination}),digest=createHash('sha256').update(raw).digest('hex');
  return receiverTransaction(this.pool,async client=>{
   await this.authorizeCommit?.(client);
   // Approval takes the exclusive form of this same scope lock. Recheck inside
   // the committing transaction, including retries of an already saved receipt.
   await client.query('SELECT pg_advisory_xact_lock_shared($1::bigint)',[receiverMappingLock(scope)]);
   const mapping=receiverRow((await client.query('SELECT * FROM mercury_guard_receiver.bindings WHERE assignment_id=$1 AND guard_id=$2 AND vendor_id=$3 AND site_id=$4 AND destination=$5',receiverMappingKeys(scope))).rows[0]);
   validateProjectedDashboardObservation(value,mapping);
   const receipt={delivery_id:value.delivery_id,destination:value.destination,payload_sha256:digest,status:'stored_in_integration_inbox'};
   await client.query('INSERT INTO mercury_guard_receiver.observations(delivery_id,payload_sha256,raw_body,receipt,assignment_id,guard_id,vendor_id,site_id,destination,mapping_revision,dashboard_shift_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(delivery_id) DO NOTHING',[value.delivery_id,digest,raw,receipt,...receiverMappingKeys(scope),mapping.revision,mapping.dashboardShiftId]);
   const saved=(await client.query('SELECT payload_sha256,raw_body,receipt FROM mercury_guard_receiver.observations WHERE delivery_id=$1',[value.delivery_id])).rows[0];
   if(!saved||saved.payload_sha256!==digest||saved.raw_body!==raw)throw Error('Immutable receiver observation conflict');
   await this.authorizeCommit?.(client);
   return saved.receipt;
  });
 }
 async mediaObservation(client,deliveryId,destination){
  if(!/^[a-f0-9]{64}$/.test(deliveryId??''))throw Error('Photo delivery required');const row=(await client.query('SELECT raw_body FROM mercury_guard_receiver.observations WHERE delivery_id=$1 AND destination=$2',[deliveryId,destination])).rows[0];if(!row)throw Error('Photo observation unavailable');
  const value=strictJson(row.raw_body),scope=receiverScope({assignmentId:value.assignment_id,guardId:value.guard_id,vendorId:value.vendor_id,siteId:value.site_id,destination});await client.query('SELECT pg_advisory_xact_lock_shared($1::bigint)',[receiverMappingLock(scope)]);
  const mapping=receiverRow((await client.query('SELECT * FROM mercury_guard_receiver.bindings WHERE assignment_id=$1 AND guard_id=$2 AND vendor_id=$3 AND site_id=$4 AND destination=$5',receiverMappingKeys(scope))).rows[0]);validateProjectedDashboardObservation(value,mapping);
  const lock=BigInt.asIntN(64,BigInt('0x'+createHash('sha256').update('mercury-receiver-photo:'+deliveryId).digest('hex').slice(0,16))).toString();await client.query('SELECT pg_advisory_xact_lock($1::bigint)',[lock]);return value;
 }
 async mediaMetadata(deliveryId,destination){return receiverTransaction(this.pool,async client=>{await this.authorizeCommit?.(client);const meta=dashboardPhoto(await this.mediaObservation(client,deliveryId,destination));await this.authorizeCommit?.(client);return meta;});}
 async acceptMedia(deliveryId,destination,bytes){
  return receiverTransaction(this.pool,async client=>{
   await this.authorizeCommit?.(client);
   const value=await this.mediaObservation(client,deliveryId,destination),meta=dashboardPhoto(value);if(!Buffer.isBuffer(bytes)||bytes.length!==meta.bytes||createHash('sha256').update(bytes).digest('hex')!==meta.sha256)throw Error('Photo bytes mismatch');const receipt=dashboardMediaReceipt(value);
   await client.query('INSERT INTO mercury_guard_receiver.media(delivery_id,sha256,bytes,receipt) VALUES($1,$2,$3,$4) ON CONFLICT(delivery_id) DO NOTHING',[deliveryId,meta.sha256,bytes,receipt]);
   const prior=(await client.query('SELECT sha256,octet_length(bytes) AS size,receipt FROM mercury_guard_receiver.media WHERE delivery_id=$1',[deliveryId])).rows[0];if(!prior||prior.sha256!==meta.sha256||prior.size!==meta.bytes)throw Error('Immutable photo conflict');await this.authorizeCommit?.(client);return prior.receipt;
  });
 }
 async acceptMediaChunk(deliveryId,destination,index,bytes,now=Date.now()){
  if(!Number.isSafeInteger(now)||now<=0)throw Error('Trusted chunk time required');
  return receiverTransaction(this.pool,async client=>{
   await this.authorizeCommit?.(client);const value=await this.mediaObservation(client,deliveryId,destination),meta=dashboardPhoto(value),sha=validatePhotoChunk(meta,index,bytes);
   const accepted=(await client.query('SELECT sha256,bytes FROM mercury_guard_receiver.media WHERE delivery_id=$1',[deliveryId])).rows[0];
   if(accepted){validateWholePhoto(meta,accepted.bytes);if(accepted.sha256!==meta.sha256||!accepted.bytes.subarray(index*PHOTO_CHUNK_BYTES,index*PHOTO_CHUNK_BYTES+bytes.length).equals(bytes))throw Error('Immutable receiver photo conflict');}
   else{
    await client.query('DELETE FROM mercury_guard_receiver.media_chunks WHERE delivery_id=$1 AND expires_at<$2',[deliveryId,now]);
    const prior=(await client.query('SELECT sha256,bytes FROM mercury_guard_receiver.media_chunks WHERE delivery_id=$1 AND chunk_index=$2',[deliveryId,index])).rows[0];
    if(prior){if(prior.sha256!==sha||!prior.bytes.equals(bytes))throw Error('Immutable receiver chunk conflict');}
    else await client.query('INSERT INTO mercury_guard_receiver.media_chunks VALUES($1,$2,$3,$4,$5,$6)',[deliveryId,index,sha,bytes,now,now+PHOTO_CHUNK_TTL_MS]);
   }
   await this.authorizeCommit?.(client);return dashboardMediaChunkReceipt(meta,index,bytes);
  });
 }
 async finalizeMediaChunks(deliveryId,destination,now=Date.now()){
  if(!Number.isSafeInteger(now)||now<=0)throw Error('Trusted chunk time required');
  return receiverTransaction(this.pool,async client=>{
   await this.authorizeCommit?.(client);const value=await this.mediaObservation(client,deliveryId,destination),meta=dashboardPhoto(value);
   const prior=(await client.query('SELECT sha256,bytes,receipt FROM mercury_guard_receiver.media WHERE delivery_id=$1',[deliveryId])).rows[0];let receipt;
   if(prior){if(prior.sha256!==meta.sha256)throw Error('Immutable receiver photo conflict');validateWholePhoto(meta,prior.bytes);receipt=prior.receipt;}
   else{
    const rows=(await client.query('SELECT chunk_index,sha256,bytes,expires_at FROM mercury_guard_receiver.media_chunks WHERE delivery_id=$1 ORDER BY chunk_index',[deliveryId])).rows;if(rows.some(row=>Number(row.expires_at)<now))throw Error('Incomplete receiver fragments expired');
    const bytes=assemblePhotoChunks(meta,rows);receipt=dashboardMediaReceipt(value);await client.query('INSERT INTO mercury_guard_receiver.media(delivery_id,sha256,bytes,receipt) VALUES($1,$2,$3,$4)',[deliveryId,meta.sha256,bytes,receipt]);
   }
   dashboardMediaStatus(meta,[],receipt);await client.query('DELETE FROM mercury_guard_receiver.media_chunks WHERE delivery_id=$1',[deliveryId]);await this.authorizeCommit?.(client);return receipt;
  });
 }
 async mediaStatus(deliveryId,destination,now=Date.now()){
  if(!Number.isSafeInteger(now)||now<=0)throw Error('Trusted chunk time required');
  return receiverTransaction(this.pool,async client=>{
   await this.authorizeCommit?.(client);const value=await this.mediaObservation(client,deliveryId,destination),meta=dashboardPhoto(value),accepted=(await client.query('SELECT sha256,bytes,receipt FROM mercury_guard_receiver.media WHERE delivery_id=$1',[deliveryId])).rows[0];
   if(accepted){if(accepted.sha256!==meta.sha256)throw Error('Immutable receiver photo conflict');validateWholePhoto(meta,accepted.bytes);}
   const rows=accepted?[]:(await client.query('SELECT chunk_index,sha256,bytes FROM mercury_guard_receiver.media_chunks WHERE delivery_id=$1 AND expires_at>=$2 ORDER BY chunk_index',[deliveryId,now])).rows;
   const status=dashboardMediaStatus(meta,rows,accepted?.receipt??null);await this.authorizeCommit?.(client);return status;
  });
 }
 async cleanupPhotoChunks(now=Date.now(),limit=40){if(!Number.isSafeInteger(now)||now<=0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('Bounded cleanup required');return receiverTransaction(this.pool,async client=>{await this.authorizeCommit?.(client);const result=await client.query('DELETE FROM mercury_guard_receiver.media_chunks WHERE (delivery_id,chunk_index) IN (SELECT delivery_id,chunk_index FROM mercury_guard_receiver.media_chunks WHERE expires_at<$1 ORDER BY expires_at LIMIT $2)',[now,limit]);await this.authorizeCommit?.(client);return result.rowCount;});}
 close(){} // Pool lifetime belongs to the receiver process.
}
