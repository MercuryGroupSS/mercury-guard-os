import {prepareOpsSync,id,hash} from './ops-sync-input.mjs';
// Administrative local adapter. Call only with authenticated source rows and approved
// guard/vendor/site bindings. Missing rows never imply cancellation.
export class OpsAssignmentSync{
 constructor(devices){
  this.devices=devices;this.db=devices.db;
  this.db.exec(`CREATE TABLE IF NOT EXISTS ops_assignment_sync(source_id TEXT PRIMARY KEY,source_at INTEGER NOT NULL,binding_revision INTEGER NOT NULL,source_digest TEXT NOT NULL,binding_digest TEXT NOT NULL,digest TEXT NOT NULL,material TEXT NOT NULL,assignment_id TEXT,active INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS ops_binding_revocations(source_id TEXT PRIMARY KEY,revision INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS ops_assignment_history(sequence INTEGER PRIMARY KEY AUTOINCREMENT,source_id TEXT NOT NULL,source_at INTEGER NOT NULL,binding_revision INTEGER NOT NULL,assignment_id TEXT,previous_assignment_id TEXT,status TEXT NOT NULL);`);
 }
 revokeBinding(binding){
  if(!binding||!['opsShiftId','guardId','vendorId','siteId'].every(k=>id(binding[k]))||binding.active!==false||!Number.isSafeInteger(binding.revision)||binding.revision<1)throw Error('Disabled approved binding required');
  this.db.exec('BEGIN IMMEDIATE');try{
   const previous=this.db.prepare('SELECT * FROM ops_assignment_sync WHERE source_id=?').get(binding.opsShiftId);
   const revoked=this.db.prepare('SELECT revision FROM ops_binding_revocations WHERE source_id=?').get(binding.opsShiftId);
   if(previous&&(binding.revision<previous.binding_revision||(binding.revision===previous.binding_revision&&previous.active)))throw Error('Stale revocation');
   if(revoked&&binding.revision<revoked.revision)throw Error('Stale revocation');
   if(revoked?.revision===binding.revision){this.db.exec('COMMIT');return {status:'unchanged'};}
   if(previous?.assignment_id)this.devices.cancel(previous.assignment_id);
   this.db.prepare('UPDATE ops_assignment_sync SET active=0 WHERE source_id=?').run(binding.opsShiftId);
   this.db.prepare('INSERT INTO ops_binding_revocations VALUES(?,?) ON CONFLICT(source_id) DO UPDATE SET revision=excluded.revision').run(binding.opsShiftId,binding.revision);
   this.db.prepare('INSERT INTO ops_assignment_history(source_id,source_at,binding_revision,assignment_id,previous_assignment_id,status) VALUES(?,?,?,?,?,?)').run(binding.opsShiftId,previous?.source_at??0,binding.revision,previous?.assignment_id??null,previous?.assignment_id??null,'binding_revoked');
   this.db.exec('COMMIT');return {status:'binding_revoked'};
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 apply(shift,binding){
  const {sourceAt,active,material,sourceDigest,bindingDigest,materialHash,digest}=prepareOpsSync(shift,binding);
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const revoked=this.db.prepare('SELECT revision FROM ops_binding_revocations WHERE source_id=?').get(shift.id);
   if(revoked&&(binding.revision<revoked.revision||(binding.active&&binding.revision===revoked.revision)))throw Error('Revoked binding revision');
   const previous=this.db.prepare('SELECT * FROM ops_assignment_sync WHERE source_id=?').get(shift.id);
   if(previous&&(sourceAt<previous.source_at||binding.revision<previous.binding_revision))throw Error('Stale source or binding');
   if(previous&&((sourceAt===previous.source_at&&previous.source_digest!==sourceDigest)||(binding.revision===previous.binding_revision&&previous.binding_digest!==bindingDigest)))throw Error('Conflicting source or binding revision');
   if(previous&&sourceAt===previous.source_at&&binding.revision===previous.binding_revision){
    if(previous.digest!==digest)throw Error('Conflicting source revision');
    this.db.exec('COMMIT');return {status:'unchanged',assignmentId:previous.assignment_id};
   }
   // A mapping revision must advance whenever identity, policy or schedule binding changes
   // without a newer upstream timestamp. Equal-time conflicting snapshots are never guessed.
   let assignmentId=previous?.assignment_id??null;
   const replace=active&&(!previous||!previous.active||previous.material!==materialHash);
   if(previous?.assignment_id&&(!active||replace))this.devices.cancel(previous.assignment_id);
   if(replace){
    assignmentId='ops-'+hash({source:shift.id,sourceAt,revision:binding.revision,material});
    this.devices.assign({...material,assignmentId,active:true});
   }
   const status=replace?'assignment_created':active?'source_refreshed':'assignment_cancelled';
   this.db.prepare('INSERT INTO ops_assignment_sync VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET source_at=excluded.source_at,binding_revision=excluded.binding_revision,source_digest=excluded.source_digest,binding_digest=excluded.binding_digest,digest=excluded.digest,material=excluded.material,assignment_id=excluded.assignment_id,active=excluded.active').run(shift.id,sourceAt,binding.revision,sourceDigest,bindingDigest,digest,materialHash,assignmentId,Number(active));
   this.db.prepare('INSERT INTO ops_assignment_history(source_id,source_at,binding_revision,assignment_id,previous_assignment_id,status) VALUES(?,?,?,?,?,?)').run(shift.id,sourceAt,binding.revision,assignmentId,previous?.assignment_id??null,status);
   this.db.exec('COMMIT');return {status,assignmentId};
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
}
