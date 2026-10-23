import {createHash,randomUUID} from 'node:crypto';
import {scopeKey,prepareDispatchVersion,stable} from './dispatch-input.mjs';
import {DispatchCursorError} from './dispatch-feed.mjs';
export class PostgresDispatchFeed{
 constructor(devices){if(typeof devices?.transaction!=='function'||typeof devices?.pool?.query!=='function')throw Error('Transactional PostgreSQL devices required');this.devices=devices;this.pool=devices.pool;}
 async publish(scope,value,existingClient=null){
  const {key,body}=prepareDispatchVersion(scope,value);
  return this.devices.transaction(async client=>{
   await client.query('SELECT pg_advisory_xact_lock(724910621355084::bigint)');
   if((await client.query('SELECT 1 FROM mercury_guard.assignments WHERE assignment_id=$1 AND guard_id=$2 AND vendor_id=$3 AND site_id=$4',[scope.assignmentId,scope.guardId,scope.vendorId,scope.siteId])).rowCount!==1)throw Error('Approved dispatch assignment required');
   const old=(await client.query('SELECT body FROM mercury_guard.dispatch_changes WHERE scope=$1 AND id=$2 AND version=$3',[key,value.message_id,value.version])).rows[0];
   if(old){if(old.body!==body)throw Error('Message version content conflict');return;}
   const last=Number((await client.query('SELECT COALESCE(MAX(version),0) version FROM mercury_guard.dispatch_changes WHERE scope=$1 AND id=$2',[key,value.message_id])).rows[0].version);
   if(value.version!==last+1)throw Error('Message versions must advance one step');
   await client.query('INSERT INTO mercury_guard.dispatch_changes(scope,id,version,body,guard_id,vendor_id,site_id,assignment_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[key,value.message_id,value.version,body,scope.guardId,scope.vendorId,scope.siteId,scope.assignmentId]);
  },existingClient);
 }
 async read(scope,cursor,now=Date.now()){
  const key=scopeKey(scope);
  if(!Number.isSafeInteger(now)||now<=0||!/^[a-f0-9]{64}$/.test(scope.deviceThumbprint)||!Number.isSafeInteger(scope.revocationVersion)||scope.revocationVersion<0)throw Error('Verified device scope required');
  const owner=createHash('sha256').update(JSON.stringify([key,scope.deviceThumbprint,scope.revocationVersion])).digest('hex');
  return this.devices.transaction(async client=>{
   await client.query('SELECT pg_advisory_xact_lock(724910621355084::bigint)');
   const current=await client.query(`SELECT 1 FROM mercury_guard.assignments a
    JOIN mercury_guard.guards g ON g.guard_id=a.guard_id AND g.vendor_id=a.vendor_id
    JOIN mercury_guard.vendors v ON v.vendor_id=g.vendor_id JOIN mercury_guard.sites s ON s.site_id=a.site_id
    JOIN mercury_guard.devices d ON d.thumbprint=$1
    WHERE a.assignment_id=$2 AND g.guard_id=$3 AND v.vendor_id=$4 AND s.site_id=$5
     AND a.active AND a.ends_at_ms>$6 AND g.active AND v.active AND s.active AND d.active AND NOT d.revoked
     AND d.revocation_version=$7 AND ((d.mode='site' AND d.site_id=a.site_id) OR (d.mode='personal' AND d.guard_id=g.guard_id))
    FOR SHARE OF a,g,v,s,d`,[scope.deviceThumbprint,scope.assignmentId,scope.guardId,scope.vendorId,scope.siteId,now,scope.revocationVersion]);
   if(current.rowCount!==1)throw Error('Dispatch scope unavailable');
   await client.query('DELETE FROM mercury_guard.dispatch_cursors WHERE expires<=$1',[now]);
   let after=0;
   if(cursor!==null){
    if(typeof cursor!=='string'||!(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i).test(cursor))throw new DispatchCursorError('Cursor unavailable');
    const saved=(await client.query('SELECT sequence FROM mercury_guard.dispatch_cursors WHERE token=$1 AND scope=$2',[cursor,owner])).rows[0];if(!saved)throw new DispatchCursorError('Cursor unavailable');after=Number(saved.sequence);
   }
   const max=Number((await client.query('SELECT COALESCE(MAX(sequence),0) n FROM mercury_guard.dispatch_changes')).rows[0].n);if(after<0||after>max)throw new DispatchCursorError('Cursor unavailable');
   const rows=(await client.query('SELECT c.sequence,c.body FROM mercury_guard.dispatch_changes c WHERE c.scope=$1 AND c.sequence>$2 AND NOT EXISTS(SELECT 1 FROM mercury_guard.dispatch_changes n WHERE n.scope=c.scope AND n.id=c.id AND n.sequence>c.sequence) ORDER BY c.sequence LIMIT 26',[key,after])).rows;
   const selected=[];let bytes=0;for(const row of rows){const size=Buffer.byteLength(row.body);if(selected.length===25||bytes+size>220000)break;selected.push(row);bytes+=size;}
   const more=selected.length<rows.length,next=more?Number(selected.at(-1).sequence):max;
   const saved=(await client.query('SELECT token FROM mercury_guard.dispatch_cursors WHERE scope=$1 AND sequence=$2',[owner,next])).rows[0];const token=saved?.token??randomUUID();
   if(saved)await client.query('UPDATE mercury_guard.dispatch_cursors SET expires=$1 WHERE token=$2',[now+86400000,token]);else await client.query('INSERT INTO mercury_guard.dispatch_cursors VALUES($1,$2,$3,$4)',[token,owner,next,now+86400000]);
   return {scope:{guard_id:scope.guardId,vendor_id:scope.vendorId,site_id:scope.siteId,assignment_id:scope.assignmentId,device_thumbprint:scope.deviceThumbprint,revocation_version:scope.revocationVersion},changes:selected.map(r=>JSON.parse(r.body)),next_cursor:token,has_more:more,server_time_ms:now};
  });
 }
 async validateAcknowledgement(scope,event){
  const d=event?.data;
  if(event?.kind!=='dispatch_ack'||!Number.isSafeInteger(event.at)||event.at<=0||!d||Object.keys(d).sort().join()!=='capture_grant_id,message_id,message_version'||!stable(d.message_id)||!Number.isSafeInteger(d.message_version)||d.message_version<1)throw Error('Invalid acknowledgement');
  const row=(await this.pool.query('SELECT body FROM mercury_guard.dispatch_changes WHERE scope=$1 AND id=$2 AND version=$3',[scopeKey(scope),d.message_id,d.message_version])).rows[0];if(!row)throw Error('Message version unavailable');const message=JSON.parse(row.body);
  if(message.state!=='active'||message.issued_at>event.at)throw Error('Message not acknowledgeable');return {message_id:message.message_id,message_version:message.version};
 }
 close(){}
}
