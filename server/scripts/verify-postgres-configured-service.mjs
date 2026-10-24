import assert from 'node:assert/strict';
import {Pool,Client} from 'pg';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID,generateKeyPairSync,sign,createHash,verify} from 'node:crypto';
import {request as httpsRequest} from 'node:https';
import {configuredFixture} from '../fixtures/configured-service.mjs';
import {loadConfiguredMaterials,configuredDeploymentIdentity} from '../configured-service-config.mjs';
import {openConfiguredRuntime} from '../configured-runtime.mjs';
import {assertConfiguredDatabase} from '../configured-database.mjs';
import {PostgresDeviceAssignments} from '../postgres-device-assignments.mjs';
import {PostgresOpsBindingStore} from '../postgres-ops-binding-store.mjs';
import {PostgresDashboardBindings,PostgresDashboardOutbox} from '../postgres-dashboard-delivery.mjs';
// A full runtime must not scan fixtures retained by earlier verifier groups.
// Own a separate temporary database even when invoked by the shared replay.
export async function verifyPostgresConfiguredService(connectionString,owner){
 const url=new URL(connectionString);if(!['127.0.0.1','localhost'].includes(url.hostname)||url.port!=='55322'||url.search||url.hash)throw Error('Disposable loopback PostgreSQL required');
 const name='mercury_configured_verify_'+randomUUID().replaceAll('-','');let created=false,fixture;
 try{await owner.query('CREATE DATABASE '+name);created=true;url.pathname='/'+name;fixture=new Client({connectionString:url.toString(),connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:12000});await fixture.connect();
  await fixture.query('CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),not_after timestamptz);');
  for(const file of readdirSync(new URL('../../supabase/migrations/',import.meta.url)).filter(x=>/^\d+.*\.sql$/.test(x)).sort())await fixture.query(readFileSync(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
  await verifyConfiguredDatabaseFixture(url.toString(),fixture);
 }finally{await fixture?.end();if(created){await owner.query('DROP DATABASE '+name);console.log('PASS: isolated configured-service verification database removed');}}
}
// Auth HTTP is a deterministic injected provider; TLS, handlers, PostgreSQL,
// complete runtime workers, current-session checks and pre-send fencing are real.
async function verifyConfiguredDatabaseFixture(connectionString,owner){
 const f=configuredFixture(),config=f.config,testUrl=new URL(connectionString);if(!['127.0.0.1','localhost'].includes(testUrl.hostname)||testUrl.port!=='55322')throw Error('Disposable loopback PostgreSQL required');
 config.database.url=connectionString;const materials=loadConfiguredMaterials(config),identity=configuredDeploymentIdentity(config,materials),prefix='configured-'+randomUUID(),subject=randomUUID(),sessions=[randomUUID(),randomUUID()];
 config.ops_refresh={origin:'https://synthetic-ops.example.invalid',server_key:config.auth.server_key,interval_ms:1000};
 config.dashboard_delivery={configuration_path:f.save('destinations.json',JSON.stringify({version:1,destinations:[{destination:'synthetic-inbox',endpoint:'https://synthetic-receiver.example.invalid/v1/observations',token:'synthetic-receiver-token-only-0123456789'}]})),interval_ms:1000};
 const pool=new Pool({connectionString,max:3,options:'-c role=service_role',connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:12000});let runtime;
 const token=id=>['synthetic',Buffer.from(JSON.stringify({sub:subject,session_id:id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'signature'].join('.'),tokens=sessions.map(token);
 let sourceReads=0,outboundCalls=0,flipOnClaim=false;
 const provider=async(url,options)=>{
  if(url.startsWith('https://synthetic-ops.example.invalid/')){sourceReads++;return Response.json([]);}
  if(url.startsWith('https://synthetic-receiver.example.invalid/')){outboundCalls++;throw Error('Marker must prevent outbound network');}
  assert.ok(url.startsWith('http://127.0.0.1:55321/auth/v1/'));assert.equal(options.redirect,'error');
  if(url.endsWith('/settings'))return Response.json({mailer_autoconfirm:false,external:{email:true},disable_signup:false});
  const bearer=options.headers.authorization?.slice(7),index=tokens.indexOf(bearer);if(index===-1)return new Response(null,{status:401});
  if(url.endsWith('/user'))return Response.json({id:subject});
  if(url.endsWith('/logout?scope=local')){await owner.query('DELETE FROM auth.sessions WHERE id=$1',[sessions[index]]);return new Response(null,{status:204});}
  throw Error('Unexpected synthetic provider route');
 };
 function request(path,{body,token=tokens[0],headers={}}={}){return new Promise((resolve,reject)=>{const r=httpsRequest({hostname:'127.0.0.1',servername:'localhost',port:config.listen.port,path,ca:materials.certificate,method:body===undefined?'GET':'POST',headers:{host:new URL(config.public_origin).host,authorization:'Bearer '+token,...(body===undefined?{}:{'content-type':'application/json'}),...headers}},res=>{let raw='';res.on('data',chunk=>{raw+=chunk;if(raw.length>262144)r.destroy(Error('Bounded test response required'));});res.on('end',()=>{let data;try{data=JSON.parse(raw);}catch{data=raw;}resolve({status:res.statusCode,data});});});r.on('error',reject);r.end(body===undefined?undefined:JSON.stringify(body));});}
 try{
  const rights=(await owner.query("SELECT has_table_privilege('anon','mercury_guard.deployment_identity','SELECT') AS anon,has_table_privilege('authenticated','mercury_guard.deployment_identity','SELECT') AS authenticated,has_table_privilege('service_role','mercury_guard.deployment_identity','SELECT') AS service_read,has_table_privilege('service_role','mercury_guard.deployment_identity','INSERT,UPDATE,DELETE,TRUNCATE') AS service_write")).rows[0];assert.deepEqual(rights,{anon:false,authenticated:false,service_read:true,service_write:false});
  await assert.rejects(assertConfiguredDatabase(pool,identity));
  await owner.query('INSERT INTO mercury_guard.deployment_identity(singleton,deployment_id,auth_origin,public_origin,issuer,audience,issuer_key_id,issuer_spki_sha256,approved_by,reason) VALUES(true,$1,$2,$3,$4,$5,$6,$7,$8,$9)',[identity.deployment_id,identity.auth_origin,identity.public_origin,identity.issuer,identity.audience,identity.issuer_key_id,identity.issuer_spki_sha256,'synthetic verifier','Isolated configured service acceptance only']);
  await assertConfiguredDatabase(pool,identity);
  for(const field of Object.keys(identity)){await assert.rejects(assertConfiguredDatabase(pool,{...identity,[field]:field==='deployment_id'?randomUUID():'wrong-deployment'}));}
  await assert.rejects(pool.query('UPDATE mercury_guard.deployment_identity SET issuer=issuer'));await assert.rejects(pool.query('DELETE FROM mercury_guard.deployment_identity'));
  await owner.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[subject,prefix+'@example.invalid']);for(const id of sessions)await owner.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)',[id,subject]);
  const guard=prefix+'-guard',vendor=prefix+'-company',site=prefix+'-site',deviceId=prefix+'-phone',assignmentId=prefix+'-assignment';await owner.query('INSERT INTO mercury_guard.vendors VALUES($1,$2,true)',[vendor,'company']);await owner.query('INSERT INTO mercury_guard.sites VALUES($1,true)',[site]);await owner.query('INSERT INTO mercury_guard.guards VALUES($1,$2,$3,true)',[guard,subject,vendor]);
  const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),spki=keys.publicKey.export({type:'spki',format:'der'}).toString('base64url'),thumb=createHash('sha256').update(Buffer.from(spki,'base64url')).digest('hex'),devices=new PostgresDeviceAssignments(pool,config.issuer.audience),now=Date.now();
  await devices.enroll({deviceId,mode:'site',siteId:site,active:true,revoked:false,publicKeySpki:spki});await devices.assign({assignmentId,guardId:guard,vendorId:vendor,siteId:site,active:true,startsAt:now-1000,endsAt:now+3600000});
  await new PostgresOpsBindingStore(pool).approve({opsShiftId:prefix+'-source',guardId:guard,vendorId:vendor,siteId:site,authSubject:subject,revision:1,active:true},{operator:'synthetic verifier',reason:'Owned disposable source-read fixture'});
  const schedules=[],schedule=fn=>{const t={fn,cancelled:false,unref(){}};schedules.push(t);return t;},cancel=t=>{t.cancelled=true;};
  const runtimePool=options=>{const p=new Pool(options);p.on('connect',client=>{const query=client.query.bind(client);client.query=async(...args)=>{const result=await query(...args);if(flipOnClaim&&typeof args[0]==='string'&&args[0].startsWith('UPDATE mercury_guard.dashboard_outbox SET lease=')){flipOnClaim=false;await owner.query("UPDATE mercury_guard.deployment_identity SET public_origin='https://different.invalid'");}return result;};});return p;};
  runtime=await openConfiguredRuntime(config,materials,{fetchImpl:provider,poolFactory:runtimePool,schedule,cancel});assert.equal((await runtime.check()).status,'configuration_verified');assert.equal(runtime.status().started,false);await runtime.start();for(const t of schedules)await t.fn();assert.ok(sourceReads>0);
  assert.equal((await request('/v1/me')).status,200);assert.equal((await request('/v1/admin/me')).status,403);
  async function proof(audience=config.issuer.audience){const c=await request('/v1/device-challenge',{body:{device_id:deviceId}});assert.equal(c.status,200);assert.equal(c.data.audience,config.issuer.audience);return {version:1,algorithm:'SHA256withECDSA',audience,request_id:c.data.request_id,challenge:c.data.challenge,device_thumbprint:thumb,public_key_spki:spki,signature_der:sign('sha256',Buffer.from(`mercury-enrollment-proof-v1\n${audience}\n${c.data.request_id}\n${c.data.challenge}\n${thumb}`),keys.privateKey).toString('base64url')};}
  assert.equal((await request('/v1/assignments',{body:await proof('mercury-local')})).status,400);
  const assignments=await request('/v1/assignments',{body:await proof()});assert.equal(assignments.status,200);assert.equal(assignments.data.assignments[0].assignmentId,assignmentId);
  const start=await request('/v1/shift-transition',{body:{assignment_id:assignmentId,proof:await proof(),transition:{action:'start',confirmed:true,request_id:randomUUID(),reason:''}}});assert.equal(start.status,200);
  const grant=await request('/v1/shift-grant',{body:{assignment_id:assignmentId,proof:await proof()}});assert.equal(grant.status,200);const claims=JSON.parse(Buffer.from(grant.data.payload,'base64url'));assert.equal(claims.issuer,config.issuer.issuer);assert.equal(claims.audience,config.issuer.audience);assert.equal(claims.actions.includes('location'),false);assert.equal(verify('sha256',Buffer.from(`mercury-shift-grant-v1.${grant.data.key_id}.${grant.data.payload}`),materials.issuerKey,Buffer.from(grant.data.signature,'base64url')),true);
  const consentChallenge=await request('/v1/location-consents/challenge',{body:{device_id:deviceId,consent_id:null}});assert.equal(consentChallenge.status,200);assert.equal(consentChallenge.data.audience,config.issuer.audience);
  const mapping={assignmentId,guardId:guard,vendorId:vendor,siteId:site,dashboardShiftId:prefix+'-source',destination:'synthetic-inbox',revision:1,active:true};await new PostgresDashboardBindings(devices).approve(mapping);
  const outbox=new PostgresDashboardOutbox(devices),delivery=await outbox.enqueue({vendor_id:vendor,scope:{guard_id:guard,site_id:site,assignment_id:assignmentId,device_thumbprint:thumb},event:{event_id:randomUUID(),kind:'incident',at:Date.now(),data:{description:'Synthetic configured send fence only'}}},mapping);
  flipOnClaim=true;await schedules[2].fn();assert.equal(flipOnClaim,false);assert.equal(outboundCalls,0);assert.equal((await owner.query('SELECT status FROM mercury_guard.dashboard_outbox WHERE id=$1',[delivery])).rows[0].status,'pending');assert.equal((await request('/v1/me')).status,503);
  // A changed owner binding disables already-running HTTP immediately. Rotation
  // still requires draining old in-flight work before the owner changes the row.
  const workerState=async()=>JSON.stringify((await owner.query('SELECT * FROM mercury_guard.check_in_worker_state')).rows.concat((await owner.query('SELECT * FROM mercury_guard.dashboard_bridge_state ORDER BY channel')).rows));
  const beforeWorkers=await workerState(),readsBefore=sourceReads;for(const task of schedules)await task.fn();assert.equal(await workerState(),beforeWorkers);assert.equal(sourceReads,readsBefore);assert.equal(outboundCalls,0);assert.ok(runtime.status().check_ins.totalFailures>0);assert.ok(runtime.status().bridge_failures>0);
  await owner.query('UPDATE mercury_guard.deployment_identity SET public_origin=$1',[config.public_origin]);assert.equal((await request('/v1/me')).status,200);
  await owner.query('DELETE FROM auth.sessions WHERE id=$1',[sessions[0]]);assert.equal((await request('/v1/me')).status,401);assert.equal((await request('/v1/me',{token:tokens[1]})).status,200);
  await runtime.close();await runtime.close();assert.equal(runtime.status().started,false);assert.equal(schedules.every(t=>t.cancelled),true);await assert.rejects(request('/v1/me'));await assert.rejects(runtime.start(),/closed/);
  console.log('PASS: configured TLS/current PostgreSQL sessions, custom audience/issuer grants, marker isolation, private grants and clean shutdown (synthetic Auth provider)');
 }finally{await runtime?.close();await pool.end();f.close();}
}
