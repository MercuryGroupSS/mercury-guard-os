import {DatabaseSync} from 'node:sqlite';
import {prepareOpsBinding} from './ops-binding-input.mjs';
// Local administrative approval records; operator labels are not authentication.
export class OpsBindingStore{
 constructor(path){this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS ops_bindings(source_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,body TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS ops_binding_history(source_id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,operator_label TEXT NOT NULL,reason TEXT NOT NULL,at_ms INTEGER NOT NULL,PRIMARY KEY(source_id,revision));`);}
 approve(binding,{operator,reason,now=Date.now()}={}){
  const {body}=prepareOpsBinding(binding,{operator,reason,now});
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
