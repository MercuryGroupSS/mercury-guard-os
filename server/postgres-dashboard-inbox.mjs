import {createHash} from 'node:crypto';
import {strictJson} from './verify-batch.mjs';
import {validateProjectedDashboardObservation} from './dashboard-delivery.mjs';
import {receiverMappingKeys,receiverMappingLock,receiverRow,receiverScope,receiverTransaction} from './dashboard-receiver-input.mjs';
import {dashboardPhoto,dashboardMediaReceipt} from './dashboard-media.mjs';
export class PostgresDashboardInbox{
 constructor(pool){if(typeof pool?.connect!=='function'||typeof pool?.query!=='function')throw Error('Receiver PostgreSQL pool required');this.pool=pool;}
 async get(scope){const s=receiverScope(scope);return receiverRow((await this.pool.query('SELECT * FROM mercury_guard_receiver.bindings WHERE assignment_id=$1 AND guard_id=$2 AND vendor_id=$3 AND site_id=$4 AND destination=$5',receiverMappingKeys(s))).rows[0]);}
 async accept(value,raw){
  if(typeof raw!=='string'||Buffer.byteLength(raw)>64000||JSON.stringify(strictJson(raw))!==JSON.stringify(value))throw Error('Immutable raw observation required');
  const scope=receiverScope({assignmentId:value?.assignment_id,guardId:value?.guard_id,vendorId:value?.vendor_id,siteId:value?.site_id,destination:value?.destination}),digest=createHash('sha256').update(raw).digest('hex');
  return receiverTransaction(this.pool,async client=>{
   // Approval takes the exclusive form of this same scope lock. Recheck inside
   // the committing transaction, including retries of an already saved receipt.
   await client.query('SELECT pg_advisory_xact_lock_shared($1::bigint)',[receiverMappingLock(scope)]);
   const mapping=receiverRow((await client.query('SELECT * FROM mercury_guard_receiver.bindings WHERE assignment_id=$1 AND guard_id=$2 AND vendor_id=$3 AND site_id=$4 AND destination=$5',receiverMappingKeys(scope))).rows[0]);
   validateProjectedDashboardObservation(value,mapping);
   const receipt={delivery_id:value.delivery_id,destination:value.destination,payload_sha256:digest,status:'stored_in_integration_inbox'};
   await client.query('INSERT INTO mercury_guard_receiver.observations(delivery_id,payload_sha256,raw_body,receipt,assignment_id,guard_id,vendor_id,site_id,destination,mapping_revision,dashboard_shift_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(delivery_id) DO NOTHING',[value.delivery_id,digest,raw,receipt,...receiverMappingKeys(scope),mapping.revision,mapping.dashboardShiftId]);
   const saved=(await client.query('SELECT payload_sha256,raw_body,receipt FROM mercury_guard_receiver.observations WHERE delivery_id=$1',[value.delivery_id])).rows[0];
   if(!saved||saved.payload_sha256!==digest||saved.raw_body!==raw)throw Error('Immutable receiver observation conflict');
   return saved.receipt;
  });
 }
 async mediaObservation(client,deliveryId,destination){
  if(!/^[a-f0-9]{64}$/.test(deliveryId??''))throw Error('Photo delivery required');const row=(await client.query('SELECT raw_body FROM mercury_guard_receiver.observations WHERE delivery_id=$1 AND destination=$2',[deliveryId,destination])).rows[0];if(!row)throw Error('Photo observation unavailable');
  const value=strictJson(row.raw_body),scope=receiverScope({assignmentId:value.assignment_id,guardId:value.guard_id,vendorId:value.vendor_id,siteId:value.site_id,destination});await client.query('SELECT pg_advisory_xact_lock_shared($1::bigint)',[receiverMappingLock(scope)]);
  const mapping=receiverRow((await client.query('SELECT * FROM mercury_guard_receiver.bindings WHERE assignment_id=$1 AND guard_id=$2 AND vendor_id=$3 AND site_id=$4 AND destination=$5',receiverMappingKeys(scope))).rows[0]);validateProjectedDashboardObservation(value,mapping);return value;
 }
 async mediaMetadata(deliveryId,destination){return receiverTransaction(this.pool,async client=>dashboardPhoto(await this.mediaObservation(client,deliveryId,destination)));}
 async acceptMedia(deliveryId,destination,bytes){
  return receiverTransaction(this.pool,async client=>{
   const value=await this.mediaObservation(client,deliveryId,destination),meta=dashboardPhoto(value);if(!Buffer.isBuffer(bytes)||bytes.length!==meta.bytes||createHash('sha256').update(bytes).digest('hex')!==meta.sha256)throw Error('Photo bytes mismatch');const receipt=dashboardMediaReceipt(value);
   await client.query('INSERT INTO mercury_guard_receiver.media(delivery_id,sha256,bytes,receipt) VALUES($1,$2,$3,$4) ON CONFLICT(delivery_id) DO NOTHING',[deliveryId,meta.sha256,bytes,receipt]);
   const prior=(await client.query('SELECT sha256,octet_length(bytes) AS size,receipt FROM mercury_guard_receiver.media WHERE delivery_id=$1',[deliveryId])).rows[0];if(!prior||prior.sha256!==meta.sha256||prior.size!==meta.bytes)throw Error('Immutable photo conflict');return prior.receipt;
  });
 }
 close(){} // Pool lifetime belongs to the receiver process.
}
