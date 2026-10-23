import {createHash} from 'node:crypto';
import {receiverApproval,receiverMappingKeys,receiverMappingLock,receiverRow,receiverScope,receiverTransaction} from './dashboard-receiver-input.mjs';
// Owner command only. The HTTP receiver never imports or exposes this module.
export class ReceiverMappingOwner{
 constructor(pool){if(typeof pool?.connect!=='function')throw Error('Owner PostgreSQL pool required');this.pool=pool;}
 async review(input){const value=receiverApproval(input);return {mode:'review',...value,current:await this.current(value.mapping)};}
 async current(scope){const s=receiverScope(scope);return receiverRow((await this.pool.query('SELECT * FROM mercury_guard_receiver.bindings WHERE assignment_id=$1 AND guard_id=$2 AND vendor_id=$3 AND site_id=$4 AND destination=$5',receiverMappingKeys(s))).rows[0]);}
 async approve(input){
  const value=receiverApproval(input),m=value.mapping,digest=createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return receiverTransaction(this.pool,async client=>{
   if((await client.query('SELECT current_user AS role')).rows[0]?.role!=='postgres')throw Error('Receiver approval requires the database owner');
   await client.query('SELECT pg_advisory_xact_lock($1::bigint)',[receiverMappingLock(m)]);
   // Exact retry returns its original receipt, including after a newer revocation.
   const prior=(await client.query('SELECT input_hash,receipt FROM mercury_guard_receiver.mapping_history WHERE request_id=$1',[value.requestId])).rows[0];
   if(prior){if(prior.input_hash!==digest)throw Error('Receiver approval request conflict');return prior.receipt;}
   const current=(await client.query('SELECT revision FROM mercury_guard_receiver.bindings WHERE assignment_id=$1 AND guard_id=$2 AND vendor_id=$3 AND site_id=$4 AND destination=$5',receiverMappingKeys(m))).rows[0];
   if(current&&m.revision<=Number(current.revision))throw Error('Receiver mapping revision must advance');
   const receipt={status:'receiver_mapping_recorded',request_id:value.requestId,mapping:m};
   await client.query('INSERT INTO mercury_guard_receiver.mapping_history(request_id,assignment_id,guard_id,vendor_id,site_id,destination,revision,body,input_hash,receipt,operator_label,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[value.requestId,...receiverMappingKeys(m),m.revision,m,digest,receipt,value.operator,value.reason]);
   await client.query('INSERT INTO mercury_guard_receiver.bindings(assignment_id,guard_id,vendor_id,site_id,destination,revision,dashboard_shift_id,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(assignment_id,guard_id,vendor_id,site_id,destination) DO UPDATE SET revision=excluded.revision,dashboard_shift_id=excluded.dashboard_shift_id,active=excluded.active',[...receiverMappingKeys(m),m.revision,m.dashboardShiftId,m.active]);
   return receipt;
  });
 }
}
