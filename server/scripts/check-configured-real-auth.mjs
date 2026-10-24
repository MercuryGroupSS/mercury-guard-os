#!/usr/bin/env node
// Actual LOCAL Auth + PostgreSQL + configured application/direct TLS. Workers
// are deliberately not composed or started; their disposable tests are separate.
import assert from 'node:assert/strict';
import {Client} from 'pg';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,chmodSync,unlinkSync,existsSync} from 'node:fs';
import {request as httpsRequest} from 'node:https';
import {configuredFixture} from '../fixtures/configured-service.mjs';
import {readConfiguredFile,readConfiguredServiceConfig,loadConfiguredMaterials,configuredDeploymentIdentity} from '../configured-service-config.mjs';
import {openConfiguredDatabase,assertConfiguredDatabase,assertConfiguredDeploymentIdentity} from '../configured-database.mjs';
import {createConfiguredApplication,createConfiguredService} from '../configured-service.mjs';
import {PostgresGuardDirectory} from '../postgres-guard-directory.mjs';
import {PostgresDeviceAssignments} from '../postgres-device-assignments.mjs';
import {PostgresLocationConsents} from '../postgres-location-consents.mjs';
import {PostgresDurableIngest} from '../postgres-durable-ingest.mjs';
import {PostgresShiftGrantIssuer} from '../postgres-shift-grant-issuer.mjs';
import {PostgresShiftLifecycle} from '../postgres-shift-lifecycle.mjs';
import {PostgresDispatchFeed} from '../postgres-dispatch-feed.mjs';
import {PostgresAdministration} from '../postgres-administration.mjs';
import {PostgresEscalations} from '../postgres-escalations.mjs';
import {createAdminAuthAccountReader} from '../admin-auth-account.mjs';

