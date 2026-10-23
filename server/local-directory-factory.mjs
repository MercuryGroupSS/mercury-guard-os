import {LocalGuardDirectory} from './local-guard-directory.mjs';
import {PostgresGuardDirectory} from './postgres-guard-directory.mjs';
export async function openLocalGuardDirectory({config,mode='sqlite',sqlitePath}){
 if(config?.API_URL!=='http://127.0.0.1:55321'||!['sqlite','postgres'].includes(mode))throw Error('Explicit local directory mode required');
 if(mode==='sqlite')return new LocalGuardDirectory(sqlitePath);
 const url=new URL(config.DB_URL);
 if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost'].includes(url.hostname)||url.port!=='55322'||url.search||url.hash)throw Error('Isolated PostgreSQL connection required');
 const {Pool}=await import('pg');
 const pool=new Pool({connectionString:config.DB_URL,max:4,connectionTimeoutMillis:5000,idleTimeoutMillis:30000,query_timeout:5000,statement_timeout:5000,options:'-c role=service_role'});
 // Idle-client failures are reported by failed queries; never expose connection details.
 pool.on('error',()=>{});
 try{
  const {rows}=await pool.query("SELECT current_user AS role,to_regclass('mercury_guard.guards') IS NOT NULL AND to_regclass('mercury_guard.guard_login') IS NOT NULL AND to_regclass('mercury_guard.vendors') IS NOT NULL AND to_regprocedure('mercury_guard.consume_login_attempt(text)') IS NOT NULL AS ready");
  if(rows[0]?.role!=='service_role'||rows[0]?.ready!==true)throw Error('Identity schema unavailable');
  const directory=new PostgresGuardDirectory({client:pool});directory.close=()=>pool.end();return directory;
 }catch{await pool.end();throw Error('PostgreSQL identity startup failed; no fallback was selected');}
}
