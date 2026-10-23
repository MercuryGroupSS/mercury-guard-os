import {randomUUID} from 'node:crypto';import {validateDashboardMediaJob,validateDashboardMediaReceipt} from './dashboard-media.mjs';
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
export class PostgresDashboardMedia{
 constructor(devices){if(typeof devices?.transaction!=='function'||typeof devices?.pool?.query!=='function')throw Error('Transactional PostgreSQL delivery store required');this.devices=devices;this.pool=devices.pool;}
 async claim(now=Date.now()){
  if(!Number.isSafeInteger(now)||now<=0)throw Error('Trusted delivery time required');return this.devices.transaction(async client=>{
   const r=(await client.query(`SELECT o.id,o.hash,o.body,o.media_attempts,p.bytes FROM mercury_guard.dashboard_outbox o
    JOIN mercury_guard.dashboard_bindings m ON m.assignment_id=o.assignment_id AND m.guard_id=o.guard_id AND m.vendor_id=o.vendor_id AND m.site_id=o.site_id
    JOIN mercury_guard.ingested_media p ON p.device=o.body::jsonb#>>'{observation,device_thumbprint}' AND p.event_id::text=o.body::jsonb#>>'{observation,event_id}'
    WHERE o.status='delivered' AND o.media_status='pending' AND o.media_next_at<=$1 AND (o.media_lease_until IS NULL OR o.media_lease_until<=$1)
     AND o.body::jsonb#>>'{observation,kind}'='photo_evidence' AND m.active AND m.revision=o.mapping_revision AND m.destination=o.destination AND m.dashboard_shift_id=o.dashboard_shift_id
    ORDER BY o.media_next_at,o.id LIMIT 1 FOR UPDATE OF o SKIP LOCKED`,[now])).rows[0];
   if(!r)return null;const job={id:r.id,hash:r.hash,body:r.body,bytes:r.bytes,lease:randomUUID(),attempts:Number(r.media_attempts)+1};validateDashboardMediaJob(job);
   await client.query('UPDATE mercury_guard.dashboard_outbox SET media_lease=$1,media_lease_until=$2,media_attempts=media_attempts+1 WHERE id=$3',[job.lease,now+120000,job.id]);return job;
  });
 }
 async accepted(job,receipt){
  if(!uuid(job?.lease))throw Error('Media lease required');return this.devices.transaction(async client=>{
   const r=(await client.query("SELECT hash,body,media_lease FROM mercury_guard.dashboard_outbox WHERE id=$1 AND media_status='pending' FOR UPDATE",[job.id])).rows[0];
   if(!r||r.media_lease!==job.lease||r.hash!==job.hash||r.body!==job.body)throw Error('Media lease or original observation changed');validateDashboardMediaReceipt(receipt,r.body);
   await client.query("UPDATE mercury_guard.dashboard_outbox SET media_status='delivered',media_receipt=$1,media_lease=NULL,media_lease_until=NULL WHERE id=$2",[receipt,job.id]);
  });
 }
 async retry(job,now=Date.now()){
  if(!Number.isSafeInteger(now)||now<=0)throw Error('Trusted delivery time required');if(!uuid(job?.lease))return false;
  return this.devices.transaction(async client=>{const r=(await client.query("SELECT hash,body,media_lease,media_attempts FROM mercury_guard.dashboard_outbox WHERE id=$1 AND media_status='pending' FOR UPDATE",[job.id])).rows[0];if(!r||r.media_lease!==job.lease)return false;if(r.hash!==job.hash||r.body!==job.body)throw Error('Original media attribution changed');await client.query('UPDATE mercury_guard.dashboard_outbox SET media_next_at=$1,media_lease=NULL,media_lease_until=NULL WHERE id=$2',[now+Math.min(3600000,1000*2**Math.min(Number(r.media_attempts),12)),job.id]);return true;});
 }
}
