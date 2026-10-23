import {prepareOpsBinding} from './ops-binding-input.mjs';
// Trusted administrative storage. Operator labels do not authenticate an administrator.
export class PostgresOpsBindingStore{
 constructor(pool){if(typeof pool?.connect!=='function'||typeof pool?.query!=='function')throw Error('PostgreSQL pool required');this.pool=pool;}
 async approve(binding,context){
  const prepared=prepareOpsBinding(binding,context),client=await this.pool.connect();
  try{
   await client.query('BEGIN');
   // Serialize approvals globally to enforce the bounded store even on first insert.
   await client.query('SELECT pg_advisory_xact_lock(724910621355081::bigint)');
   const prior=(await client.query('SELECT revision FROM mercury_guard.ops_bindings WHERE source_id=$1',[binding.opsShiftId])).rows[0];
   if(prior&&binding.revision<=Number(prior.revision)){
    const old=(await client.query('SELECT body,operator_label,reason FROM mercury_guard.ops_binding_history WHERE source_id=$1 AND revision=$2',[binding.opsShiftId,binding.revision])).rows[0];
    if(binding.revision!==Number(prior.revision)||!old||prepareOpsBinding(old.body,{operator:old.operator_label,reason:old.reason}).body!==prepared.body||old.operator_label!==prepared.operator||old.reason!==prepared.reason)throw Error('Approval revision must advance');
    await client.query('COMMIT');return {status:'unchanged',revision:Number(prior.revision)};
   }
   if(!prior&&Number((await client.query('SELECT count(*) n FROM mercury_guard.ops_bindings')).rows[0].n)>=1000)throw Error('Binding capacity reached');
   await client.query('INSERT INTO mercury_guard.ops_binding_history VALUES($1,$2,$3,$4,$5,$6)',[binding.opsShiftId,binding.revision,prepared.body,prepared.operator,prepared.reason,prepared.now]);
   await client.query('INSERT INTO mercury_guard.ops_bindings VALUES($1,$2,$3) ON CONFLICT(source_id) DO UPDATE SET revision=excluded.revision,body=excluded.body',[binding.opsShiftId,binding.revision,prepared.body]);
   await client.query('COMMIT');return {status:'approved_locally',revision:binding.revision};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
 async list(){return (await this.pool.query('SELECT body FROM mercury_guard.ops_bindings ORDER BY source_id LIMIT 1001')).rows.map(r=>r.body);}
 close(){} // Shared pool belongs to the runtime directory.
}
