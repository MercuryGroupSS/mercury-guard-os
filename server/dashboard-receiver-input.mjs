import {createHash} from 'node:crypto';
import {prepareDashboardMapping} from './dashboard-mapping-input.mjs';
const id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
export const receiverMappingKeys=m=>[m.assignmentId,m.guardId,m.vendorId,m.siteId,m.destination];
export function receiverScope(value){
 const result=Object.fromEntries(['assignmentId','guardId','vendorId','siteId','destination'].map(k=>[k,value?.[k]]));
 if(Object.values(result).some(x=>!id(x)))throw Error('Explicit receiver scope required');return result;
}
export function receiverMappingLock(scope){
 const digest=createHash('sha256').update('mercury-one-receiver-mapping-v1\n'+JSON.stringify(receiverMappingKeys(receiverScope(scope)))).digest();return digest.readBigInt64BE().toString();
}
export function receiverApproval(value){
 if(!value||Object.keys(value).sort().join()!=='mapping,operator,reason,requestId'||typeof value.requestId!=='string'||!/^([a-f0-9]{8}-)([a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value.requestId)||typeof value.operator!=='string'||!value.operator.trim()||value.operator.length>120||typeof value.reason!=='string'||!value.reason.trim()||value.reason.length>2000)throw Error('Reasoned owner approval and request ID required');
 const mapping=prepareDashboardMapping(value.mapping);if(Object.keys(value.mapping).sort().join()!==Object.keys(mapping).sort().join())throw Error('Unexpected receiver mapping fields');
 return {requestId:value.requestId,mapping,operator:value.operator,reason:value.reason};
}
export const receiverRow=r=>r?{assignmentId:r.assignment_id,guardId:r.guard_id,vendorId:r.vendor_id,siteId:r.site_id,dashboardShiftId:r.dashboard_shift_id,destination:r.destination,revision:Number(r.revision),active:r.active}:null;
export async function receiverTransaction(pool,fn){
 const client=await pool.connect();try{await client.query('BEGIN');const value=await fn(client);await client.query('COMMIT');return value;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
