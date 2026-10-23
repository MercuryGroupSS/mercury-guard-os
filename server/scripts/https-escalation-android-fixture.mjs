// Real local Auth/PostgreSQL escalation acceptance behind loopback TLS. Every
// account, row and test mutation is confined to this random synthetic run.
import assert from 'node:assert/strict';
import {createServer} from 'node:https';
import {request as httpsRequest} from 'node:https';
import {generateKeyPairSync,randomUUID,randomBytes,createHash,sign,timingSafeEqual} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {Client} from 'pg';
import {openLocalGuardDirectory} from '../local-directory-factory.mjs';
import {PostgresDeviceAssignments} from '../postgres-device-assignments.mjs';
import {PostgresAdministration} from '../postgres-administration.mjs';
import {PostgresEscalations} from '../postgres-escalations.mjs';
import {PostgresShiftLifecycle} from '../postgres-shift-lifecycle.mjs';
import {createLocalService} from '../local-service.mjs';
import {parseEnrollmentKey} from '../enrollment-key.mjs';
import {strictJson} from '../verify-batch.mjs';
import {escalationProofMessage} from '../escalation-proof.mjs';

const check=process.argv.length===3&&process.argv[2]==='--check';
if(process.argv.length>2&&!check)throw Error('Only --check is supported');
if(process.env.MERCURY_HTTPS_ESCALATION_FIXTURE!=='synthetic-only')throw Error('Explicit synthetic fixture mode required');
const root=new URL('../../',import.meta.url),dir=new URL('app/build/https-test/',root),privateFile=new URL('.local-backend/https-escalation-android-fixture.json',root);
const config=JSON.parse(readFileSync(new URL('supabase-start.log',root),'utf8').split('\n').findLast(line=>line.startsWith('{')&&line.includes('API_URL'))),dbUrl=new URL(config.DB_URL);
if(config.API_URL!=='http://127.0.0.1:55321'||!['postgres:','postgresql:'].includes(dbUrl.protocol)||dbUrl.hostname!=='127.0.0.1'||dbUrl.port!=='55322'||dbUrl.search||dbUrl.hash)throw Error('Own isolated local environment required');
const run=randomUUID(),prefix='https-escalation-'+run,guardId=prefix+'-guard',vendorId=prefix+'-vendor',siteId=prefix+'-site',deviceId=prefix+'-phone',assignmentId=prefix+'-shift';
const guardEmail=prefix+'-guard@example.invalid',adminEmail=prefix+'-admin@example.invalid',password='synthetic-password-only',adminPassword=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url');
const owner=new Client({connectionString:config.DB_URL,connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:12000}),serviceHeaders={apikey:config.SERVICE_ROLE_KEY,authorization:'Bearer '+config.SERVICE_ROLE_KEY,'content-type':'application/json'};
const generated=[],ackRequests=new Map(),inflight=new Set();let adminSubject,guardSubject,directory,devices,service,origin,tls,adminToken,ownerConnected=false,ownsPrivateFile=false,cleanupPromise;
let signalStop;const stopped=new Promise(resolve=>{signalStop=resolve;});
// Catch termination during setup too: finish the bounded operation, then clean
// up, rather than leaving an account whose create response was in flight.
process.once('SIGTERM',signalStop);process.once('SIGINT',signalStop);
const lifetime=setTimeout(signalStop,45*60*1000);lifetime.unref();
const provider=(path,options)=>fetch(config.API_URL+'/auth/v1/'+path,{...options,redirect:'error',signal:AbortSignal.timeout(8000)});
const internal=(path,token,body)=>fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(10000)});
function generatedFile(path,content){const target=new URL(path,dir);let before=null;try{before=readFileSync(target);}catch(error){if(error.code!=='ENOENT')throw error;}const bytes=Buffer.from(content);writeFileSync(target,bytes,{mode:0o600});generated.push({target,before,bytes});}
function json(res,status,body){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));}
async function boundedBody(req,max){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>max)throw Error('Bounded fixture request required');chunks.push(chunk);}return Buffer.concat(chunks);}
const exact=(body,keys)=>{if(!body||Array.isArray(body)||Object.keys(body).sort().join()!==[...keys].sort().join())throw Error('Exact fixture request required');};
async function createUser(email,userPassword){const response=await provider('admin/users',{method:'POST',headers:serviceHeaders,body:JSON.stringify({email,password:userPassword,email_confirm:true,user_metadata:{mercury_fixture_run:prefix}})});assert.equal(response.status,200);const user=await response.json();assert.match(user.id,/^[a-f0-9-]{36}$/);return user.id;}
async function enroll(publicKeySpki){
 const key=parseEnrollmentKey(publicKeySpki);
 const prior=await devices.device(deviceId);if(prior){if(prior.thumbprint!==key.thumbprint||prior.publicKeySpki!==publicKeySpki)throw Error('Fixture already enrolled with a different key');return;}
 await devices.enroll({deviceId,mode:'site',siteId,active:true,revoked:false,publicKeySpki});
}
async function operatorAck(id){
 assert.match(id,/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);
 assert.equal((await owner.query('SELECT 1 FROM mercury_guard.escalations WHERE escalation_id=$1 AND subject=$2 AND guard_id=$3 AND device_id=$4',[id,guardSubject,guardId,deviceId])).rowCount,1,'Only this fixture device escalation can be acknowledged');
 let request=ackRequests.get(id);if(!request){request={request_id:randomUUID(),action:'escalation.acknowledge',reason:'Synthetic Android acceptance operator acknowledgement; no real emergency or external notification.',payload:{escalation_id:id}};ackRequests.set(id,request);}
 const response=await internal('/v1/admin/actions',adminToken,request);assert.equal(response.status,200);const receipt=await response.json();assert.equal(receipt.status,'applied');return receipt;
}
async function handle(req,res){
 try{
  if(req.headers.host!=='localhost:55444')return json(res,400,{error:'fixture_host_required'});
  const url=new URL(req.url,'https://localhost:55444');if(url.search||url.hash)return json(res,400,{error:'no_query'});
  const path=url.pathname;
  if(path==='/test/health'&&req.method==='GET'){return json(res,200,{status:'ready',fixture_type:'real_pg_auth_escalations'});}
  if(path.startsWith('/test/')){
   const supplied=req.headers['x-mercury-test-nonce'];if(typeof supplied!=='string'||Buffer.byteLength(supplied)!==Buffer.byteLength(nonce)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(nonce)))return json(res,403,{error:'test_nonce_required'});
   if(req.method!=='POST'||req.headers['content-type']?.split(';')[0].trim()!=='application/json')return json(res,400,{error:'fixture_json_post_required'});
   const body=strictJson((await boundedBody(req,4096)).toString('utf8'));
   if(path==='/test/enroll'){exact(body,['public_key_spki']);await enroll(body.public_key_spki);return json(res,200,{});}
   if(path==='/test/operator-ack'){exact(body,['escalation_id']);return json(res,200,await operatorAck(body.escalation_id));}
   if(path==='/test/cancel-assignment'){exact(body,[]);assert.equal((await owner.query('UPDATE mercury_guard.assignments SET active=false WHERE assignment_id=$1 AND guard_id=$2 AND vendor_id=$3',[assignmentId,guardId,vendorId])).rowCount,1);return json(res,200,{});}
   return json(res,404,{error:'fixture_not_found'});
  }
  const allowed=new Map([['/v1/session/login','POST'],['/v1/session/logout','POST'],['/v1/me','GET'],['/v1/device-challenge','POST'],['/v1/assignments','POST'],['/v1/escalations','POST'],['/v1/escalations/status','POST']]);
  if(allowed.get(path)!==req.method)return json(res,404,{error:'fixture_not_found'});
  const raw=await boundedBody(req,16384);
  if(path==='/v1/session/login'){const body=strictJson(raw.toString('utf8'));if(body.guard_id!==guardId)return json(res,403,{error:'fixture_guard_required'});}
  else{
   const bearer=/^Bearer ([^\s]+)$/.exec(req.headers.authorization??'')?.[1];let subject;try{subject=strictJson(Buffer.from(bearer?.split('.')[1]??'','base64url').toString('utf8')).sub;}catch{}
   // This is only a confinement filter. The real service verifies Auth, its
   // current exact session and all guard/device authority independently.
   if(subject!==guardSubject)return json(res,401,{error:'fixture_session_required'});
   if(path==='/v1/device-challenge'&&strictJson(raw.toString('utf8')).device_id!==deviceId)return json(res,403,{error:'fixture_device_required'});
  }
  const response=await fetch(origin+path,{method:req.method,headers:{'content-type':req.headers['content-type']??'application/json',authorization:req.headers.authorization??''},...(['GET','HEAD'].includes(req.method)?{}:{body:raw}),redirect:'error',signal:AbortSignal.timeout(12000)});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{json(res,400,{error:'synthetic_fixture_rejected'});}
}
async function cleanup(){
 if(cleanupPromise)return cleanupPromise;
 cleanupPromise=(async()=>{const failures=[],attempt=async fn=>{try{await fn();}catch(error){failures.push(error);}};
  clearTimeout(lifetime);
  await attempt(async()=>{if(tls?.listening){tls.closeAllConnections();await new Promise((resolve,reject)=>tls.close(error=>error?reject(error):resolve()));}});
  // Aborting a TLS client cannot be used as evidence that its server-side
  // transaction failed. Drain accepted handlers before scoped row cleanup.
  await attempt(async()=>{await Promise.allSettled([...inflight]);});
  await attempt(async()=>service?.stop());await attempt(async()=>directory?.close());adminToken=null;
  if(ownerConnected){
   async function recover(email,subject){if(subject)return subject;const rows=(await owner.query("SELECT id FROM auth.users WHERE email=$1 AND raw_user_meta_data->>'mercury_fixture_run'=$2",[email,prefix])).rows;assert.ok(rows.length<=1);return rows[0]?.id;}
   await attempt(async()=>{adminSubject=await recover(adminEmail,adminSubject);});await attempt(async()=>{guardSubject=await recover(guardEmail,guardSubject);});
   if(guardSubject){await attempt(()=>owner.query('DELETE FROM mercury_guard.escalation_acknowledgements a USING mercury_guard.escalations e WHERE a.escalation_id=e.escalation_id AND e.subject=$1 AND e.device_id=$2',[guardSubject,deviceId]));await attempt(()=>owner.query('DELETE FROM mercury_guard.escalations WHERE subject=$1 AND device_id=$2',[guardSubject,deviceId]));await attempt(()=>owner.query('DELETE FROM mercury_guard.device_challenges WHERE auth_subject=$1 AND device_id=$2',[guardSubject,deviceId]));}
   if(adminSubject)await attempt(()=>owner.query('DELETE FROM mercury_guard.admin_audit WHERE actor_subject=$1',[adminSubject]));
   await attempt(()=>owner.query('DELETE FROM mercury_guard.assignments WHERE assignment_id=$1 AND guard_id=$2 AND vendor_id=$3',[assignmentId,guardId,vendorId]));await attempt(()=>owner.query('DELETE FROM mercury_guard.devices WHERE device_id=$1 AND site_id=$2',[deviceId,siteId]));
   await attempt(()=>owner.query('DELETE FROM mercury_guard.guard_login WHERE guard_id=$1 AND email=$2',[guardId,guardEmail]));await attempt(()=>owner.query('DELETE FROM mercury_guard.guards WHERE guard_id=$1 AND vendor_id=$2',[guardId,vendorId]));await attempt(()=>owner.query('DELETE FROM mercury_guard.vendors WHERE vendor_id=$1',[vendorId]));await attempt(()=>owner.query('DELETE FROM mercury_guard.sites WHERE site_id=$1',[siteId]));
   if(adminSubject)await attempt(()=>owner.query('DELETE FROM mercury_guard.admin_accounts WHERE auth_subject=$1 AND email=$2',[adminSubject,adminEmail]));
   const buckets=['account:'+createHash('sha256').update(guardId).digest('hex'),'account:'+createHash('sha256').update('admin-login:'+adminEmail).digest('hex')];await attempt(()=>owner.query('DELETE FROM mercury_guard.login_attempts WHERE bucket=ANY($1::text[])',[buckets]));
   for(const subject of [guardSubject,adminSubject].filter(Boolean))await attempt(async()=>{const response=await provider('admin/users/'+subject,{method:'DELETE',headers:serviceHeaders});assert.equal(response.ok,true);});
   await attempt(async()=>{const remaining=(await owner.query(`SELECT
    (SELECT count(*) FROM mercury_guard.escalations WHERE device_id=$1) AS intents,
    (SELECT count(*) FROM mercury_guard.escalation_acknowledgements WHERE actor_subject=$2) AS acknowledgements,
    (SELECT count(*) FROM mercury_guard.admin_audit WHERE actor_subject=$2) AS audit,
    (SELECT count(*) FROM mercury_guard.admin_accounts WHERE auth_subject=$2) AS memberships,
    (SELECT count(*) FROM mercury_guard.device_challenges WHERE auth_subject=$3 AND device_id=$1) AS challenges,
    (SELECT count(*) FROM mercury_guard.devices WHERE device_id=$1) AS devices,
    (SELECT count(*) FROM mercury_guard.assignments WHERE assignment_id=$4) AS assignments,
    (SELECT count(*) FROM mercury_guard.guard_login WHERE guard_id=$5) AS logins,
    (SELECT count(*) FROM mercury_guard.guards WHERE guard_id=$5) AS guards,
    (SELECT count(*) FROM mercury_guard.vendors WHERE vendor_id=$6) AS vendors,
    (SELECT count(*) FROM mercury_guard.sites WHERE site_id=$7) AS sites,
    (SELECT count(*) FROM mercury_guard.login_attempts WHERE bucket=ANY($8::text[])) AS limiter,
    (SELECT count(*) FROM auth.users WHERE email=ANY($9::text[]) AND raw_user_meta_data->>'mercury_fixture_run'=$10) AS users,
    (SELECT count(*) FROM auth.sessions WHERE user_id=ANY($11::uuid[])) AS sessions`,[deviceId,adminSubject??null,guardSubject??null,assignmentId,guardId,vendorId,siteId,buckets,[guardEmail,adminEmail],prefix,[guardSubject,adminSubject].filter(Boolean)])).rows[0];assert.ok(Object.values(remaining).every(value=>Number(value)===0),'Exact synthetic cleanup left rows');});
  }
  if(ownsPrivateFile)await attempt(async()=>{const saved=JSON.parse(readFileSync(privateFile,'utf8'));assert.equal(saved.pid,process.pid);assert.equal(saved.run,run);unlinkSync(privateFile);ownsPrivateFile=false;});
  for(const {target,before,bytes} of generated.reverse())await attempt(async()=>{let current;try{current=readFileSync(target);}catch(error){if(error.code==='ENOENT')return;throw error;}if(!current.equals(bytes))return;if(before===null)unlinkSync(target);else writeFileSync(target,before,{mode:0o600});});
  await attempt(()=>owner.end());if(failures.length)throw new AggregateError(failures,'Synthetic HTTPS escalation cleanup could not be fully verified');
  console.log('PASS: exact HTTPS escalation rows, operator audit, account buckets, Auth users and sessions removed; global limiter retained.');
 })();return cleanupPromise;
}
function tlsCall(path,{body,token,testNonce=nonce,hostname='localhost'}={}){return new Promise((resolve,reject)=>{const bytes=body===undefined?null:Buffer.from(JSON.stringify(body));const request=httpsRequest({hostname,port:55444,path,method:body===undefined?'GET':'POST',ca:readFileSync(new URL('res/raw/https_fixture_ca.pem',dir)),headers:{...(token?{authorization:'Bearer '+token}:{}),...(testNonce?{'x-mercury-test-nonce':testNonce}:{}),...(bytes?{'content-type':'application/json','content-length':bytes.length}:{})}},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{try{resolve({status:response.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch(error){reject(error);}});});request.setTimeout(15000,()=>request.destroy(Error('TLS fixture timeout')));request.on('error',reject);request.end(bytes);});}
async function selfCheck(){
 assert.equal((await tlsCall('/test/health')).body.fixture_type,'real_pg_auth_escalations');await assert.rejects(tlsCall('/test/health',{hostname:'127.0.0.1'}),error=>error.code==='ERR_TLS_CERT_ALTNAME_INVALID');
 const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),spki=keys.publicKey.export({type:'spki',format:'der'}).toString('base64url'),thumb=createHash('sha256').update(Buffer.from(spki,'base64url')).digest('hex');
 assert.equal((await tlsCall('/test/enroll',{body:{public_key_spki:spki},testNonce:'wrong'})).status,403);assert.equal((await tlsCall('/test/enroll',{body:{public_key_spki:spki}})).status,200);assert.equal((await tlsCall('/test/enroll',{body:{public_key_spki:spki}})).status,200);
 const other=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({type:'spki',format:'der'}).toString('base64url');assert.equal((await tlsCall('/test/enroll',{body:{public_key_spki:other}})).status,400);
 const login=await tlsCall('/v1/session/login',{body:{guard_id:guardId,password}});assert.equal(login.status,200);const token=login.body.access_token;assert.equal((await tlsCall('/v1/me',{token})).body.guard_id,guardId);
 const assignmentChallenge=await tlsCall('/v1/device-challenge',{token,body:{device_id:deviceId}});assert.equal(assignmentChallenge.status,200);const ac=assignmentChallenge.body;
 const assignmentProof={version:1,algorithm:'SHA256withECDSA',audience:ac.audience,request_id:ac.request_id,challenge:ac.challenge,device_thumbprint:thumb,public_key_spki:spki,signature_der:sign('sha256',Buffer.from(`mercury-enrollment-proof-v1\n${ac.audience}\n${ac.request_id}\n${ac.challenge}\n${thumb}`),keys.privateKey).toString('base64url')};
 const assignments=await tlsCall('/v1/assignments',{token,body:assignmentProof});assert.equal(assignments.status,200);assert.equal(assignments.body.assignments.length,1);assert.ok(Number.isSafeInteger(assignments.body.server_time_ms));assert.equal(assignments.body.assignments[0].shift_state.state,'not_started');
 const proof=async(operation,hash)=>{const challenge=await tlsCall('/v1/device-challenge',{token,body:{device_id:deviceId}});assert.equal(challenge.status,200);const c=challenge.body;return {version:1,algorithm:'SHA256withECDSA',audience:c.audience,request_id:c.request_id,challenge:c.challenge,device_thumbprint:thumb,public_key_spki:spki,signature_der:sign('sha256',Buffer.from(escalationProofMessage({audience:c.audience,operation,requestId:c.request_id,challenge:c.challenge,thumbprint:thumb,payloadHash:hash})),keys.privateKey).toString('base64url')};};
 const id=randomUUID(),intent={version:1,escalation_id:id,guard_id:guardId,vendor_id:vendorId,assignment_id:assignmentId,occurred_at_ms:Date.now(),urgency:'assistance',description:'Synthetic Android TLS acceptance only; no real assistance requested.',location:null},raw=Buffer.from(JSON.stringify(intent)),hash=createHash('sha256').update(raw).digest('hex');
 const send=async()=>tlsCall('/v1/escalations',{token,body:{intent:raw.toString('base64url'),proof:await proof('create',hash)}});const first=await send();assert.equal(first.status,200);assert.equal(first.body.status,'received_by_guard_service');assert.deepEqual((await send()).body,first.body);
 assert.equal((await tlsCall('/test/cancel-assignment',{body:{}})).status,200);const status=async()=>{const hash=createHash('sha256').update(JSON.stringify({escalation_id:id})).digest('hex');return tlsCall('/v1/escalations/status',{token,body:{escalation_id:id,proof:await proof('status',hash)}});};assert.equal((await status()).body.status,'received_by_guard_service');
 assert.equal((await tlsCall('/test/operator-ack',{body:{escalation_id:randomUUID()}})).status,400);const ack=await tlsCall('/test/operator-ack',{body:{escalation_id:id}});assert.equal(ack.status,200);assert.equal(ack.body.status,'applied');assert.deepEqual((await tlsCall('/test/operator-ack',{body:{escalation_id:id}})).body,ack.body);assert.equal((await status()).body.status,'operator_acknowledged');
 const offShift={...intent,escalation_id:randomUUID(),assignment_id:null},offRaw=Buffer.from(JSON.stringify(offShift)),offHash=createHash('sha256').update(offRaw).digest('hex');assert.equal((await tlsCall('/v1/escalations',{token,body:{intent:offRaw.toString('base64url'),proof:await proof('create',offHash)}})).status,200);
 const signedOut=await new Promise((resolve,reject)=>{const req=httpsRequest({hostname:'localhost',port:55444,path:'/v1/session/logout',method:'POST',ca:readFileSync(new URL('res/raw/https_fixture_ca.pem',dir)),headers:{authorization:'Bearer '+token}},res=>{res.resume();res.once('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();});assert.equal(signedOut,200);assert.equal((await tlsCall('/v1/me',{token})).status,401);
 console.log('PASS: trusted localhost TLS, host/nonce/key confinement, real Auth/session revocation, signed create/retry/off-shift intake, status after cancellation and real idempotent operator acknowledgement.');
}

try{
 mkdirSync(new URL('.local-backend/',root),{recursive:true,mode:0o700});writeFileSync(privateFile,JSON.stringify({pid:process.pid,run,guardId,vendorId,siteId,deviceId,assignmentId}),{mode:0o600,flag:'wx'});ownsPrivateFile=true;
 await owner.connect();ownerConnected=true;
 adminSubject=await createUser(adminEmail,adminPassword);guardSubject=await createUser(guardEmail,password);
 await owner.query('INSERT INTO mercury_guard.vendors(vendor_id,kind,active) VALUES($1,$2,true)',[vendorId,'individual']);await owner.query('INSERT INTO mercury_guard.sites(site_id,active) VALUES($1,true)',[siteId]);await owner.query('INSERT INTO mercury_guard.guards(guard_id,auth_subject,vendor_id,active) VALUES($1,$2,$3,true)',[guardId,guardSubject,vendorId]);await owner.query('INSERT INTO mercury_guard.guard_login(guard_id,email) VALUES($1,$2)',[guardId,guardEmail]);await owner.query('INSERT INTO mercury_guard.admin_accounts(auth_subject,email,active) VALUES($1,$2,true)',[adminSubject,adminEmail]);
 directory=await openLocalGuardDirectory({config,mode:'postgres'});devices=new PostgresDeviceAssignments(directory.client);await devices.assign({assignmentId,guardId,vendorId,siteId,active:true,startsAt:Date.now()-1000,endsAt:Date.now()+3600000});
 // Avoid the production scheduler's global assignment scan/state in a fixture.
 devices.scheduledAfter=async()=>[];const store={ingest(){throw Error('Escalation-only fixture');},workerState:{cursor:()=>'',saveCursor:()=>{},finalized:()=>false,mark:()=>{}}};
 service=createLocalService({config,directory,devices,store,shiftLifecycle:new PostgresShiftLifecycle(devices),admin:new PostgresAdministration({devices}),escalations:new PostgresEscalations({devices})});origin=await service.start();
 const login=await fetch(origin+'/v1/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:adminEmail,password:adminPassword}),redirect:'error',signal:AbortSignal.timeout(10000)});assert.equal(login.status,200);adminToken=(await login.json()).access_token;
 for(const part of ['res/raw/','res/xml/','assets/','main-assets/'])mkdirSync(new URL(part,dir),{recursive:true});
 // Generate files in temporary paths first; track every replacement for exact
 // ownership-aware restoration when this process stops.
 const tempKey=new URL('tls-escalation-'+run+'.key',dir),tempCert=new URL('tls-escalation-'+run+'.pem',dir);
 try{execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',tempKey.pathname,'-out',tempCert.pathname,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost','-addext','extendedKeyUsage=serverAuth'],{stdio:'ignore'});generatedFile('tls-escalation-private.pem',readFileSync(tempKey));generatedFile('res/raw/https_fixture_ca.pem',readFileSync(tempCert));}finally{for(const file of [tempKey,tempCert])try{unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}}
 generatedFile('res/xml/https_test_network.xml','<network-security-config><base-config cleartextTrafficPermitted="false"/><domain-config cleartextTrafficPermitted="false"><domain>localhost</domain><trust-anchors><certificates src="@raw/https_fixture_ca"/></trust-anchors></domain-config></network-security-config>');
 const issuer=generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({type:'spki',format:'der'}).toString('base64url');generatedFile('assets/https-test-issuer.json',JSON.stringify({public_key_spki:issuer}));
 generatedFile('main-assets/guard-service.json',JSON.stringify({endpoint:'https://localhost:55444',issuer:'mercury-local',audience:'mercury-local',device_id:deviceId,issuer_keys:{'https-fixture':issuer}}));
 generatedFile('assets/escalation-test-fixture.json',JSON.stringify({fixture_type:'real_pg_auth_escalations',guard_id:guardId,vendor_id:vendorId,site_id:siteId,device_id:deviceId,assignment_id:assignmentId,email:guardEmail,password,test_nonce:nonce}));
 tls=createServer({key:readFileSync(new URL('tls-escalation-private.pem',dir)),cert:readFileSync(new URL('res/raw/https_fixture_ca.pem',dir)),minVersion:'TLSv1.2'},(req,res)=>{const task=handle(req,res);inflight.add(task);task.finally(()=>inflight.delete(task)).catch(()=>{});});tls.requestTimeout=15000;tls.headersTimeout=10000;
 await new Promise((resolve,reject)=>{tls.once('error',reject);tls.listen(55444,'127.0.0.1',resolve);});
 if(check){await selfCheck();await cleanup();}
 else{console.log('Real local PostgreSQL/Auth Android escalation HTTPS fixture ready on localhost:55444; debug-only resources generated.');await stopped;await cleanup();}
}catch(error){await cleanup();throw error;}
