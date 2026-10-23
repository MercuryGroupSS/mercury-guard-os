import {LocalDeviceAssignments} from './local-device-assignments.mjs';
import {OpsAssignmentSync} from './ops-assignment-sync.mjs';
import {PostgresGuardDirectory} from './postgres-guard-directory.mjs';
import {PostgresDeviceAssignments} from './postgres-device-assignments.mjs';
import {PostgresOpsAssignmentSync} from './postgres-ops-assignment-sync.mjs';
export async function openLocalAssignmentStore({mode='sqlite',directory,sqlitePath}){
 if(!['sqlite','postgres'].includes(mode))throw Error('Explicit assignment store mode required');
 if(mode==='sqlite'){
  const devices=new LocalDeviceAssignments(sqlitePath);
  try{return {devices,sync:new OpsAssignmentSync(devices),close:()=>devices.close()};}catch(error){devices.close();throw error;}
 }
 if(!(directory instanceof PostgresGuardDirectory)||typeof directory.client?.connect!=='function')throw Error('PostgreSQL assignments require the PostgreSQL identity pool');
 const pool=directory.client;
 try{
  const {rows}=await pool.query("SELECT current_user AS role,to_regclass('mercury_guard.devices') IS NOT NULL AND to_regclass('mercury_guard.sites') IS NOT NULL AND to_regclass('mercury_guard.assignments') IS NOT NULL AND to_regclass('mercury_guard.device_challenges') IS NOT NULL AND to_regclass('mercury_guard.ops_assignment_sync') IS NOT NULL AND to_regclass('mercury_guard.ops_binding_revocations') IS NOT NULL AND to_regclass('mercury_guard.ops_assignment_history') IS NOT NULL AND to_regclass('mercury_guard.ops_bindings') IS NOT NULL AND to_regclass('mercury_guard.ops_binding_history') IS NOT NULL AND to_regclass('mercury_guard.shift_sessions') IS NOT NULL AND to_regclass('mercury_guard.shift_transitions') IS NOT NULL AND to_regclass('mercury_guard.shift_rejections') IS NOT NULL AND to_regclass('mercury_guard.capture_grants') IS NOT NULL AND to_regclass('mercury_guard.ingested_events') IS NOT NULL AND to_regclass('mercury_guard.ingest_receipts') IS NOT NULL AND to_regclass('mercury_guard.ingested_checkpoints') IS NOT NULL AND to_regclass('mercury_guard.ingested_check_ins') IS NOT NULL AND to_regclass('mercury_guard.ingested_media') IS NOT NULL AND to_regclass('mercury_guard.missed_check_ins') IS NOT NULL AND to_regclass('mercury_guard.check_in_alert_outbox') IS NOT NULL AND to_regclass('mercury_guard.check_in_worker_state') IS NOT NULL AND to_regclass('mercury_guard.check_in_worker_runs') IS NOT NULL AS ready");
  if(rows[0]?.role!=='service_role'||rows[0]?.ready!==true)throw Error('Assignment schema unavailable');
  const devices=new PostgresDeviceAssignments(pool);
  // The directory owns this pool; close it only after service/worker shutdown.
  return {devices,sync:new PostgresOpsAssignmentSync(devices),close:()=>{}};
 }catch{throw Error('PostgreSQL assignment startup failed; no fallback was selected');}
}
