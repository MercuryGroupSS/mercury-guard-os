// Own local Auth only. Synthetic accounts and roster rows are removed exactly.
import assert from 'node:assert/strict';
import {Client} from 'pg';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {openLocalGuardDirectory} from '../local-directory-factory.mjs';
import {PostgresDeviceAssignments} from '../postgres-device-assignments.mjs';
import {PostgresAdministration} from '../postgres-administration.mjs';
import {createLocalService} from '../local-service.mjs';
import {createSupabaseSessionVerifier} from '../supabase-session.mjs';
import {createPostgresAuthSessionReader} from '../postgres-auth-session.mjs';
const config=JSON.parse(readFileSync(new URL('../../supabase-start.log',import.meta.url),'utf8').split('\n').findLast(line=>line.startsWith('{')&&line.includes('API_URL'))),dbUrl=new URL(config.DB_URL);
if(config.API_URL!=='http://127.0.0.1:55321'||dbUrl.hostname!=='127.0.0.1'||dbUrl.port!=='55322'||dbUrl.search||dbUrl.hash)throw Error('Own isolated local environment required');
const suffix=randomUUID(),email='logout-'+suffix+'@example.invalid',password=randomBytes(32).toString('base64url'),guard='logout-guard-'+suffix,vendor='logout-vendor-'+suffix,owner=new Client({connectionString:config.DB_URL});
const serviceHeaders={apikey:config.SERVICE_ROLE_KEY,authorization:'Bearer '+config.SERVICE_ROLE_KEY,'content-type':'application/json'},publicHeaders={apikey:config.PUBLISHABLE_KEY,'content-type':'application/json'};
let service,directory,subject;
async function provider(path,options){return fetch(config.API_URL+'/auth/v1/'+path,{...options,redirect:'error',signal:AbortSignal.timeout(5000)});}
await owner.connect();
try{
 const created=await provider('admin/users',{method:'POST',headers:serviceHeaders,body:JSON.stringify({email,password,email_confirm:true})});assert.equal(created.status,200);subject=(await created.json()).id;assert.ok(subject);
 await owner.query('INSERT INTO mercury_guard.vendors(vendor_id,kind,active) VALUES($1,$2,false)',[vendor,'individual']);await owner.query('INSERT INTO mercury_guard.guards(guard_id,auth_subject,vendor_id,active) VALUES($1,$2,$3,false)',[guard,subject,vendor]);await owner.query('INSERT INTO mercury_guard.guard_login(guard_id,email) VALUES($1,$2)',[guard,email]);await owner.query('INSERT INTO mercury_guard.admin_accounts(auth_subject,email,active) VALUES($1,$2,false)',[subject,email]);
 directory=await openLocalGuardDirectory({config,mode:'postgres'});const devices=new PostgresDeviceAssignments(directory.client),admin=new PostgresAdministration({devices});service=createLocalService({config,directory,admin,store:{ingest:async()=>{throw Error('Logout-only fixture');}}});const origin=await service.start();
 const verifySession=createSupabaseSessionVerifier({url:config.API_URL,publishableKey:config.PUBLISHABLE_KEY,allowLocal:true,loadSession:createPostgresAuthSessionReader(directory.client)});
 const login=async()=>{const response=await provider('token?grant_type=password',{method:'POST',headers:publicHeaders,body:JSON.stringify({email,password})});assert.equal(response.status,200);const value=await response.json();assert.equal((await verifySession(value.access_token))?.subject,subject);return value.access_token;};
 const original=await login(),independent=await login();assert.notEqual(original,independent);const claims=token=>JSON.parse(Buffer.from(token.split('.')[1],'base64url'));assert.notEqual(claims(original).session_id,claims(independent).session_id);
 const profile=(path,token)=>fetch(origin+path,{headers:{authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(5000)}),logout=(token,options={})=>fetch(origin+'/v1/session/logout'+(options.query??''),{method:'POST',headers:{...(token?{authorization:'Bearer '+token}:{}),...(options.body?{'content-type':'application/json'}:{})},...(options.body?{body:options.body}:{}),redirect:'error',signal:AbortSignal.timeout(8000)});
 for(const token of [original,independent]){assert.equal((await profile('/v1/me',token)).status,403);assert.equal((await profile('/v1/admin/me',token)).status,403);}
 assert.equal((await logout(null)).status,401);assert.equal((await logout('arbitrary-secret')).status,401);assert.equal((await logout(original,{query:'?destination=https://elsewhere.invalid'})).status,400);assert.equal((await logout(original,{body:'{}'})).status,400);assert.equal((await verifySession(original))?.subject,subject);
 const signedOut=await logout(original);assert.equal(signedOut.status,200);assert.deepEqual(await signedOut.json(),{status:'signed_out'});assert.equal(signedOut.headers.get('cache-control'),'no-store');assert.equal(await verifySession(original),null);assert.equal((await profile('/v1/me',original)).status,401);assert.equal((await profile('/v1/admin/me',original)).status,401);assert.equal((await logout(original)).status,401);
 assert.equal((await verifySession(independent))?.subject,subject);assert.equal((await profile('/v1/me',independent)).status,403);assert.equal((await profile('/v1/admin/me',independent)).status,403);
 await owner.query('UPDATE mercury_guard.admin_accounts SET active=true WHERE auth_subject=$1',[subject]);assert.equal((await profile('/v1/admin/me',independent)).status,200);assert.equal((await profile('/v1/admin/me',original)).status,401);
 assert.equal((await logout(independent)).status,200);assert.equal((await profile('/v1/admin/me',independent)).status,401);assert.equal(await verifySession(independent),null);
 console.log('PASS: real local self-session logout for a deactivated guard/admin, old JWT denial, independent-session preservation and precise no-query/no-body transport');
}finally{
 if(service)await service.stop();if(directory)await directory.close();
 try{
  await owner.query('DELETE FROM mercury_guard.guard_login WHERE guard_id=$1 AND email=$2',[guard,email]);await owner.query('DELETE FROM mercury_guard.guards WHERE guard_id=$1 AND vendor_id=$2',[guard,vendor]);await owner.query('DELETE FROM mercury_guard.vendors WHERE vendor_id=$1',[vendor]);
  if(subject){await owner.query('DELETE FROM mercury_guard.admin_accounts WHERE auth_subject=$1 AND email=$2',[subject,email]);const deleted=await provider('admin/users/'+subject,{method:'DELETE',headers:serviceHeaders});assert.equal(deleted.ok,true);assert.equal((await owner.query('SELECT 1 FROM auth.users WHERE id=$1',[subject])).rowCount,0);}
  console.log('PASS: exact synthetic logout account, inactive roster and membership removed');
 }finally{await owner.end();}
}
