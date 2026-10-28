import test from 'node:test';import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {readNetlifyEnvironment} from './netlify-config.mjs';
import {configuredDeploymentIdentity} from './configured-service-config.mjs';
import {assertConfiguredDatabase} from './configured-database.mjs';
import {openNetlifyDatabase,openNetlifyRuntime} from './netlify-runtime.mjs';
const privateKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
function fixture({recipients=[]}={}){const value={version:1,deployment_id:randomUUID(),public_origin:'https://guard.example.invalid',platform:{site_id:randomUUID(),deployment_context:'production'},auth:{origin:'https://auth.example.invalid',publishable_key:'sb_publishable_synthetic-only'},database:{connection_mode:'session'},issuer:{issuer:'synthetic-netlify',audience:'synthetic-netlify',key_id:'synthetic-netlify'},workers:{batch_size:5,max_duration_ms:20000},ops_refresh:null,dashboard_delivery:false,dashboard_receiver:false,mail_recipients:recipients},env={MERCURY_GUARD_NETLIFY_CONFIG:JSON.stringify(value),MERCURY_GUARD_DATABASE_URL:'postgresql://synthetic:synthetic@db.example.invalid:5432/guard',MERCURY_GUARD_AUTH_SERVER_KEY:'sb_secret_synthetic-only',MERCURY_GUARD_ISSUER_PRIVATE_KEY:privateKey};return readNetlifyEnvironment({get:name=>env[name]});}
function database(config,materials){
 let marker=configuredDeploymentIdentity(config,materials),ended=0,badRole=false,lockHeld=false,failedLock=false,hook=()=>{},seq=0,options;
 const sql=[],released=[],sessions=new Map(),subject=randomUUID(),exp=Math.floor(Date.now()/1000)+3600;const token=id=>['synthetic',Buffer.from(JSON.stringify({sub:subject,session_id:id,exp})).toString('base64url'),'signature'].join('.');
 const query=async(input,values)=>{const text=typeof input==='string'?input:input.text,args=typeof input==='string'?values:input.values;sql.push({text,args});await hook(text,args);
  if(text==='SET ROLE service_role'||text==='SET statement_timeout=4000'||text.includes("set_config('statement_timeout'"))return {rows:[]};
  if(text.includes('has_column_privilege'))return {rows:[{role:badRole?'postgres':'service_role',sessions:true,marker_read_only:true,consent_order:true}]};
  if(text==='SELECT current_user AS role')return {rows:[{role:badRole?'postgres':'service_role'}]};
  if(text.includes('unnest'))return {rows:[{missing:false}]};if(text.includes('deployment_identity'))return {rows:[marker]};
  if(text.includes('pg_try_advisory_lock')){if(failedLock)throw Error('Query read timeout');if(lockHeld)return {rows:[{acquired:false}]};lockHeld=true;return {rows:[{acquired:true}]};}
  if(text.includes('pg_advisory_unlock')){const released=lockHeld;lockHeld=false;return {rows:[{released}]};}
  if(text.includes('auth.sessions'))return {rows:[{active:sessions.get(args[0])===args[1]}]};
  if(text.includes('FROM mercury_guard.guards WHERE auth_subject'))return {rows:[{guard_id:'synthetic-individual',auth_subject:subject,vendor_id:'synthetic-company',active:true}]};
  if(text.includes('FROM mercury_guard.vendors'))return {rows:[{vendor_id:'synthetic-company',kind:'company',active:true}]};
  if(text.includes('consume_login_attempt'))return {rows:[{allowed:true}]};
  if(/^(INSERT|UPDATE|DELETE)/.test(text))return {rows:[],rowCount:1};
  if(text.startsWith('SELECT'))return {rows:[]};if(['BEGIN','COMMIT','ROLLBACK'].includes(text))return {rows:[]};throw Error('Unexpected synthetic SQL');
 };
 const raw={on(){},async connect(){const id=++seq;return {query,release:destroy=>released.push({id,destroy})};},async end(){ended++;}};
 return {poolFactory:o=>{options=o;return raw;},sql,released,subject,sessions,token,query,get options(){return options;},get ended(){return ended;},get lockHeld(){return lockHeld;},badRole:()=>{badRole=true;},drift:()=>{marker={...marker,audience:'different'};},setHook:fn=>{hook=fn;},setLock:v=>{lockHeld=v;},failLock:()=>{failedLock=true;}};
}
function provider(config,db){const calls=[];return {calls,fetchImpl:async(url,options={})=>{calls.push({url:String(url),options});assert.ok(String(url).startsWith(config.auth.origin+'/auth/v1/'));assert.equal(options.headers.apikey,config.auth.publishable_key);if(String(url).endsWith('/settings'))return Response.json({mailer_autoconfirm:false,external:{email:true},disable_signup:false});if(String(url).endsWith('/otp'))return Response.json({});const token=options.headers.authorization?.slice(7),id=[...db.sessions].find(([id])=>db.token(id)===token)?.[0];if(String(url).endsWith('/logout?scope=local')){db.sessions.delete(id);return new Response(null,{status:204});}if(String(url).endsWith('/user'))return id?Response.json({id:db.subject}):new Response(null,{status:401});throw Error('Unexpected synthetic Auth call');}};}
test('Netlify pool strictly verifies TLS, role on every checkout and immutable deployment, with no elevated fallback',async()=>{
 const {config,materials}=fixture(),db=database(config,materials),pool=await openNetlifyDatabase(config,materials,{poolFactory:db.poolFactory});
 assert.equal(db.options.max,2);assert.deepEqual(db.options.ssl,{rejectUnauthorized:true});assert.equal(Object.hasOwn(db.options,'options'),false);
 const before=db.sql.length;await pool.query('SELECT synthetic');const after=db.sql.slice(before).map(x=>x.text);assert.deepEqual(after.slice(0,3),['SET statement_timeout=4000','SET ROLE service_role','SELECT current_user AS role']);assert.ok(after.includes('SELECT synthetic'));
 db.badRole();await assert.rejects(pool.query('SELECT must_not_execute'),/authority unavailable/);assert.equal(db.sql.some(x=>x.text==='SELECT must_not_execute'),false);assert.equal(db.released.at(-1).destroy,true);await pool.end();await pool.end();assert.equal(db.ended,1);
 const wrong=database(config,materials);wrong.drift();await assert.rejects(openNetlifyDatabase(config,materials,{poolFactory:wrong.poolFactory}),/no authority or TLS fallback/);assert.equal(wrong.ended,1);
});
test('readiness explicitly requires both chunk schemas and never reports a missing migration ready',async()=>{
 const {config,materials}=fixture(),identity=configuredDeploymentIdentity(config,materials);
 for(const missing of ['mercury_guard.evidence_chunks','mercury_guard_receiver.media_chunks']){
  const pool={query:async(sql,args)=>{if(sql.includes('has_column_privilege'))return {rows:[{role:'service_role',sessions:true,marker_read_only:true,consent_order:true}]};if(sql.includes('unnest')){assert.ok(args[0].includes(missing));return {rows:[{missing:true}]};}throw Error('Missing schema must stop before marker verification');}};
  await assert.rejects(assertConfiguredDatabase(pool,identity),/schema unavailable/);
 }
});
test('Netlify exact current Auth sessions, company/individual scope and local logout remain protected',async()=>{
 const {config,materials}=fixture(),db=database(config,materials),auth=provider(config,db),a=randomUUID(),b=randomUUID();db.sessions.set(a,db.subject);db.sessions.set(b,db.subject);
 const runtime=await openNetlifyRuntime(config,materials,{poolFactory:db.poolFactory,fetchImpl:auth.fetchImpl});
 try{
  const call=(path,id=a,method='GET')=>runtime.handle(new Request(config.public_origin+path,{method,headers:{authorization:'Bearer '+db.token(id)}}));
  assert.equal(runtime.status().worker_running,false);assert.equal(db.sql.some(x=>x.text.includes('check_in_worker_state')),false);
  const me=await call('/v1/me');assert.equal(me.status,200);assert.equal((await me.json()).guard_id,'synthetic-individual');
  db.sessions.delete(a);assert.equal((await call('/v1/me')).status,401);db.sessions.set(a,db.subject);assert.equal((await call('/v1/session/logout',a,'POST')).status,200);assert.equal((await call('/v1/me')).status,401);assert.equal((await call('/v1/me',b)).status,200);
  const count=auth.calls.length;db.drift();assert.equal((await call('/v1/me',b)).status,503);assert.equal(auth.calls.length,count);assert.equal((await runtime.runWorkersOnce()).completed,false);
 }finally{await runtime.close();}assert.equal(db.ended,1);assert.equal((await runtime.handle(new Request(config.public_origin+'/v1/me'))).status,503);await assert.rejects(runtime.check(),/closed/);await assert.rejects(runtime.runWorkersOnce(),/closed/);
});
test('Netlify account mail defaults deny, and only an exact operator-approved recipient can call provider OTP',async()=>{
 for(const recipients of [[],['owner-approved@example.invalid']]){
  const {config,materials}=fixture({recipients}),db=database(config,materials),auth=provider(config,db),runtime=await openNetlifyRuntime(config,materials,{poolFactory:db.poolFactory,fetchImpl:auth.fetchImpl});
  const post=(path,body)=>runtime.handle(new Request(config.public_origin+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
  try{
   assert.equal((await post('/v1/account/code',{email:'unapproved@example.invalid',intent:'setup'})).status,503);assert.equal((await post('/v1/account/code',{email:'unapproved@example.invalid',intent:'recovery'})).status,503);assert.equal((await post('/v1/account/password',{email:'unapproved@example.invalid',code:'12345678',password:'synthetic-password-only'})).status,503);assert.equal(auth.calls.some(c=>!c.url.endsWith('/settings')),false);
   const response=await post('/v1/account/code',{email:'owner-approved@example.invalid',intent:'setup'});assert.equal(response.status,recipients.length?202:503);const otp=auth.calls.filter(c=>c.url.endsWith('/otp'));assert.equal(otp.length,recipients.length?1:0);if(otp.length)assert.equal(JSON.parse(otp[0].options.body).email,recipients[0]);
  }finally{await runtime.close();}
 }
});
test('Netlify workers run only one bounded explicit pass, serialize shared cursors and always release their session lock',async()=>{
 const {config,materials}=fixture(),db=database(config,materials),auth=provider(config,db),runtime=await openNetlifyRuntime(config,materials,{poolFactory:db.poolFactory,fetchImpl:auth.fetchImpl});
 try{
  const first=await runtime.runWorkersOnce();assert.equal(first.status,'completed');assert.equal(first.completed,true);assert.equal(db.lockHeld,false);assert.equal(db.sql.filter(x=>x.text.startsWith('SELECT * FROM mercury_guard.assignments')).length,1);assert.equal(runtime.status().worker_running,false);
  db.setLock(true);const at=db.sql.length;assert.deepEqual(await runtime.runWorkersOnce(),{status:'busy',completed:false});assert.equal(db.sql.slice(at).some(x=>x.text.includes('check_in_worker_state')),false);db.setLock(false);
  db.failLock();assert.equal((await runtime.runWorkersOnce()).completed,false);assert.equal(db.released.at(-1).destroy,true);
 }finally{await runtime.close();}
});
test('worker budget exhaustion stops new work, reports incomplete and releases locks; close drains admitted operations',async()=>{
 let time=0;const {config,materials}=fixture(),db=database(config,materials),auth=provider(config,db),runtime=await openNetlifyRuntime(config,materials,{poolFactory:db.poolFactory,fetchImpl:auth.fetchImpl,clock:()=>time});
 db.setHook(async text=>{if(text==='SELECT cursor FROM mercury_guard.check_in_worker_state WHERE id=1')time=1001;});
 const timed=await runtime.runWorkersOnce({maxDurationMs:1000});assert.equal(timed.status,'timed_out');assert.equal(timed.completed,false);assert.equal(db.lockHeld,false);assert.equal(db.sql.some(x=>x.text.startsWith('INSERT INTO mercury_guard.check_in_worker_state')),false);
 time=0;let entered,release;const began=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});db.setHook(async text=>{if(text==='SELECT cursor FROM mercury_guard.check_in_worker_state WHERE id=1'){entered();await gate;}});
 const running=runtime.runWorkersOnce();await began;assert.deepEqual(await runtime.runWorkersOnce(),{status:'busy',completed:false});let stopped=false;const stopping=runtime.close().then(()=>{stopped=true;});await new Promise(r=>setImmediate(r));assert.equal(stopped,false);await assert.rejects(runtime.runWorkersOnce(),/closed/);release();assert.equal((await running).completed,false);await stopping;assert.equal(stopped,true);assert.equal(db.ended,1);assert.equal(db.lockHeld,false);
});