if(process.argv.length!==2||process.env.MERCURY_CONFIGURED_REAL_AUTH!=='synthetic-only'){console.error('{"status":"failed","phase":"explicit_synthetic_mode_required"}');process.exit(1);}
const root=new URL('../../',import.meta.url),privateDir=new URL('.local-backend/',root),privateFile=new URL('configured-real-auth.json',privateDir);
let local;try{local=JSON.parse(readConfiguredFile(new URL('supabase-start.log',root).pathname).toString('utf8').split('\n').findLast(line=>line.startsWith('{')&&line.includes('API_URL')));const db=new URL(local.DB_URL);
 if(local.API_URL!=='http://127.0.0.1:55321'||!['postgres:','postgresql:'].includes(db.protocol)||db.hostname!=='127.0.0.1'||db.port!=='55322'||db.search||db.hash||!local.PUBLISHABLE_KEY||!local.SERVICE_ROLE_KEY)throw Error();
}catch{console.error('{"status":"failed","phase":"owned_loopback_stack_required"}');process.exit(1);}
const run=randomUUID(),prefix='configured-real-auth-'+run,guardId=prefix+'-guard',vendorId=prefix+'-vendor',email=prefix+'@example.invalid',password=randomBytes(32).toString('base64url');
const owner=new Client({connectionString:local.DB_URL,connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:12000});
let ownerConnected=false,ownsFile=false,subject,fixture,config,materials,identity,pool,service,issuer,cleanupPromise,interrupted=false;
const tokens=[];let phase='preflight';
process.once('SIGINT',()=>{interrupted=true;});process.once('SIGTERM',()=>{interrupted=true;});
const lifetime=setTimeout(()=>{interrupted=true;},120000);lifetime.unref();
const active=()=>{if(interrupted)throw Error('Synthetic check interrupted');};
const provider=(path,options)=>fetch(local.API_URL+'/auth/v1/'+path,{...options,redirect:'error',signal:AbortSignal.timeout(8000)});
const serviceHeaders={apikey:local.SERVICE_ROLE_KEY,authorization:'Bearer '+local.SERVICE_ROLE_KEY,'content-type':'application/json'};
function ownership(){writeFileSync(privateFile,JSON.stringify({pid:process.pid,run,prefix,guardId,vendorId,email,...(fixture?{temporary_directory:fixture.dir}:{}),...(subject?{subject}:{})}),{mode:0o600});chmodSync(privateFile,0o600);}
function request(path,{body,token,method}={}){
 active();return new Promise((resolve,reject)=>{
  const bytes=body===undefined?null:Buffer.from(JSON.stringify(body));
  const r=httpsRequest({hostname:'127.0.0.1',servername:'localhost',port:55448,path,ca:materials.certificate,method:method??(bytes?'POST':'GET'),headers:{host:new URL(config.public_origin).host,...(token?{authorization:'Bearer '+token}:{}),...(bytes?{'content-type':'application/json','content-length':bytes.length}:{})}},res=>{
   let text='';res.on('data',chunk=>{text+=chunk;if(text.length>65536)r.destroy(Error('Bounded configured response required'));});res.on('end',()=>{try{resolve({status:res.statusCode,data:JSON.parse(text)});}catch{reject(Error('Configured JSON response required'));}});
  });r.setTimeout(15000,()=>r.destroy(Error('Configured request timeout')));r.on('error',reject);r.end(bytes);
 });
}
async function cleanup(){
 if(cleanupPromise)return cleanupPromise;
 cleanupPromise=(async()=>{
  clearTimeout(lifetime);const failures=[],attempt=async fn=>{try{await fn();}catch(error){failures.push(error);}};
  await attempt(async()=>service?.stop());await attempt(async()=>pool?.end());issuer?.close?.();tokens.fill(null);
  if(ownerConnected&&ownsFile){
   // Recover an uncertain Auth create only through this run's exact email AND
   // metadata; never delete an account on the strength of its email alone.
   await attempt(async()=>{const rows=(await owner.query("SELECT id FROM auth.users WHERE email=$1 AND raw_user_meta_data->>'mercury_fixture_run'=$2",[email,prefix])).rows;assert.ok(rows.length<=1);if(rows.length){if(subject)assert.equal(rows[0].id,subject);subject=rows[0].id;}});
   await attempt(()=>owner.query('DELETE FROM mercury_guard.guard_login WHERE guard_id=$1 AND email=$2',[guardId,email]));
   await attempt(()=>owner.query('DELETE FROM mercury_guard.guards WHERE guard_id=$1 AND vendor_id=$2 AND auth_subject=$3::uuid',[guardId,vendorId,subject??null]));
   await attempt(()=>owner.query('DELETE FROM mercury_guard.vendors WHERE vendor_id=$1',[vendorId]));
   const bucket='account:'+createHash('sha256').update(guardId).digest('hex');
   await attempt(()=>owner.query('DELETE FROM mercury_guard.login_attempts WHERE bucket=$1',[bucket]));
   if(subject)await attempt(async()=>{const owned=(await owner.query("SELECT id FROM auth.users WHERE id=$1::uuid AND email=$2 AND raw_user_meta_data->>'mercury_fixture_run'=$3",[subject,email,prefix])).rows;if(owned.length){const deleted=await provider('admin/users/'+subject,{method:'DELETE',headers:serviceHeaders});assert.equal(deleted.ok,true);}});
   if(identity)await attempt(async()=>{
    const row=(await owner.query('SELECT deployment_id::text,auth_origin,public_origin,issuer,audience,issuer_key_id,issuer_spki_sha256,approved_by FROM mercury_guard.deployment_identity WHERE deployment_id=$1::uuid',[run])).rows[0];
    if(row){assert.equal(row.approved_by,prefix);for(const key of Object.keys(identity))assert.equal(row[key],identity[key]);assert.equal((await owner.query('DELETE FROM mercury_guard.deployment_identity WHERE deployment_id=$1::uuid AND approved_by=$2 AND auth_origin=$3 AND public_origin=$4 AND issuer=$5 AND audience=$6 AND issuer_key_id=$7 AND issuer_spki_sha256=$8',[run,prefix,identity.auth_origin,identity.public_origin,identity.issuer,identity.audience,identity.issuer_key_id,identity.issuer_spki_sha256])).rowCount,1);}
   });
   await attempt(async()=>{const rows=(await owner.query(`SELECT
    (SELECT count(*) FROM mercury_guard.deployment_identity WHERE deployment_id=$1::uuid) AS markers,
    (SELECT count(*) FROM mercury_guard.guard_login WHERE guard_id=$2) AS logins,
    (SELECT count(*) FROM mercury_guard.guards WHERE guard_id=$2) AS guards,
    (SELECT count(*) FROM mercury_guard.vendors WHERE vendor_id=$3) AS vendors,
    (SELECT count(*) FROM mercury_guard.login_attempts WHERE bucket=$4) AS account_limiter,
    (SELECT count(*) FROM auth.users WHERE email=$5 AND raw_user_meta_data->>'mercury_fixture_run'=$6) AS users,
    (SELECT count(*) FROM auth.sessions WHERE user_id=$7::uuid) AS sessions`,[run,guardId,vendorId,bucket,email,prefix,subject??null])).rows[0];assert.ok(Object.values(rows).every(value=>Number(value)===0));});
  }
  if(!failures.length){await attempt(async()=>fixture?.close());if(ownsFile)await attempt(async()=>{const saved=JSON.parse(readFileSync(privateFile,'utf8'));assert.equal(saved.pid,process.pid);assert.equal(saved.run,run);unlinkSync(privateFile);ownsFile=false;});}
  await attempt(async()=>owner.end());
  if(failures.length)throw new AggregateError(failures,'Exact synthetic cleanup unconfirmed');
 })();return cleanupPromise;
}

