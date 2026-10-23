import {createHash} from 'node:crypto';
const id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function time(x){if(typeof x!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(x))throw Error('Explicit timestamp required');const n=Date.parse(x);if(!Number.isSafeInteger(n)||n<=0)throw Error('Invalid timestamp');return n;}
// Administrative local adapter. Call only with authenticated source rows and approved
// guard/vendor/site bindings. Missing rows never imply cancellation.
export class OpsAssignmentSync{
 constructor(devices){
  this.devices=devices;this.db=devices.db;
  this.db.exec(`CREATE TABLE IF NOT EXISTS ops_assignment_sync(source_id TEXT PRIMARY KEY,source_at INTEGER NOT NULL,binding_revision INTEGER NOT NULL,source_digest TEXT NOT NULL,binding_digest TEXT NOT NULL,digest TEXT NOT NULL,material TEXT NOT NULL,assignment_id TEXT,active INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS ops_assignment_history(sequence INTEGER PRIMARY KEY AUTOINCREMENT,source_id TEXT NOT NULL,source_at INTEGER NOT NULL,binding_revision INTEGER NOT NULL,assignment_id TEXT,previous_assignment_id TEXT,status TEXT NOT NULL);`);
 }
 apply(shift,binding){
  if(!shift||!binding||!id(shift.id)||binding.opsShiftId!==shift.id||!['guardId','vendorId','siteId'].every(k=>id(binding[k]))||typeof binding.active!=='boolean'||!Number.isSafeInteger(binding.revision)||binding.revision<1)throw Error('Explicit assignment binding required');
  const sourceAt=time(shift.updated_at),startsAt=time(shift.scheduled_start),endsAt=time(shift.scheduled_end);
  if(startsAt>=endsAt||!['scheduled','clocked_in','late','not_clocked_in','completed','cancelled'].includes(shift.status))throw Error('Invalid upstream assignment');
  const active=binding.active&&!['completed','cancelled'].includes(shift.status);
  const material={guardId:binding.guardId,vendorId:binding.vendorId,siteId:binding.siteId,startsAt,endsAt,...(binding.patrolRoute?{patrolRoute:binding.patrolRoute}:{}),...(binding.checkInPolicy?{checkInPolicy:binding.checkInPolicy}:{})};
  const sourceDigest=hash({startsAt,endsAt,status:shift.status}),bindingDigest=hash({guardId:binding.guardId,vendorId:binding.vendorId,siteId:binding.siteId,active:binding.active,patrolRoute:binding.patrolRoute??null,checkInPolicy:binding.checkInPolicy??null});
  const materialHash=hash(material),digest=hash({material,active,sourceAt,revision:binding.revision,status:shift.status});
  this.db.exec('BEGIN IMMEDIATE');
  try{
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
