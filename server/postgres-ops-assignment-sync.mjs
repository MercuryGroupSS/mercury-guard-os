import {createHash} from 'node:crypto';
import {prepareOpsSync,id,hash} from './ops-sync-input.mjs';
const row=r=>r?{...r,source_at:Number(r.source_at),binding_revision:Number(r.binding_revision)}:null;
export class PostgresOpsAssignmentSync{
 constructor(devices){if(typeof devices?.transaction!=='function'||typeof devices?.assign!=='function'||typeof devices?.cancel!=='function')throw Error('Transactional device adapter required');this.devices=devices;}
 async lock(client,source){
  // Transaction-scoped lock covers the first import, when no ledger row exists yet.
  const key=createHash('sha256').update('mercury-ops-sync:'+source).digest().readBigInt64BE().toString();
  await client.query('SELECT pg_advisory_xact_lock($1::bigint)',[key]);
 }
 async revokeBinding(binding){
  if(!binding||!['opsShiftId','guardId','vendorId','siteId'].every(k=>id(binding[k]))||binding.active!==false||!Number.isSafeInteger(binding.revision)||binding.revision<1)throw Error('Disabled approved binding required');
  return this.devices.transaction(async client=>{
   await this.lock(client,binding.opsShiftId);
   const previous=row((await client.query('SELECT * FROM mercury_guard.ops_assignment_sync WHERE source_id=$1',[binding.opsShiftId])).rows[0]);
   const revoked=(await client.query('SELECT revision FROM mercury_guard.ops_binding_revocations WHERE source_id=$1',[binding.opsShiftId])).rows[0];
   if(previous&&(binding.revision<previous.binding_revision||(binding.revision===previous.binding_revision&&previous.active)))throw Error('Stale revocation');
   if(revoked&&binding.revision<Number(revoked.revision))throw Error('Stale revocation');
   if(revoked&&Number(revoked.revision)===binding.revision)return {status:'unchanged'};
   if(previous?.assignment_id)await this.devices.cancel(previous.assignment_id,client);
   await client.query('UPDATE mercury_guard.ops_assignment_sync SET active=false WHERE source_id=$1',[binding.opsShiftId]);
   await client.query('INSERT INTO mercury_guard.ops_binding_revocations VALUES($1,$2) ON CONFLICT(source_id) DO UPDATE SET revision=excluded.revision',[binding.opsShiftId,binding.revision]);
   await client.query('INSERT INTO mercury_guard.ops_assignment_history(source_id,source_at,binding_revision,assignment_id,previous_assignment_id,status) VALUES($1,$2,$3,$4,$5,$6)',[binding.opsShiftId,previous?.source_at??0,binding.revision,previous?.assignment_id??null,previous?.assignment_id??null,'binding_revoked']);
   return {status:'binding_revoked'};
  });
 }
 async apply(shift,binding){
  const {sourceAt,active,material,sourceDigest,bindingDigest,materialHash,digest}=prepareOpsSync(shift,binding);
  return this.devices.transaction(async client=>{
   await this.lock(client,shift.id);
   const revoked=(await client.query('SELECT revision FROM mercury_guard.ops_binding_revocations WHERE source_id=$1',[shift.id])).rows[0];
   if(revoked&&(binding.revision<Number(revoked.revision)||(binding.active&&binding.revision===Number(revoked.revision))))throw Error('Revoked binding revision');
   const previous=row((await client.query('SELECT * FROM mercury_guard.ops_assignment_sync WHERE source_id=$1',[shift.id])).rows[0]);
   if(previous&&(sourceAt<previous.source_at||binding.revision<previous.binding_revision))throw Error('Stale source or binding');
   if(previous&&((sourceAt===previous.source_at&&previous.source_digest!==sourceDigest)||(binding.revision===previous.binding_revision&&previous.binding_digest!==bindingDigest)))throw Error('Conflicting source or binding revision');
   if(previous&&sourceAt===previous.source_at&&binding.revision===previous.binding_revision){if(previous.digest!==digest)throw Error('Conflicting source revision');return {status:'unchanged',assignmentId:previous.assignment_id};}
   let assignmentId=previous?.assignment_id??null;
   const replace=active&&(!previous||!previous.active||previous.material!==materialHash);
   if(previous?.assignment_id&&(!active||replace))await this.devices.cancel(previous.assignment_id,client);
   if(replace){assignmentId='ops-'+hash({source:shift.id,sourceAt,revision:binding.revision,material});await this.devices.assign({...material,assignmentId,active:true},client);}
   const status=replace?'assignment_created':active?'source_refreshed':'assignment_cancelled';
   await client.query('INSERT INTO mercury_guard.ops_assignment_sync VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(source_id) DO UPDATE SET source_at=excluded.source_at,binding_revision=excluded.binding_revision,source_digest=excluded.source_digest,binding_digest=excluded.binding_digest,digest=excluded.digest,material=excluded.material,assignment_id=excluded.assignment_id,active=excluded.active',[shift.id,sourceAt,binding.revision,sourceDigest,bindingDigest,digest,materialHash,assignmentId,active]);
   await client.query('INSERT INTO mercury_guard.ops_assignment_history(source_id,source_at,binding_revision,assignment_id,previous_assignment_id,status) VALUES($1,$2,$3,$4,$5,$6)',[shift.id,sourceAt,binding.revision,assignmentId,previous?.assignment_id??null,status]);
   return {status,assignmentId};
  });
 }
}
