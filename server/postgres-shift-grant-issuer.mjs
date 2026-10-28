import {requirePostgresAuthSession} from './postgres-auth-session.mjs';
import {ShiftGrantSigner} from './shift-grant-signer.mjs';
export class PostgresShiftGrantIssuer extends ShiftGrantSigner{
 constructor({devices,locationConsents=null,...config}){super(config);if(typeof devices?.transaction!=='function'||typeof devices?.pool?.query!=='function')throw Error('Transactional PostgreSQL devices required');this.devices=devices;this.pool=devices.pool;this.locationConsents=locationConsents;}
 async issue(context){
  const base={...context,allowedActions:context.allowedActions.filter(action=>action!=='location'),location:null},prepared=this.prepare(base),{identity,assignment,device,now=Date.now()}=context;
  return this.devices.transaction(async client=>{
   // Shares the clock-event lock: clock-out and grant issuance have one commit order.
   await client.query('SELECT pg_advisory_xact_lock(724910621355082::bigint)');
   await requirePostgresAuthSession(client,context.session,identity.subject,now);
   const {rows}=await client.query(`SELECT 1 FROM mercury_guard.assignments a
    JOIN mercury_guard.guards g ON g.guard_id=a.guard_id AND g.vendor_id=a.vendor_id
    JOIN mercury_guard.vendors v ON v.vendor_id=g.vendor_id
    JOIN mercury_guard.sites s ON s.site_id=a.site_id
    JOIN mercury_guard.devices d ON d.thumbprint=$1
    JOIN mercury_guard.shift_sessions h ON h.assignment=a.assignment_id AND h.guard=g.guard_id AND h.vendor=v.vendor_id AND h.site=s.site_id AND h.device=d.thumbprint
    WHERE a.assignment_id=$2 AND g.auth_subject=$3::uuid AND g.guard_id=$4 AND v.vendor_id=$5 AND s.site_id=$6
     AND a.active AND g.active AND v.active AND s.active AND d.active AND NOT d.revoked
     AND d.device_id=$7 AND d.revocation_version=$8 AND h.clocked_out IS NULL
     AND a.starts_at_ms=$9 AND a.ends_at_ms=$10 AND h.starts_at=a.starts_at_ms AND h.ends_at=a.ends_at_ms
     AND h.clocked_in<=$11 AND $11<a.ends_at_ms
     AND a.patrol_route IS NOT DISTINCT FROM $12::jsonb
     AND a.location_policy IS NOT DISTINCT FROM $13::jsonb
     AND ((d.mode='site' AND d.site_id=a.site_id) OR (d.mode='personal' AND d.guard_id=g.guard_id))
    FOR SHARE OF a,g,v,s,d,h`,[device.thumbprint,assignment.assignmentId,identity.subject,identity.guardId,identity.vendorId,assignment.siteId,device.deviceId,device.revocationVersion,assignment.startsAt,assignment.endsAt,now,prepared.policy.patrolRoute??null,assignment.locationPolicy??null]);
   if(rows.length!==1)throw Error('Confirmed capture scope unavailable');
   const location=this.locationConsents?await this.locationConsents.forGrant(client,context):null;
   const {claims,policy,payload,response}=location?this.prepare({...base,location,allowedActions:[...base.allowedActions,'location']}):prepared;
   await client.query('INSERT INTO mercury_guard.capture_grants(id,subject,vendor_id,assignment_id,device_thumbprint,payload,policy) VALUES($1,$2,$3,$4,$5,$6,$7)',[claims.grant_id,identity.subject,identity.vendorId,assignment.assignmentId,device.thumbprint,payload,policy]);
   await requirePostgresAuthSession(client,context.session,identity.subject,now);
   return response;
  });
 }
 async lookup(grantId){
  if(typeof grantId!=='string'||!(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i).test(grantId))return null;
  const r=(await this.pool.query('SELECT subject,vendor_id,payload,policy FROM mercury_guard.capture_grants WHERE id=$1 AND NOT revoked',[grantId])).rows[0];
  return r?{subject:r.subject,vendorId:r.vendor_id,claims:JSON.parse(Buffer.from(r.payload,'base64url').toString('utf8')),policy:r.policy}:null;
 }
 async revoke(grantId){if((await this.pool.query('UPDATE mercury_guard.capture_grants SET revoked=true WHERE id=$1',[grantId])).rowCount!==1)throw Error('Unknown grant');}
 close(){}
}
