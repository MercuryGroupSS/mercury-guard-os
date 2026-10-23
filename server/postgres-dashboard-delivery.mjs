import {createHash,randomUUID} from 'node:crypto';
import {prepareDashboardMapping} from './dashboard-mapping-input.mjs';
import {projectDashboardObservation,validateDashboardReceipt} from './dashboard-delivery.mjs';
const hash=body=>createHash('sha256').update(body).digest('hex');
const mapping=r=>r?{assignmentId:r.assignment_id,guardId:r.guard_id,vendorId:r.vendor_id,siteId:r.site_id,dashboardShiftId:r.dashboard_shift_id,destination:r.destination,revision:Number(r.revision),active:r.active}:null;
const keys=m=>[m.assignmentId,m.guardId,m.vendorId,m.siteId];
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
export class PostgresDashboardBindings{
 constructor(devices){if(typeof devices?.transaction!=='function'||typeof devices?.pool?.query!=='function')throw Error('Transactional PostgreSQL devices required');this.devices=devices;this.pool=devices.pool;}
 async approve(value,existingClient=null){
  const m=prepareDashboardMapping(value);
  return this.devices.transaction(async client=>{
   await client.query('SELECT pg_advisory_xact_lock(724910621355085::bigint)');
   if((await client.query('SELECT 1 FROM mercury_guard.assignments WHERE assignment_id=$1 AND guard_id=$2 AND vendor_id=$3 AND site_id=$4',keys(m))).rowCount!==1)throw Error('Approved source assignment required');
   const prior=(await client.query('SELECT revision FROM mercury_guard.dashboard_bindings WHERE assignment_id=$1 AND guard_id=$2 AND vendor_id=$3 AND site_id=$4',keys(m))).rows[0];
   if(prior&&m.revision<=Number(prior.revision))throw Error('Mapping revision must advance');
   await client.query('INSERT INTO mercury_guard.dashboard_mapping_history(assignment_id,guard_id,vendor_id,site_id,revision,body) VALUES($1,$2,$3,$4,$5,$6)',[...keys(m),m.revision,m]);
   await client.query('INSERT INTO mercury_guard.dashboard_bindings VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(assignment_id,guard_id,vendor_id,site_id) DO UPDATE SET dashboard_shift_id=excluded.dashboard_shift_id,destination=excluded.destination,revision=excluded.revision,active=excluded.active',[...keys(m),m.dashboardShiftId,m.destination,m.revision,m.active]);
  },existingClient);
 }
 async get(scope){return mapping((await this.pool.query('SELECT * FROM mercury_guard.dashboard_bindings WHERE assignment_id=$1 AND guard_id=$2 AND vendor_id=$3 AND site_id=$4',keys(scope))).rows[0]);}
 close(){}
}
export class PostgresDashboardOutbox{
 constructor(devices){if(typeof devices?.transaction!=='function'||typeof devices?.pool?.query!=='function')throw Error('Transactional PostgreSQL devices required');this.devices=devices;this.pool=devices.pool;this.bridgeState={get:async channel=>Number((await this.pool.query('SELECT cursor FROM mercury_guard.dashboard_bridge_state WHERE channel=$1',[channel])).rows[0]?.cursor??0),save:(channel,cursor)=>this.pool.query('INSERT INTO mercury_guard.dashboard_bridge_state VALUES($1,$2) ON CONFLICT(channel) DO UPDATE SET cursor=excluded.cursor',[channel,cursor])};}
 async enqueue(record,m){
  const p=projectDashboardObservation(record,m),body=JSON.stringify(p),digest=hash(body);if(Buffer.byteLength(body)>64000)throw Error('Observation too large');
  return this.devices.transaction(async client=>{
   const approved=(await client.query('SELECT * FROM mercury_guard.dashboard_bindings WHERE assignment_id=$1 AND guard_id=$2 AND vendor_id=$3 AND site_id=$4 FOR SHARE',keys(m))).rows[0];
   if(!approved?.active||Number(approved.revision)!==m.revision||approved.destination!==m.destination||approved.dashboard_shift_id!==m.dashboardShiftId)throw Error('Original mapping no longer approved');
   await client.query('INSERT INTO mercury_guard.dashboard_outbox(id,hash,body,assignment_id,guard_id,vendor_id,site_id,mapping_revision,destination,dashboard_shift_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO NOTHING',[p.delivery_id,digest,body,...keys(m),m.revision,m.destination,m.dashboardShiftId]);
   const prior=(await client.query('SELECT hash,body FROM mercury_guard.dashboard_outbox WHERE id=$1',[p.delivery_id])).rows[0];
   if(prior.hash!==digest||prior.body!==body)throw Error('Existing delivery attribution or content changed');return p.delivery_id;
  });
 }
 async claim(now=Date.now()){
  if(!Number.isSafeInteger(now)||now<=0)throw Error('Invalid worker time');
  return this.devices.transaction(async client=>{
   const r=(await client.query(`SELECT o.* FROM mercury_guard.dashboard_outbox o JOIN mercury_guard.dashboard_bindings m
    ON m.assignment_id=o.assignment_id AND m.guard_id=o.guard_id AND m.vendor_id=o.vendor_id AND m.site_id=o.site_id
    WHERE o.status='pending' AND o.next_at<=$1 AND (o.lease_until IS NULL OR o.lease_until<=$1)
     AND m.active AND m.revision=o.mapping_revision AND m.destination=o.destination AND m.dashboard_shift_id=o.dashboard_shift_id
    ORDER BY o.next_at,o.id LIMIT 1 FOR UPDATE OF o SKIP LOCKED`,[now])).rows[0];
   if(!r)return null;if(hash(r.body)!==r.hash)throw Error('Stored outbox content is corrupt');
   const lease=randomUUID();await client.query('UPDATE mercury_guard.dashboard_outbox SET lease=$1,lease_until=$2,attempts=attempts+1 WHERE id=$3',[lease,now+120000,r.id]);
   return {id:r.id,hash:r.hash,body:r.body,lease,attempts:Number(r.attempts)+1};
  });
 }
 async accepted(job,receipt){
  if(!uuid(job?.lease))throw Error('Delivery lease unavailable');
  return this.devices.transaction(async client=>{
   const r=(await client.query("SELECT id,hash,body,lease FROM mercury_guard.dashboard_outbox WHERE id=$1 AND status='pending' FOR UPDATE",[job.id])).rows[0];
   if(!r||r.lease!==job.lease||r.hash!==job.hash||r.body!==job.body||hash(r.body)!==r.hash)throw Error('Delivery lease or immutable payload changed');
   validateDashboardReceipt(receipt,r);await client.query("UPDATE mercury_guard.dashboard_outbox SET status='delivered',receipt=$1,lease=NULL,lease_until=NULL WHERE id=$2",[receipt,r.id]);
  });
 }
 async retry(job,now=Date.now()){
  if(!Number.isSafeInteger(now)||now<=0)throw Error('Invalid worker time');if(!uuid(job?.lease))return false;
  return this.devices.transaction(async client=>{
   const r=(await client.query("SELECT hash,body,lease,attempts FROM mercury_guard.dashboard_outbox WHERE id=$1 AND status='pending' FOR UPDATE",[job.id])).rows[0];
   if(!r||r.lease!==job.lease)return false;
   if(r.hash!==job.hash||r.body!==job.body||hash(r.body)!==r.hash)throw Error('Immutable delivery payload changed');
   const delay=Math.min(3600000,1000*2**Math.min(Number(r.attempts),12));
   await client.query('UPDATE mercury_guard.dashboard_outbox SET next_at=$1,lease=NULL,lease_until=NULL WHERE id=$2',[now+delay,job.id]);return true;
  });
 }
 close(){}
}
