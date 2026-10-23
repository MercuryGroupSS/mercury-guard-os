import {DatabaseSync} from 'node:sqlite';
const stable=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
// Local administrative approval records; operator labels are not authentication.
export class OpsBindingStore{
 constructor(path){this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS ops_bindings(source_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,body TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS ops_binding_history(source_id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,operator_label TEXT NOT NULL,reason TEXT NOT NULL,at_ms INTEGER NOT NULL,PRIMARY KEY(source_id,revision));`);}
 approve(binding,{operator,reason,now=Date.now()}={}){
  const required=['opsShiftId','guardId','vendorId','siteId','authSubject','revision','active'],optional=['patrolRoute','checkInPolicy'];
  if(!binding||required.some(k=>!Object.hasOwn(binding,k))||Object.keys(binding).some(k=>![...required,...optional].includes(k))||required.slice(0,5).some(k=>!stable(binding[k]))||!Number.isSafeInteger(binding.revision)||binding.revision<1||typeof binding.active!=='boolean')throw Error('Explicit complete binding required');
  if([operator,reason].some(x=>typeof x!=='string'||!x.trim()||x.length>500||/[\u0000-\u001f]/.test(x))||!Number.isSafeInteger(now)||now<=0)throw Error('Approval context required');
  const body=JSON.stringify(canonical(binding));if(Buffer.byteLength(body)>32768)throw Error('Binding too large');
  this.db.exec('BEGIN IMMEDIATE');try{
   const prior=this.db.prepare('SELECT * FROM ops_bindings WHERE source_id=?').get(binding.opsShiftId);
   if(prior&&binding.revision<=prior.revision){
    const old=this.db.prepare('SELECT * FROM ops_binding_history WHERE source_id=? AND revision=?').get(binding.opsShiftId,binding.revision);
    if(binding.revision!==prior.revision||old?.body!==body||old.operator_label!==operator.trim()||old.reason!==reason.trim())throw Error('Approval revision must advance');
    this.db.exec('COMMIT');return {status:'unchanged',revision:prior.revision};
   }
   if(!prior&&this.db.prepare('SELECT count(*) n FROM ops_bindings').get().n>=1000)throw Error('Binding capacity reached');
   this.db.prepare('INSERT INTO ops_binding_history VALUES(?,?,?,?,?,?)').run(binding.opsShiftId,binding.revision,body,operator.trim(),reason.trim(),now);
   this.db.prepare('INSERT INTO ops_bindings VALUES(?,?,?) ON CONFLICT(source_id) DO UPDATE SET revision=excluded.revision,body=excluded.body').run(binding.opsShiftId,binding.revision,body);
   this.db.exec('COMMIT');return {status:'approved_locally',revision:binding.revision};
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 list(){return this.db.prepare('SELECT body FROM ops_bindings ORDER BY source_id LIMIT 1001').all().map(r=>JSON.parse(r.body));}
 close(){this.db.close();}
}
