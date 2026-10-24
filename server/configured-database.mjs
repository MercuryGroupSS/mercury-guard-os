import {Pool} from 'pg';
import {configuredDeploymentIdentity} from './configured-service-config.mjs';

const required=['vendors','guards','guard_login','devices','sites','assignments','device_challenges','ops_assignment_sync','ops_binding_revocations','ops_assignment_history','ops_bindings','ops_binding_history','shift_sessions','shift_transitions','shift_rejections','capture_grants','ingested_events','ingest_receipts','ingested_checkpoints','ingested_check_ins','ingested_media','evidence_chunks','missed_check_ins','check_in_alert_outbox','check_in_worker_state','check_in_worker_runs','dispatch_changes','dispatch_cursors','dashboard_bindings','dashboard_mapping_history','dashboard_outbox','dashboard_bridge_state','admin_accounts','admin_audit','admin_membership_audit','escalations','escalation_acknowledgements','location_consents','location_consent_withdrawals','location_consent_requests','deployment_identity'];
export async function assertConfiguredDeploymentIdentity(pool,expected){
 const rows=(await pool.query('SELECT deployment_id::text,auth_origin,public_origin,issuer,audience,issuer_key_id,issuer_spki_sha256 FROM mercury_guard.deployment_identity WHERE singleton')).rows;
 if(rows.length!==1||Object.keys(expected).some(k=>rows[0][k]!==expected[k]))throw Error('Guard deployment identity unavailable');
}
export async function assertConfiguredDatabase(pool,expected){
 try{
  const state=(await pool.query(`SELECT current_user AS role,
   has_column_privilege(current_user,'auth.sessions','id','SELECT') AND has_column_privilege(current_user,'auth.sessions','user_id','SELECT') AND has_column_privilege(current_user,'auth.sessions','not_after','SELECT') AS sessions,
   has_table_privilege(current_user,'mercury_guard.deployment_identity','SELECT') AND NOT has_table_privilege(current_user,'mercury_guard.deployment_identity','INSERT,UPDATE,DELETE,TRUNCATE') AS marker_read_only,
   has_column_privilege(current_user,'mercury_guard.location_consents','ordinal','SELECT') AS consent_order`)).rows[0];
  if(state?.role!=='service_role'||state.sessions!==true||state.marker_read_only!==true||state.consent_order!==true)throw Error();
  const tables=required.map(t=>'mercury_guard.'+t).concat(['mercury_guard_receiver.bindings','mercury_guard_receiver.observations','mercury_guard_receiver.media','mercury_guard_receiver.media_chunks']);
  if((await pool.query('SELECT EXISTS(SELECT 1 FROM unnest($1::text[]) n WHERE to_regclass(n) IS NULL) AS missing',[tables])).rows[0]?.missing!==false)throw Error();
  await assertConfiguredDeploymentIdentity(pool,expected);
 }catch{throw Error('Guard deployment database identity or schema unavailable');}
}
export async function openConfiguredDatabase(config,materials,{poolFactory=options=>new Pool(options)}={}){
 const pool=poolFactory({connectionString:config.database.url,max:4,connectionTimeoutMillis:5000,idleTimeoutMillis:30000,query_timeout:12000,statement_timeout:10000,options:'-c role=service_role',ssl:config.mode==='configured'?{rejectUnauthorized:true,...(materials.databaseCa?{ca:materials.databaseCa}:{})}:false});
 pool.on('error',()=>{});
 try{await assertConfiguredDatabase(pool,configuredDeploymentIdentity(config,materials));return pool;}
 catch{await pool.end();throw Error('Configured PostgreSQL startup failed; no fallback was selected');}
}
