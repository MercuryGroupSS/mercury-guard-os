import {Pool} from 'pg';
import {createHash} from 'node:crypto';
import {checkServerIdentity} from 'node:tls';
import {OwnerAdminMembership} from './owner-admin-membership.mjs';
import {createAdminAuthAccountReader} from './admin-auth-account.mjs';
import {validateConfiguredOwnerInput} from './configured-owner-input.mjs';
const digest=request=>createHash('sha256').update(JSON.stringify({subject:request.subject,email:request.email,active:request.active,operator:request.operator,reason:request.reason})).digest('hex');
export function assertOwnerTls(client,hostname){
 const stream=client?.connection?.stream;
 if(stream?.encrypted!==true||stream.authorized!==true||typeof stream.getPeerCertificate!=='function'||checkServerIdentity(hostname.replace(/^\[|\]$/g,''),stream.getPeerCertificate()))throw Error('Verified owner database TLS required');
}
async function boundOwner(client,expected,lock=false){
 const role=(await client.query('SELECT current_user AS role,session_user AS session_role')).rows[0];if(role?.role!=='postgres'||role.session_role!=='postgres')throw Error('Exact database owner required');
 const rows=(await client.query('SELECT deployment_id::text,auth_origin,public_origin,issuer,audience,issuer_key_id,issuer_spki_sha256 FROM mercury_guard.deployment_identity WHERE singleton'+(lock?' FOR SHARE':''))).rows;
 if(rows.length!==1||Object.keys(expected).some(key=>rows[0][key]!==expected[key]))throw Error('Exact approved Guard deployment required');
}
// This command has no HTTP route, credential discovery or bootstrap authority.
// Both transaction boundaries use the same checked owner connection. FOR SHARE
// holds the exact marker stable through the existing membership commit.
export async function openConfiguredOwner(input,materials,{poolFactory=options=>new Pool(options),fetchImpl=fetch,now=Date.now}={}){
 const config=validateConfiguredOwnerInput(input);if(!Buffer.isBuffer(materials?.databaseCa))throw Error('Explicit database CA required');
 const pool=poolFactory({connectionString:config.database.url,max:1,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,statement_timeout:10000,query_timeout:12000,ssl:{ca:materials.databaseCa,rejectUnauthorized:true}});pool.on('error',()=>{});
 let closed=false;
 const checked={async connect(){
  if(closed)throw Error('Owner command closed');const client=await pool.connect();
  try{assertOwnerTls(client,new URL(config.database.url).hostname);await boundOwner(client,config.expected_deployment);}catch(error){client.release();throw error;}
  return {release:()=>client.release(),query:async(sql,values)=>{
   if(sql==='BEGIN'){const result=await client.query(sql);await boundOwner(client,config.expected_deployment,true);return result;}
   if(sql==='COMMIT')await boundOwner(client,config.expected_deployment,true);
   return client.query(sql,values);
  }};
 }};
 const fetchAccount=async(url,options)=>{
  const response=await fetchImpl(url,options),reader=response.body?.getReader();if(!reader)return new Response(null,{status:response.status});
  const chunks=[];let bytes=0;try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>131072){await reader.cancel();throw Error('Bounded Auth account response required');}chunks.push(Buffer.from(part.value));}}finally{reader.releaseLock();}
  return new Response(Buffer.concat(chunks),{status:response.status,headers:{'content-type':'application/json'}});
 };
 const loadAuthAccount=createAdminAuthAccountReader({url:config.auth.origin,serverKey:config.auth.server_key,fetchImpl:fetchAccount});
 try{const preflight=await checked.connect();preflight.release();}catch{await pool.end();throw Error('Configured owner preflight failed');}
 return {
  async review(){
   if(closed)throw Error('Owner command closed');const request=config.request,client=await checked.connect();
   try{await client.query('BEGIN');const prior=(await client.query('SELECT request_digest,receipt FROM mercury_guard.admin_membership_audit WHERE request_id=$1',[request.requestId])).rows[0];if(prior&&prior.request_digest!==digest(request))throw Error('Owner request ID conflict');const current=(await client.query('SELECT email,active FROM mercury_guard.admin_accounts WHERE auth_subject=$1',[request.subject])).rows[0]??null;await client.query('COMMIT');
    if(prior)return {mode:'review',deployment_id:config.expected_deployment.deployment_id,request,current,previous_receipt:prior.receipt,changed:false};
    const account=request.active?await loadAuthAccount(request.subject):null;if(request.active&&(!account||account.subject!==request.subject||account.email!==request.email||!account.confirmed||!account.enabled))throw Error('Confirmed active individual Auth account required');
    await client.query('BEGIN');if(request.active){const row=(await client.query('SELECT email,email_confirmed_at,banned_until,deleted_at FROM auth.users WHERE id=$1 FOR SHARE',[request.subject])).rows[0];if(!row||row.email?.toLowerCase()!==request.email||!row.email_confirmed_at||row.deleted_at||row.banned_until&&new Date(row.banned_until).getTime()>now())throw Error('Account changed before review');}else if(!current||current.email!==request.email)throw Error('Existing membership email required for revocation');await client.query('COMMIT');
    return {mode:'review',deployment_id:config.expected_deployment.deployment_id,request,current,changed:false};
   }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  },
  async apply(){if(closed)throw Error('Owner command closed');return new OwnerAdminMembership({pool:checked,loadAuthAccount,now}).set(config.request);},
  async close(){if(closed)return;closed=true;await pool.end();}
 };
}