try{
 mkdirSync(privateDir,{recursive:true,mode:0o700});chmodSync(privateDir,0o700);
 writeFileSync(privateFile,JSON.stringify({pid:process.pid,run,prefix,guardId,vendorId,email}),{mode:0o600,flag:'wx'});ownsFile=true;
 await owner.connect();ownerConnected=true;
 assert.equal((await owner.query('SELECT count(*) AS n FROM mercury_guard.deployment_identity')).rows[0].n,'0','An existing deployment marker must be preserved');
 active();fixture=configuredFixture({port:55448});chmodSync(fixture.dir,0o700);chmodSync(fixture.config.tls.certificate_path,0o600);ownership();
 fixture.config.deployment_id=run;fixture.config.auth={origin:local.API_URL,publishable_key:local.PUBLISHABLE_KEY,server_key:local.SERVICE_ROLE_KEY};fixture.config.database.url=local.DB_URL;
 fixture.config.issuer.issuer=prefix;fixture.config.issuer.audience=prefix;fixture.config.issuer.key_id='configured-real-auth';
 config=readConfiguredServiceConfig(fixture.save('runtime.json',JSON.stringify(fixture.config)));materials=loadConfiguredMaterials(config);identity=configuredDeploymentIdentity(config,materials);
 phase='marker';await owner.query('BEGIN');try{
  await owner.query('LOCK TABLE mercury_guard.deployment_identity IN SHARE ROW EXCLUSIVE MODE');
  assert.equal((await owner.query('SELECT count(*) AS n FROM mercury_guard.deployment_identity')).rows[0].n,'0');
  await owner.query('INSERT INTO mercury_guard.deployment_identity(singleton,deployment_id,auth_origin,public_origin,issuer,audience,issuer_key_id,issuer_spki_sha256,approved_by,reason) VALUES(true,$1,$2,$3,$4,$5,$6,$7,$8,$9)',[identity.deployment_id,identity.auth_origin,identity.public_origin,identity.issuer,identity.audience,identity.issuer_key_id,identity.issuer_spki_sha256,prefix,'Temporary synthetic actual LOCAL Auth acceptance; workers not started']);
  await owner.query('COMMIT');
 }catch(error){await owner.query('ROLLBACK');throw error;}
 phase='auth_create';active();const created=await provider('admin/users',{method:'POST',headers:serviceHeaders,body:JSON.stringify({email,password,email_confirm:true,user_metadata:{mercury_fixture_run:prefix}})});assert.equal(created.status,200);const user=await created.json();assert.match(user.id,/^[a-f0-9-]{36}$/i);assert.equal(user.email,email);assert.equal(user.user_metadata?.mercury_fixture_run,prefix);subject=user.id;ownership();
 await owner.query('INSERT INTO mercury_guard.vendors(vendor_id,kind,active) VALUES($1,$2,true)',[vendorId,'individual']);
 await owner.query('INSERT INTO mercury_guard.guards(guard_id,auth_subject,vendor_id,active) VALUES($1,$2,$3,true)',[guardId,subject,vendorId]);
 await owner.query('INSERT INTO mercury_guard.guard_login(guard_id,email) VALUES($1,$2)',[guardId,email]);
 phase='configured_tls';active();pool=await openConfiguredDatabase(config,materials);
 const directory=new PostgresGuardDirectory({client:pool}),devices=new PostgresDeviceAssignments(pool,config.issuer.audience),locationConsents=new PostgresLocationConsents({devices,audience:config.issuer.audience}),store=new PostgresDurableIngest(devices,{locationConsents}),shiftLifecycle=new PostgresShiftLifecycle(devices),dispatch=new PostgresDispatchFeed(devices);
 issuer=new PostgresShiftGrantIssuer({devices,locationConsents,privateKey:materials.issuerKey,keyId:config.issuer.key_id,issuer:config.issuer.issuer,audience:config.issuer.audience});
 const admin=new PostgresAdministration({devices,loadAuthAccount:createAdminAuthAccountReader({url:config.auth.origin,serverKey:config.auth.server_key,allowLocal:true})}),escalations=new PostgresEscalations({devices,audience:config.issuer.audience});
 const application=createConfiguredApplication({config,pool,directory,devices,grantIssuer:issuer,store,dispatch,shiftLifecycle,admin,escalations,locationConsents}),handle=application.handle;
 application.handle=async req=>{await assertConfiguredDeploymentIdentity(pool,identity);return handle(req);};
 service=createConfiguredService({config,materials,application,preflight:()=>assertConfiguredDatabase(pool,identity)});
 assert.equal((await service.check()).status,'configuration_verified');await service.start();
 phase='actual_login_sessions';
 for(let i=0;i<2;i++){const login=await request('/v1/session/login',{body:{guard_id:guardId,password}});assert.equal(login.status,200);assert.equal(typeof login.data.access_token,'string');tokens.push(login.data.access_token);}
 const claims=tokens.map(token=>JSON.parse(Buffer.from(token.split('.')[1],'base64url')));assert.notEqual(claims[0].session_id,claims[1].session_id);for(const claim of claims){assert.equal(claim.sub,subject);assert.ok(claim.exp>Math.floor(Date.now()/1000));assert.equal((await owner.query('SELECT EXISTS(SELECT 1 FROM auth.sessions WHERE id=$1::uuid AND user_id=$2::uuid) AS active',[claim.session_id,subject])).rows[0].active,true);}
 for(const token of tokens){const profile=await request('/v1/me',{token});assert.equal(profile.status,200);assert.equal(profile.data.auth_subject,subject);assert.equal(profile.data.guard_id,guardId);assert.equal(profile.data.vendor_id,vendorId);}
 assert.equal((await request('/v1/admin/me',{token:tokens[0]})).status,403);
 phase='actual_local_logout';assert.deepEqual(await request('/v1/session/logout',{token:tokens[0],method:'POST'}),{status:200,data:{status:'signed_out'}});
 assert.equal((await owner.query('SELECT EXISTS(SELECT 1 FROM auth.sessions WHERE id=$1::uuid AND user_id=$2::uuid) AS active',[claims[0].session_id,subject])).rows[0].active,false);
 assert.equal((await request('/v1/me',{token:tokens[0]})).status,401);assert.equal((await request('/v1/me',{token:tokens[1]})).status,200);
 phase='postgres_session_revocation';assert.equal((await owner.query('DELETE FROM auth.sessions WHERE id=$1::uuid AND user_id=$2::uuid',[claims[1].session_id,subject])).rowCount,1);
 assert.equal((await request('/v1/me',{token:tokens[1]})).status,401);
 active();await cleanup();
 console.log(JSON.stringify({status:'passed',provider:'actual_local_supabase_auth',composition:'configured_application_direct_tls',workers:'not_started',sessions_verified:2,independent_session_after_logout:true,postgres_revoked_session_denied:true,custom_audience:true,exact_cleanup:'confirmed',global_limiter:'preserved'}));
}catch(error){
 let clean=true;try{await cleanup();}catch{clean=false;}
 const log=new URL('configured-real-auth-'+run+'.log',privateDir);try{writeFileSync(log,String(error?.stack??error)+'\nphase='+phase+'\ncleanup='+clean+'\n',{mode:0o600});chmodSync(log,0o600);}catch{}
 console.error(JSON.stringify({status:'failed',phase,exact_cleanup:clean?'confirmed':'unconfirmed',diagnostics:'private_only'}));process.exitCode=1;
}
