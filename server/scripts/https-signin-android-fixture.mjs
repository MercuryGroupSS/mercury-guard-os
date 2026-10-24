// Synthetic-only real Auth/PostgreSQL fixture for the actual native sign-in UI.
// No biometric callback, account session, or individual identity is injected.
import assert from 'node:assert/strict';
import {createServer,request as httpsRequest} from 'node:https';
import {randomUUID,randomBytes,generateKeyPairSync,createHash,sign,timingSafeEqual} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,unlinkSync,statSync,chmodSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {Client} from 'pg';
import {openLocalGuardDirectory} from '../local-directory-factory.mjs';
import {PostgresDeviceAssignments} from '../postgres-device-assignments.mjs';
import {PostgresDurableIngest} from '../postgres-durable-ingest.mjs';
import {PostgresShiftGrantIssuer} from '../postgres-shift-grant-issuer.mjs';
import {PostgresShiftLifecycle} from '../postgres-shift-lifecycle.mjs';
import {createLocalService} from '../local-service.mjs';
import {parseEnrollmentKey} from '../enrollment-key.mjs';
import {strictJson} from '../verify-batch.mjs';
import {readPrivateBuildFile} from '../controlled-apk-input.mjs';

const check=process.argv.length===3&&process.argv[2]==='--check';
if(process.argv.length>2&&!check)throw Error('Only --check is supported');
if(process.env.MERCURY_HTTPS_SIGNIN_FIXTURE!=='synthetic-only')throw Error('Explicit synthetic fixture mode required');
const root=new URL('../../',import.meta.url),dir=new URL('app/build/https-test/',root),privateFile=new URL('.local-backend/https-signin-android-fixture.json',root);
const config=JSON.parse(readPrivateBuildFile(new URL('supabase-start.log',root).pathname,512*1024).toString('utf8').split('\n').findLast(line=>line.startsWith('{')&&line.includes('API_URL'))),dbUrl=new URL(config.DB_URL);
if(config.API_URL!=='http://127.0.0.1:55321'||!['postgres:','postgresql:'].includes(dbUrl.protocol)||dbUrl.hostname!=='127.0.0.1'||dbUrl.port!=='55322'||dbUrl.pathname!=='/postgres'||dbUrl.username!=='postgres'||dbUrl.search||dbUrl.hash)throw Error('Own isolated local environment required');
const run=randomUUID(),prefix='https-signin-'+run,vendorId=prefix+'-company',siteId=prefix+'-site',deviceId=prefix+'-phone',password='synthetic-password-only',nonce=randomBytes(32).toString('base64url');
const guards=['a','b'].map(label=>({label,guardId:prefix+'-'+label,email:prefix+'-'+label+'@example.invalid',assignmentId:prefix+'-shift-'+label,subject:null}));
const owner=new Client({connectionString:config.DB_URL,connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:12000}),serviceHeaders={apikey:config.SERVICE_ROLE_KEY,authorization:'Bearer '+config.SERVICE_ROLE_KEY,'content-type':'application/json'};
const stats={enrollments:0,vendor_login_denied:0,logins:{a:0,b:0},profiles:{a:0,b:0},assignments:{a:0,b:0},logouts:{a:0,b:0},logged_out_session_denied:{a:0,b:0}};
const generated=[],inflight=new Set();let directory,devices,service,issuer,origin,tls,enrolledKey,ownerConnected=false,ownsPrivateFile=false,cleanupPromise;
let signalStop;const stopped=new Promise(resolve=>{signalStop=resolve;});process.once('SIGTERM',signalStop);process.once('SIGINT',signalStop);
const lifetime=setTimeout(signalStop,30*60*1000);lifetime.unref();
const provider=(path,options)=>fetch(config.API_URL+'/auth/v1/'+path,{...options,redirect:'error',signal:AbortSignal.timeout(8000)});
function generatedFile(path,content){const target=new URL(path,dir);let before=null,mode;try{before=readFileSync(target);mode=statSync(target).mode&0o777;}catch(error){if(error.code!=='ENOENT')throw error;}const bytes=Buffer.from(content);writeFileSync(target,bytes,{mode:0o600});chmodSync(target,0o600);generated.push({target,before,bytes,mode});}
function json(res,status,body){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));}
async function boundedBody(req,max){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>max)throw Error('Bounded fixture body required');chunks.push(chunk);}return Buffer.concat(chunks);}
async function enroll(spki){const key=parseEnrollmentKey(spki),prior=await devices.device(deviceId);if(prior){if(prior.thumbprint!==key.thumbprint||prior.publicKeySpki!==spki)throw Error('Different fixture key');enrolledKey=key;return;}await devices.enroll({deviceId,mode:'site',siteId,active:true,revoked:false,publicKeySpki:spki});enrolledKey=key;stats.enrollments++;}
async function handle(req,res){
 try{
  if(req.headers.host!=='localhost:55450')return json(res,400,{error:'fixture_host_required'});
  const url=new URL(req.url,'https://localhost:55450');if(url.search||url.hash)return json(res,400,{error:'no_query'});const path=url.pathname;
  if(path==='/test/health'&&req.method==='GET')return json(res,200,{status:'ready',fixture_type:'real_pg_auth_signin'});
  if(path.startsWith('/test/')){
   const value=req.headers['x-mercury-test-nonce'];if(typeof value!=='string'||Buffer.byteLength(value)!==Buffer.byteLength(nonce)||!timingSafeEqual(Buffer.from(value),Buffer.from(nonce)))return json(res,403,{error:'test_nonce_required'});
   if(path==='/test/stats'&&req.method==='GET')return json(res,200,{...stats,company_vendor:true,distinct_subjects:guards.every(g=>g.subject)&&guards[0].subject!==guards[1].subject});
   if(path!=='/test/enroll'||req.method!=='POST'||req.headers['content-type']?.split(';')[0].trim()!=='application/json')return json(res,404,{error:'test_not_found'});
   const body=strictJson((await boundedBody(req,4096)).toString('utf8'));if(!body||Array.isArray(body)||Object.keys(body).join()!=='public_key_spki')throw Error('Exact public enrollment required');await enroll(body.public_key_spki);return json(res,200,{});
  }
  const allowed=new Map([['/v1/session/login','POST'],['/v1/session/logout','POST'],['/v1/me','GET'],['/v1/device-challenge','POST'],['/v1/assignments','POST']]);
  if(allowed.get(path)!==req.method)return json(res,404,{error:'fixture_not_found'});
  const raw=await boundedBody(req,8192);let guard;
  if(path==='/v1/session/login'){
   const body=strictJson(raw.toString('utf8'));guard=guards.find(g=>g.guardId===body.guard_id);
   // The company Vendor ID deliberately reaches the real login handler. It has
   // no individual guard_login mapping, so denial is not fabricated here.
   if(!guard&&body.guard_id!==vendorId)return json(res,403,{error:'fixture_guard_required'});
  }else{
   const token=/^Bearer ([^\s]+)$/.exec(req.headers.authorization??'')?.[1];let subject;try{subject=strictJson(Buffer.from(token?.split('.')[1]??'','base64url').toString('utf8')).sub;}catch{}
   guard=guards.find(g=>g.subject===subject);if(!guard)return json(res,401,{error:'fixture_session_required'});
   // This confines the fixture only; the real service verifies the exact
   // current Auth session and device proof independently.
   if(path==='/v1/device-challenge'&&strictJson(raw.toString('utf8')).device_id!==deviceId)return json(res,403,{error:'fixture_device_required'});
  }
  const response=await fetch(origin+path,{method:req.method,headers:{'content-type':req.headers['content-type']??'application/json',authorization:req.headers.authorization??''},...(['GET','HEAD'].includes(req.method)?{}:{body:raw}),redirect:'error',signal:AbortSignal.timeout(12000)}),bytes=Buffer.from(await response.arrayBuffer());
  if(path==='/v1/session/login'&&!guard&&response.status===401)stats.vendor_login_denied++;
  if(guard&&response.status===200){
   if(path==='/v1/session/login')stats.logins[guard.label]++;
   if(path==='/v1/me')stats.profiles[guard.label]++;
   if(path==='/v1/assignments'){const result=strictJson(bytes.toString('utf8'));assert.equal(result.assignments.length,1);assert.equal(result.assignments[0].assignmentId,guard.assignmentId);stats.assignments[guard.label]++;}
   if(path==='/v1/session/logout'){stats.logouts[guard.label]++;const denied=await fetch(origin+'/v1/me',{headers:{authorization:req.headers.authorization},redirect:'error',signal:AbortSignal.timeout(12000)});await denied.arrayBuffer();if(denied.status===401)stats.logged_out_session_denied[guard.label]++;}
  }
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(bytes);
 }catch{json(res,400,{error:'synthetic_fixture_rejected'});}
}
async function cleanup(){
 if(cleanupPromise)return cleanupPromise;
 cleanupPromise=(async()=>{
  const failures=[],attempt=async fn=>{try{await fn();}catch(error){failures.push(error);}};clearTimeout(lifetime);
  await attempt(async()=>{if(tls?.listening){tls.closeAllConnections();await new Promise((resolve,reject)=>tls.close(error=>error?reject(error):resolve()));}});await attempt(async()=>{await Promise.allSettled([...inflight]);});await attempt(()=>service?.stop());await attempt(()=>directory?.close());issuer?.close();
  if(ownerConnected){
   for(const guard of guards)await attempt(async()=>{if(!guard.subject){const rows=(await owner.query("SELECT id FROM auth.users WHERE email=$1 AND raw_user_meta_data->>'mercury_fixture_run'=$2",[guard.email,prefix])).rows;assert.ok(rows.length<=1);guard.subject=rows[0]?.id;}});
   const ids=guards.map(g=>g.guardId),assignments=guards.map(g=>g.assignmentId),subjects=guards.map(g=>g.subject).filter(Boolean),emails=guards.map(g=>g.email),buckets=[...ids,vendorId].map(id=>'account:'+createHash('sha256').update(id).digest('hex'));
   await attempt(()=>owner.query('DELETE FROM mercury_guard.device_challenges WHERE device_id=$1 AND auth_subject=ANY($2::uuid[])',[deviceId,subjects]));
   await attempt(()=>owner.query('DELETE FROM mercury_guard.assignments WHERE assignment_id=ANY($1::text[]) AND guard_id=ANY($2::text[]) AND vendor_id=$3',[assignments,ids,vendorId]));
   await attempt(()=>owner.query('DELETE FROM mercury_guard.devices WHERE device_id=$1 AND site_id=$2',[deviceId,siteId]));
   await attempt(()=>owner.query('DELETE FROM mercury_guard.guard_login WHERE guard_id=ANY($1::text[]) AND email=ANY($2::text[])',[ids,emails]));
   await attempt(()=>owner.query('DELETE FROM mercury_guard.guards WHERE guard_id=ANY($1::text[]) AND vendor_id=$2',[ids,vendorId]));await attempt(()=>owner.query('DELETE FROM mercury_guard.vendors WHERE vendor_id=$1',[vendorId]));await attempt(()=>owner.query('DELETE FROM mercury_guard.sites WHERE site_id=$1',[siteId]));await attempt(()=>owner.query('DELETE FROM mercury_guard.login_attempts WHERE bucket=ANY($1::text[])',[buckets]));
   for(const subject of subjects)await attempt(async()=>{const response=await provider('admin/users/'+subject,{method:'DELETE',headers:serviceHeaders});assert.equal(response.ok,true);});
   await attempt(async()=>{const rows=(await owner.query(`SELECT
    (SELECT count(*) FROM mercury_guard.device_challenges WHERE device_id=$1) AS challenges,
    (SELECT count(*) FROM mercury_guard.devices WHERE device_id=$1) AS devices,
    (SELECT count(*) FROM mercury_guard.assignments WHERE assignment_id=ANY($2::text[])) AS assignments,
    (SELECT count(*) FROM mercury_guard.guard_login WHERE guard_id=ANY($3::text[])) AS logins,
    (SELECT count(*) FROM mercury_guard.guards WHERE guard_id=ANY($3::text[])) AS guards,
    (SELECT count(*) FROM mercury_guard.vendors WHERE vendor_id=$4) AS vendors,
    (SELECT count(*) FROM mercury_guard.sites WHERE site_id=$5) AS sites,
    (SELECT count(*) FROM mercury_guard.login_attempts WHERE bucket=ANY($6::text[])) AS limiter,
    (SELECT count(*) FROM auth.users WHERE email=ANY($7::text[]) AND raw_user_meta_data->>'mercury_fixture_run'=$8) AS users,
    (SELECT count(*) FROM auth.sessions WHERE user_id=ANY($9::uuid[])) AS sessions`,[deviceId,assignments,ids,vendorId,siteId,buckets,emails,prefix,subjects])).rows[0];assert.ok(Object.values(rows).every(n=>Number(n)===0));});
  }
  for(const {target,before,bytes,mode} of generated.reverse())await attempt(async()=>{let current;try{current=readFileSync(target);}catch(error){if(error.code==='ENOENT')throw Error('Owned generated asset disappeared');throw error;}if(!current.equals(bytes)||(statSync(target).mode&0o777)!==0o600)throw Error('Generated asset ownership changed');if(before===null)unlinkSync(target);else{writeFileSync(target,before);chmodSync(target,mode);}});
  if(ownsPrivateFile&&!failures.length)await attempt(async()=>{const saved=JSON.parse(readFileSync(privateFile,'utf8'));assert.equal(saved.pid,process.pid);assert.equal(saved.run,run);unlinkSync(privateFile);ownsPrivateFile=false;});await attempt(()=>owner.end());
  if(failures.length)throw new AggregateError(failures,'Exact synthetic sign-in cleanup unconfirmed; ownership retained');
  console.log('PASS: exact HTTPS sign-in company/guards/assignments/device/challenges, Auth users/sessions and test assets cleaned; global limiter retained.');
 })();return cleanupPromise;
}
function tlsCall(path,{body,token,testNonce=nonce,method}={}){return new Promise((resolve,reject)=>{const bytes=body===undefined?null:Buffer.from(JSON.stringify(body)),req=httpsRequest({hostname:'localhost',port:55450,path,method:method??(bytes?'POST':'GET'),ca:readFileSync(new URL('res/raw/https_fixture_ca.pem',dir)),headers:{...(token?{authorization:'Bearer '+token}:{}),...(testNonce?{'x-mercury-test-nonce':testNonce}:{}),...(bytes?{'content-type':'application/json','content-length':bytes.length}:{})}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks))});}catch(error){reject(error);}});});req.setTimeout(15000,()=>req.destroy(Error('TLS timeout')));req.on('error',reject);req.end(bytes);});}
async function selfCheck(){
 assert.equal((await tlsCall('/test/health')).body.fixture_type,'real_pg_auth_signin');const key=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),spki=key.publicKey.export({type:'spki',format:'der'}).toString('base64url'),thumb=createHash('sha256').update(Buffer.from(spki,'base64url')).digest('hex');
 assert.equal((await tlsCall('/test/enroll',{body:{public_key_spki:spki},testNonce:'wrong'})).status,403);assert.equal((await tlsCall('/test/enroll',{body:{public_key_spki:spki}})).status,200);
 assert.equal((await tlsCall('/v1/session/login',{body:{guard_id:vendorId,password}})).status,401);
 for(const guard of guards){const login=await tlsCall('/v1/session/login',{body:{guard_id:guard.guardId,password}});assert.equal(login.status,200);const token=login.body.access_token,profile=await tlsCall('/v1/me',{token});assert.equal(profile.body.guard_id,guard.guardId);assert.equal(profile.body.vendor_id,vendorId);assert.equal(profile.body.auth_subject,guard.subject);
  const challenge=(await tlsCall('/v1/device-challenge',{token,body:{device_id:deviceId}})).body,message=`mercury-enrollment-proof-v1\n${challenge.audience}\n${challenge.request_id}\n${challenge.challenge}\n${thumb}`;
  const proof={version:1,algorithm:'SHA256withECDSA',audience:challenge.audience,request_id:challenge.request_id,challenge:challenge.challenge,device_thumbprint:thumb,public_key_spki:spki,signature_der:sign('sha256',Buffer.from(message),key.privateKey).toString('base64url')};const result=await tlsCall('/v1/assignments',{token,body:proof});assert.equal(result.status,200);assert.equal(result.body.assignments.length,1);assert.equal(result.body.assignments[0].assignmentId,guard.assignmentId);assert.ok(result.body.server_time_ms>0);
  assert.equal((await tlsCall('/v1/session/logout',{token,method:'POST'})).status,200);assert.equal((await tlsCall('/v1/me',{token})).status,401);
 }
 assert.equal(stats.vendor_login_denied,1);assert.ok(guards.every(g=>stats.logged_out_session_denied[g.label]===1));console.log('PASS: two real Auth subjects share one company Vendor ID; actual vendor login denied; signed device assignment isolation and current-session logout verified.');
}
try{
 for(const name of ['https-location-android-fixture.json','https-escalation-android-fixture.json'])if(existsSync(new URL('.local-backend/'+name,root)))throw Error('Another HTTPS resource owner requires coordination');
 mkdirSync(new URL('.local-backend/',root),{recursive:true,mode:0o700});writeFileSync(privateFile,JSON.stringify({pid:process.pid,run,vendorId,siteId,deviceId,guards}),{mode:0o600,flag:'wx'});ownsPrivateFile=true;await owner.connect();ownerConnected=true;
 for(const guard of guards){const response=await provider('admin/users',{method:'POST',headers:serviceHeaders,body:JSON.stringify({email:guard.email,password,email_confirm:true,user_metadata:{mercury_fixture_run:prefix}})});assert.equal(response.status,200);guard.subject=(await response.json()).id;assert.match(guard.subject,/^[a-f0-9-]{36}$/);}
 await owner.query("INSERT INTO mercury_guard.vendors(vendor_id,kind,active) VALUES($1,'company',true)",[vendorId]);await owner.query('INSERT INTO mercury_guard.sites(site_id,active) VALUES($1,true)',[siteId]);
 for(const guard of guards){await owner.query('INSERT INTO mercury_guard.guards(guard_id,auth_subject,vendor_id,active) VALUES($1,$2,$3,true)',[guard.guardId,guard.subject,vendorId]);await owner.query('INSERT INTO mercury_guard.guard_login(guard_id,email) VALUES($1,$2)',[guard.guardId,guard.email]);}
 directory=await openLocalGuardDirectory({config,mode:'postgres'});devices=new PostgresDeviceAssignments(directory.client);for(const guard of guards)await devices.assign({assignmentId:guard.assignmentId,guardId:guard.guardId,vendorId,siteId,active:true,startsAt:Date.now()-1000,endsAt:Date.now()+3600000});
 devices.scheduledAfter=async()=>[];const store=new PostgresDurableIngest(devices);store.workerState={cursor:()=>'',saveCursor:()=>{},finalized:()=>false,mark:()=>{}};
 const signing=generateKeyPairSync('rsa',{modulusLength:2048});issuer=new PostgresShiftGrantIssuer({devices,privateKey:signing.privateKey,keyId:'https-fixture',issuer:'mercury-local',audience:'mercury-local'});service=createLocalService({config,directory,devices,store,grantIssuer:issuer,shiftLifecycle:new PostgresShiftLifecycle(devices)});origin=await service.start();
 writeFileSync(privateFile,JSON.stringify({pid:process.pid,run,origin,vendorId,siteId,deviceId,guards}),{mode:0o600});for(const part of ['res/raw/','res/xml/','assets/','main-assets/'])mkdirSync(new URL(part,dir),{recursive:true});
 const tempKey=new URL('tls-signin-'+run+'.key',dir),tempCert=new URL('tls-signin-'+run+'.pem',dir);
 try{execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',tempKey.pathname,'-out',tempCert.pathname,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost','-addext','extendedKeyUsage=serverAuth'],{stdio:'ignore'});generatedFile('tls-signin-private.pem',readFileSync(tempKey));generatedFile('res/raw/https_fixture_ca.pem',readFileSync(tempCert));}finally{for(const file of [tempKey,tempCert])try{unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}}
 generatedFile('res/xml/https_test_network.xml','<network-security-config><base-config cleartextTrafficPermitted="false"/><domain-config cleartextTrafficPermitted="false"><domain>localhost</domain><trust-anchors><certificates src="@raw/https_fixture_ca"/></trust-anchors></domain-config></network-security-config>');const publicIssuer=issuer.publicKey();generatedFile('assets/https-test-issuer.json',JSON.stringify({public_key_spki:publicIssuer}));generatedFile('main-assets/guard-service.json',JSON.stringify({endpoint:'https://localhost:55450',issuer:'mercury-local',audience:'mercury-local',device_id:deviceId,issuer_keys:{'https-fixture':publicIssuer}}));
 generatedFile('assets/signin-test-fixture.json',JSON.stringify({fixture_type:'real_pg_auth_signin',vendor_id:vendorId,site_id:siteId,device_id:deviceId,password,test_nonce:nonce,guards:guards.map(g=>({label:g.label,guard_id:g.guardId,assignment_id:g.assignmentId}))}));
 tls=createServer({key:readFileSync(new URL('tls-signin-private.pem',dir)),cert:readFileSync(new URL('res/raw/https_fixture_ca.pem',dir)),minVersion:'TLSv1.2'},(req,res)=>{const task=handle(req,res);inflight.add(task);task.finally(()=>inflight.delete(task)).catch(()=>{});});tls.requestTimeout=15000;tls.headersTimeout=10000;await new Promise((resolve,reject)=>{tls.once('error',reject);tls.listen(55450,'127.0.0.1',resolve);});
 if(check){await selfCheck();await cleanup();}else{console.log('Real local PostgreSQL/Auth Android sign-in HTTPS fixture ready on localhost:55450; debug-only resources generated.');await stopped;await cleanup();}
}catch(error){await cleanup();throw error;}
