// Real local Auth/PostgreSQL location acceptance behind loopback TLS. Every
// account, row and test mutation is confined to this random synthetic run.
import assert from 'node:assert/strict';
import {createServer} from 'node:https';
import {request as httpsRequest} from 'node:https';
import {generateKeyPairSync,randomUUID,randomBytes,createHash,sign,timingSafeEqual} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,unlinkSync,statSync,chmodSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {Client} from 'pg';
import {openLocalGuardDirectory} from '../local-directory-factory.mjs';
import {PostgresDeviceAssignments} from '../postgres-device-assignments.mjs';
import {PostgresAdministration} from '../postgres-administration.mjs';
import {PostgresLocationConsents} from '../postgres-location-consents.mjs';
import {PostgresShiftGrantIssuer} from '../postgres-shift-grant-issuer.mjs';
import {PostgresDurableIngest} from '../postgres-durable-ingest.mjs';
import {locationPolicySnapshot,locationDigest} from '../location-policy.mjs';
import {locationConsentProofMessage} from '../location-consent-input.mjs';
import {projectDashboardObservation} from '../dashboard-delivery.mjs';
import {PostgresShiftLifecycle} from '../postgres-shift-lifecycle.mjs';
import {createLocalService} from '../local-service.mjs';
import {parseEnrollmentKey} from '../enrollment-key.mjs';
import {strictJson} from '../verify-batch.mjs';

const check=process.argv.length===3&&process.argv[2]==='--check';
if(process.argv.length>2&&!check)throw Error('Only --check is supported');
if(process.env.MERCURY_HTTPS_LOCATION_FIXTURE!=='synthetic-only')throw Error('Explicit synthetic fixture mode required');
const root=new URL('../../',import.meta.url),dir=new URL('app/build/https-test/',root),privateFile=new URL('.local-backend/https-location-android-fixture.json',root);
const config=JSON.parse(readFileSync(new URL('supabase-start.log',root),'utf8').split('\n').findLast(line=>line.startsWith('{')&&line.includes('API_URL'))),dbUrl=new URL(config.DB_URL);
if(config.API_URL!=='http://127.0.0.1:55321'||!['postgres:','postgresql:'].includes(dbUrl.protocol)||dbUrl.hostname!=='127.0.0.1'||dbUrl.port!=='55322'||dbUrl.search||dbUrl.hash)throw Error('Own isolated local environment required');
const run=randomUUID(),prefix='https-location-'+run,guardId=prefix+'-guard',vendorId=prefix+'-vendor',siteId=prefix+'-site',deviceId=prefix+'-phone',assignmentId=prefix+'-shift';
const guardEmail=prefix+'-guard@example.invalid',adminEmail=prefix+'-admin@example.invalid',password='synthetic-password-only',adminPassword=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url');
const owner=new Client({connectionString:config.DB_URL,connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:12000}),serviceHeaders={apikey:config.SERVICE_ROLE_KEY,authorization:'Bearer '+config.SERVICE_ROLE_KEY,'content-type':'application/json'};
const notice='Synthetic location acceptance only. This is not an operational tracking notice. Collection is limited to this test shift and its short lease; withdrawal stops further location acceptance. No real position or alert is used.';
const policy=locationPolicySnapshot({version:1,revision:1,notice_revision:1,notice_text:notice,notice_sha256:locationDigest(notice),sample_interval_ms:1000,min_distance_m:0,max_fix_age_ms:20000,max_accuracy_m:30,max_capture_lease_ms:10000,geofence:{type:'circle',id:prefix+'-synthetic-circle',revision:1,latitude:0,longitude:0,radius_m:100}}).policy;
const generated=[],inflight=new Set();let adminSubject,guardSubject,directory,devices,service,origin,tls,issuer,enrolledKey,ownerConnected=false,ownsPrivateFile=false,cleanupPromise;
let signalStop;const stopped=new Promise(resolve=>{signalStop=resolve;});
// Catch termination during setup too: finish the bounded operation, then clean
// up, rather than leaving an account whose create response was in flight.
process.once('SIGTERM',signalStop);process.once('SIGINT',signalStop);
const lifetime=setTimeout(signalStop,45*60*1000);lifetime.unref();
const provider=(path,options)=>fetch(config.API_URL+'/auth/v1/'+path,{...options,redirect:'error',signal:AbortSignal.timeout(8000)});
function generatedFile(path,content){const target=new URL(path,dir);let before=null,mode;try{before=readFileSync(target);mode=statSync(target).mode&0o777;}catch(error){if(error.code!=='ENOENT')throw error;}const bytes=Buffer.from(content);writeFileSync(target,bytes,{mode:0o600});chmodSync(target,0o600);generated.push({target,before,bytes,mode});}
function json(res,status,body){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));}
async function boundedBody(req,max){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>max)throw Error('Bounded fixture request required');chunks.push(chunk);}return Buffer.concat(chunks);}
const exact=(body,keys)=>{if(!body||Array.isArray(body)||Object.keys(body).sort().join()!==[...keys].sort().join())throw Error('Exact fixture request required');};
async function createUser(email,userPassword){const response=await provider('admin/users',{method:'POST',headers:serviceHeaders,body:JSON.stringify({email,password:userPassword,email_confirm:true,user_metadata:{mercury_fixture_run:prefix}})});assert.equal(response.status,200);const user=await response.json();assert.match(user.id,/^[a-f0-9-]{36}$/);return user.id;}
async function enroll(publicKeySpki){
 const key=parseEnrollmentKey(publicKeySpki);
 const prior=await devices.device(deviceId);if(prior){if(prior.thumbprint!==key.thumbprint||prior.publicKeySpki!==publicKeySpki)throw Error('Fixture already enrolled with a different key');enrolledKey=key;return;}
 await devices.enroll({deviceId,mode:'site',siteId,active:true,revoked:false,publicKeySpki});
 enrolledKey=key;
}
async function receipts(){
 if(!enrolledKey)return {count:0,location_count:0,incident_count:0,last_location:null};
 const values=[enrolledKey.thumbprint,guardId,vendorId,assignmentId],where=' WHERE device=$1 AND guard_id=$2 AND vendor_id=$3 AND assignment_id=$4';
 const [counts,latest]=await Promise.all([owner.query("SELECT count(*) AS total,count(*) FILTER(WHERE body->'event'->>'kind'='location') AS locations,count(*) FILTER(WHERE body->'event'->>'kind'='incident') AS incidents FROM mercury_guard.ingested_events"+where,values),owner.query("SELECT body FROM mercury_guard.ingested_events"+where+" AND body->'event'->>'kind'='location' ORDER BY cursor DESC LIMIT 1",values)]);
 const count=counts.rows[0],last=latest.rows[0]?.body;
 const mapping={assignmentId,guardId,vendorId,siteId,dashboardShiftId:prefix+'-synthetic-upstream',destination:prefix+'-synthetic-receiver',revision:1,active:true};
 return {count:Number(count.total),location_count:Number(count.locations),incident_count:Number(count.incidents),last_location:last?projectDashboardObservation(last,mapping):null};
}
async function handle(req,res){
 try{
  if(req.headers.host!=='localhost:55446')return json(res,400,{error:'fixture_host_required'});
  const url=new URL(req.url,'https://localhost:55446');if(url.search||url.hash)return json(res,400,{error:'no_query'});
  const path=url.pathname;
  if(path==='/test/health'&&req.method==='GET'){return json(res,200,{status:'ready',fixture_type:'real_pg_auth_location'});}
  if(path.startsWith('/test/')){
   const supplied=req.headers['x-mercury-test-nonce'];if(typeof supplied!=='string'||Buffer.byteLength(supplied)!==Buffer.byteLength(nonce)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(nonce)))return json(res,403,{error:'test_nonce_required'});
   if(['/test/receipts','/test/location-receipts'].includes(path)&&req.method==='GET')return json(res,200,await receipts());
   if(req.method!=='POST'||req.headers['content-type']?.split(';')[0].trim()!=='application/json')return json(res,400,{error:'fixture_json_post_required'});
   const body=strictJson((await boundedBody(req,4096)).toString('utf8'));
   if(path==='/test/enroll'){exact(body,['public_key_spki']);await enroll(body.public_key_spki);return json(res,200,{});}
   if(['/test/receipts','/test/location-receipts'].includes(path)){exact(body,[]);return json(res,200,await receipts());}
   if(path==='/test/cancel-assignment'){exact(body,[]);assert.equal((await owner.query('UPDATE mercury_guard.assignments SET active=false WHERE assignment_id=$1 AND guard_id=$2 AND vendor_id=$3',[assignmentId,guardId,vendorId])).rowCount,1);return json(res,200,{});}
   return json(res,404,{error:'fixture_not_found'});
  }
  const allowed=new Map([['/v1/session/login','POST'],['/v1/session/logout','POST'],['/v1/me','GET'],['/v1/device-challenge','POST'],['/v1/assignments','POST'],['/v1/shift-transition','POST'],['/v1/shift-grant','POST'],['/v1/location-consents/challenge','POST'],['/v1/location-consents','POST'],['/v1/location-consents/status','POST'],['/v2/batches','POST']]);
  if(allowed.get(path)!==req.method)return json(res,404,{error:'fixture_not_found'});
  const raw=await boundedBody(req,path==='/v2/batches'?360000:8192);
  if(path==='/v1/session/login'){const body=strictJson(raw.toString('utf8'));if(body.guard_id!==guardId)return json(res,403,{error:'fixture_guard_required'});}
  else{
   const bearer=/^Bearer ([^\s]+)$/.exec(req.headers.authorization??'')?.[1];let subject;try{subject=strictJson(Buffer.from(bearer?.split('.')[1]??'','base64url').toString('utf8')).sub;}catch{}
   // This is only a confinement filter. The real service verifies Auth, its
   // current exact session and all guard/device authority independently.
   if(subject!==guardSubject)return json(res,401,{error:'fixture_session_required'});
   if(path==='/v1/device-challenge'&&strictJson(raw.toString('utf8')).device_id!==deviceId)return json(res,403,{error:'fixture_device_required'});
   if(path==='/v1/location-consents/challenge'&&strictJson(raw.toString('utf8')).device_id!==deviceId)return json(res,403,{error:'fixture_device_required'});
   if(['/v1/shift-transition','/v1/shift-grant'].includes(path)&&strictJson(raw.toString('utf8')).assignment_id!==assignmentId)return json(res,403,{error:'fixture_assignment_required'});
   if(path==='/v1/location-consents'){
    const body=strictJson(raw.toString('utf8')),intent=strictJson(Buffer.from(body.intent??'','base64url').toString('utf8'));
    if(intent.guard_id!==guardId||intent.vendor_id!==vendorId||intent.site_id!==siteId||intent.assignment_id!==assignmentId||intent.device_id!==deviceId||intent.device_thumbprint!==enrolledKey?.thumbprint)return json(res,403,{error:'fixture_consent_scope_required'});
   }
   if(path==='/v2/batches'){
    const body=strictJson(raw.toString('utf8')),payload=strictJson(Buffer.from(body.payload??'','base64url').toString('utf8'));
    if(payload.scope?.guard_id!==guardId||payload.scope.site_id!==siteId||payload.scope.assignment_id!==assignmentId||payload.scope.device_thumbprint!==enrolledKey?.thumbprint)return json(res,403,{error:'fixture_observation_scope_required'});
   }
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
  // Stop accepting clients and await accepted work before closing its database pool.
  await attempt(async()=>{await Promise.allSettled([...inflight]);});
  await attempt(async()=>service?.stop());await attempt(async()=>directory?.close());issuer?.close();
  if(ownerConnected){
   async function recover(email,subject){if(subject)return subject;const rows=(await owner.query("SELECT id FROM auth.users WHERE email=$1 AND raw_user_meta_data->>'mercury_fixture_run'=$2",[email,prefix])).rows;assert.ok(rows.length<=1);return rows[0]?.id;}
   await attempt(async()=>{adminSubject=await recover(adminEmail,adminSubject);});await attempt(async()=>{guardSubject=await recover(guardEmail,guardSubject);});
   let thumb=enrolledKey?.thumbprint;await attempt(async()=>{const d=(await owner.query('SELECT thumbprint FROM mercury_guard.devices WHERE device_id=$1 AND site_id=$2',[deviceId,siteId])).rows[0];thumb=d?.thumbprint??thumb;});
   if(thumb){
    for(const table of ['ingested_media','ingested_check_ins','ingested_checkpoints','ingest_receipts'])await attempt(()=>owner.query('DELETE FROM mercury_guard.'+table+' WHERE device=$1',[thumb]));
    await attempt(()=>owner.query('DELETE FROM mercury_guard.ingested_events WHERE device=$1 AND guard_id=$2 AND assignment_id=$3',[thumb,guardId,assignmentId]));
   }
   if(guardSubject){
    await attempt(()=>owner.query('DELETE FROM mercury_guard.location_consent_requests WHERE subject=$1',[guardSubject]));
    await attempt(()=>owner.query('DELETE FROM mercury_guard.location_consent_withdrawals WHERE subject=$1',[guardSubject]));
    await attempt(()=>owner.query('DELETE FROM mercury_guard.location_consents WHERE subject=$1 AND device_id=$2 AND assignment_id=$3',[guardSubject,deviceId,assignmentId]));
    await attempt(()=>owner.query('DELETE FROM mercury_guard.capture_grants WHERE subject=$1 AND assignment_id=$2',[guardSubject,assignmentId]));
    await attempt(()=>owner.query('DELETE FROM mercury_guard.device_challenges WHERE auth_subject=$1 AND device_id=$2',[guardSubject,deviceId]));
   }
   for(const table of ['shift_rejections','shift_transitions'])await attempt(()=>owner.query("DELETE FROM mercury_guard."+table+" WHERE receipt->'scope'->>'assignment_id'=$1 AND receipt->'scope'->>'guard_id'=$2",[assignmentId,guardId]));
   await attempt(()=>owner.query('DELETE FROM mercury_guard.shift_sessions WHERE assignment=$1 AND guard=$2 AND vendor=$3',[assignmentId,guardId,vendorId]));
   if(adminSubject)await attempt(()=>owner.query('DELETE FROM mercury_guard.admin_audit WHERE actor_subject=$1',[adminSubject]));
   await attempt(()=>owner.query('DELETE FROM mercury_guard.assignments WHERE assignment_id=$1 AND guard_id=$2 AND vendor_id=$3',[assignmentId,guardId,vendorId]));await attempt(()=>owner.query('DELETE FROM mercury_guard.devices WHERE device_id=$1 AND site_id=$2',[deviceId,siteId]));
   await attempt(()=>owner.query('DELETE FROM mercury_guard.guard_login WHERE guard_id=$1 AND email=$2',[guardId,guardEmail]));await attempt(()=>owner.query('DELETE FROM mercury_guard.guards WHERE guard_id=$1 AND vendor_id=$2',[guardId,vendorId]));await attempt(()=>owner.query('DELETE FROM mercury_guard.vendors WHERE vendor_id=$1',[vendorId]));await attempt(()=>owner.query('DELETE FROM mercury_guard.sites WHERE site_id=$1',[siteId]));
   if(adminSubject)await attempt(()=>owner.query('DELETE FROM mercury_guard.admin_accounts WHERE auth_subject=$1 AND email=$2',[adminSubject,adminEmail]));
   const buckets=['account:'+createHash('sha256').update(guardId).digest('hex'),'account:'+createHash('sha256').update('admin-login:'+adminEmail).digest('hex')];await attempt(()=>owner.query('DELETE FROM mercury_guard.login_attempts WHERE bucket=ANY($1::text[])',[buckets]));
   for(const subject of [guardSubject,adminSubject].filter(Boolean))await attempt(async()=>{const response=await provider('admin/users/'+subject,{method:'DELETE',headers:serviceHeaders});assert.equal(response.ok,true);});
   await attempt(async()=>{const remaining=(await owner.query(`SELECT
    (SELECT count(*) FROM mercury_guard.location_consents WHERE device_id=$1) AS consents,
    (SELECT count(*) FROM mercury_guard.location_consent_requests WHERE subject=$2) AS consent_requests,
    (SELECT count(*) FROM mercury_guard.location_consent_withdrawals WHERE subject=$2) AS withdrawals,
    (SELECT count(*) FROM mercury_guard.capture_grants WHERE assignment_id=$3) AS grants,
    (SELECT count(*) FROM mercury_guard.ingested_events WHERE assignment_id=$3) AS observations,
    (SELECT count(*) FROM mercury_guard.ingest_receipts WHERE device=$4) AS receipts,
    (SELECT count(*) FROM mercury_guard.ingested_media WHERE device=$4) AS media,
    (SELECT count(*) FROM mercury_guard.ingested_check_ins WHERE device=$4) AS checks,
    (SELECT count(*) FROM mercury_guard.ingested_checkpoints WHERE device=$4) AS checkpoints,
    (SELECT count(*) FROM mercury_guard.shift_sessions WHERE assignment=$3) AS shifts,
    (SELECT count(*) FROM mercury_guard.shift_transitions WHERE receipt->'scope'->>'assignment_id'=$3) AS transitions,
    (SELECT count(*) FROM mercury_guard.shift_rejections WHERE receipt->'scope'->>'assignment_id'=$3) AS rejections,
    (SELECT count(*) FROM mercury_guard.admin_audit WHERE actor_subject=$5) AS audit,
    (SELECT count(*) FROM mercury_guard.admin_accounts WHERE auth_subject=$5) AS memberships,
    (SELECT count(*) FROM mercury_guard.device_challenges WHERE auth_subject=$2 AND device_id=$1) AS challenges,
    (SELECT count(*) FROM mercury_guard.devices WHERE device_id=$1) AS devices,
    (SELECT count(*) FROM mercury_guard.assignments WHERE assignment_id=$3) AS assignments,
    (SELECT count(*) FROM mercury_guard.guard_login WHERE guard_id=$6) AS logins,
    (SELECT count(*) FROM mercury_guard.guards WHERE guard_id=$6) AS guards,
    (SELECT count(*) FROM mercury_guard.vendors WHERE vendor_id=$7) AS vendors,
    (SELECT count(*) FROM mercury_guard.sites WHERE site_id=$8) AS sites,
    (SELECT count(*) FROM mercury_guard.login_attempts WHERE bucket=ANY($9::text[])) AS limiter,
    (SELECT count(*) FROM auth.users WHERE email=ANY($10::text[]) AND raw_user_meta_data->>'mercury_fixture_run'=$11) AS users,
    (SELECT count(*) FROM auth.sessions WHERE user_id=ANY($12::uuid[])) AS sessions`,[deviceId,guardSubject??null,assignmentId,thumb??null,adminSubject??null,guardId,vendorId,siteId,buckets,[guardEmail,adminEmail],prefix,[guardSubject,adminSubject].filter(Boolean)])).rows[0];assert.ok(Object.values(remaining).every(value=>Number(value)===0),'Exact synthetic cleanup left rows');});
  }
  for(const {target,before,bytes,mode} of generated.reverse())await attempt(async()=>{let current;try{current=readFileSync(target);}catch(error){if(error.code==='ENOENT')return;throw error;}if(!current.equals(bytes))return;if(before===null)unlinkSync(target);else{writeFileSync(target,before);chmodSync(target,mode);}});
  if(ownsPrivateFile&&!failures.length)await attempt(async()=>{const saved=JSON.parse(readFileSync(privateFile,'utf8'));assert.equal(saved.pid,process.pid);assert.equal(saved.run,run);unlinkSync(privateFile);ownsPrivateFile=false;});
  await attempt(()=>owner.end());if(failures.length)throw new AggregateError(failures,'Synthetic HTTPS location cleanup could not be fully verified; private ownership file retained');
  console.log('PASS: exact HTTPS location consent/grant/observation/shift rows, Auth users/sessions and test assets cleaned; global limiter retained.');
 })();return cleanupPromise;
}
function tlsCall(path,{body,token,testNonce=nonce,hostname='localhost',method}={}){return new Promise((resolve,reject)=>{const bytes=body===undefined?null:Buffer.from(JSON.stringify(body));const request=httpsRequest({hostname,port:55446,path,method:method??(body===undefined?'GET':'POST'),ca:readFileSync(new URL('res/raw/https_fixture_ca.pem',dir)),headers:{...(token?{authorization:'Bearer '+token}:{}),...(testNonce?{'x-mercury-test-nonce':testNonce}:{}),...(bytes?{'content-type':'application/json','content-length':bytes.length}:{})}},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{try{resolve({status:response.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch(error){reject(error);}});});request.setTimeout(15000,()=>request.destroy(Error('TLS fixture timeout')));request.on('error',reject);request.end(bytes);});}
async function selfCheck(){
 assert.equal((await tlsCall('/test/health')).body.fixture_type,'real_pg_auth_location');await assert.rejects(tlsCall('/test/health',{hostname:'127.0.0.1'}),error=>error.code==='ERR_TLS_CERT_ALTNAME_INVALID');
 const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),spki=keys.publicKey.export({type:'spki',format:'der'}).toString('base64url'),thumb=locationDigest(Buffer.from(spki,'base64url'));
 assert.equal((await tlsCall('/test/enroll',{body:{public_key_spki:spki},testNonce:'wrong'})).status,403);assert.equal((await tlsCall('/test/enroll',{body:{public_key_spki:spki}})).status,200);assert.equal((await tlsCall('/test/enroll',{body:{public_key_spki:spki}})).status,200);
 const other=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({type:'spki',format:'der'}).toString('base64url');assert.equal((await tlsCall('/test/enroll',{body:{public_key_spki:other}})).status,400);
 const login=await tlsCall('/v1/session/login',{body:{guard_id:guardId,password}});assert.equal(login.status,200);const token=login.body.access_token;assert.equal((await tlsCall('/v1/me',{token})).body.guard_id,guardId);
 const enrollmentProof=async()=>{const challenge=await tlsCall('/v1/device-challenge',{token,body:{device_id:deviceId}});assert.equal(challenge.status,200);const c=challenge.body;return {version:1,algorithm:'SHA256withECDSA',audience:c.audience,request_id:c.request_id,challenge:c.challenge,device_thumbprint:thumb,public_key_spki:spki,signature_der:sign('sha256',Buffer.from(`mercury-enrollment-proof-v1\n${c.audience}\n${c.request_id}\n${c.challenge}\n${thumb}`),keys.privateKey).toString('base64url')};};
 const assignments=await tlsCall('/v1/assignments',{token,body:await enrollmentProof()});assert.equal(assignments.status,200);assert.equal(assignments.body.assignments.length,1);const assignment=assignments.body.assignments[0];assert.deepEqual(assignment.locationPolicy,policy);assert.equal(assignment.shift_state.state,'not_started');
 const transition=async(action,reason='')=>tlsCall('/v1/shift-transition',{token,body:{assignment_id:assignmentId,proof:await enrollmentProof(),transition:{request_id:randomUUID(),action,confirmed:true,reason}}});
 assert.equal((await transition('start')).body.status,'shift_recorded_local_only');
 const grant=async()=>{const response=await tlsCall('/v1/shift-grant',{token,body:{assignment_id:assignmentId,proof:await enrollmentProof()}});assert.equal(response.status,200);return {response:response.body,claims:JSON.parse(Buffer.from(response.body.payload,'base64url'))};};
 assert.equal((await grant()).claims.actions.includes('location'),false);
 const original={version:1,request_id:randomUUID(),consent_id:randomUUID(),action:'consent',guard_id:guardId,vendor_id:vendorId,site_id:siteId,assignment_id:assignmentId,device_id:deviceId,device_thumbprint:thumb,revocation_version:assignment.revocationVersion,policy_revision:policy.revision,policy_sha256:assignment.locationPolicySha256,notice_revision:policy.notice_revision,notice_sha256:policy.notice_sha256};
 const locationProof=async(operation,hash,consentId=null)=>{const challenge=await tlsCall('/v1/location-consents/challenge',{token,body:{device_id:deviceId,consent_id:consentId}});assert.equal(challenge.status,200);const c=challenge.body;return {version:1,algorithm:'SHA256withECDSA',audience:c.audience,request_id:c.request_id,challenge:c.challenge,device_thumbprint:thumb,public_key_spki:spki,signature_der:sign('sha256',Buffer.from(locationConsentProofMessage({audience:c.audience,operation,requestId:c.request_id,challenge:c.challenge,thumbprint:thumb,payloadHash:hash})),keys.privateKey).toString('base64url')};};
 const consent=async intent=>{const raw=Buffer.from(JSON.stringify(intent));return tlsCall('/v1/location-consents',{token,body:{intent:raw.toString('base64url'),proof:await locationProof(intent.action,locationDigest(raw),intent.action==='withdraw'?intent.consent_id:null)}});};
 const first=await consent(original);assert.equal(first.status,200);assert.equal(first.body.status,'consent_recorded');assert.deepEqual((await consent(original)).body,first.body);
 const authorized=await grant();assert.ok(authorized.claims.actions.includes('location'));assert.equal(authorized.claims.location.consent_id,original.consent_id);assert.ok(authorized.claims.expires_at_ms-authorized.claims.issued_at_ms<=policy.max_capture_lease_ms);
 const scope={guard_id:guardId,site_id:siteId,assignment_id:assignmentId,device_thumbprint:thumb,revocation_version:assignment.revocationVersion};let sequence=0;
 const batch=(kind,data,claims=authorized.claims)=>({batch_id:randomUUID(),schema_version:2,scope,events:[{event_id:randomUUID(),sequence:++sequence,at:claims.issued_at_ms,kind,data:{capture_grant_id:claims.grant_id,...data}}]});
 const encode=value=>{const payload=Buffer.from(JSON.stringify(value)).toString('base64url');return {version:2,algorithm:'SHA256withECDSA',audience:'mercury-local',device_thumbprint:thumb,public_key_spki:spki,payload,signature_der:sign('sha256',Buffer.from(`mercury-event-batch-v2\nmercury-local\n${thumb}\n${payload}`),keys.privateKey).toString('base64url')};};
 const sample={consent_id:original.consent_id,policy_revision:policy.revision,policy_sha256:original.policy_sha256,fix_at_ms:authorized.claims.issued_at_ms,latitude:0,longitude:0,accuracy_m:10,mock:false};
 const captured=batch('location',sample),signed=encode(captured),received=await tlsCall('/v2/batches',{token,body:signed});assert.equal(received.status,200);assert.deepEqual((await tlsCall('/v2/batches',{token,body:signed})).body,received.body);
 let records=(await tlsCall('/test/location-receipts')).body;assert.equal(records.location_count,1);assert.equal(records.last_location.observation.data.server_validation.geofence.state,'inside');assert.equal(records.last_location.observation.data.server_validation.consent_id,original.consent_id);
 assert.equal((await tlsCall('/v2/batches',{token,body:encode(batch('location',{...sample,mock:true}))})).status,400);
 const withdrawal={...original,request_id:randomUUID(),action:'withdraw'},withdrawn=await consent(withdrawal);assert.equal(withdrawn.status,200);assert.equal(withdrawn.body.status,'consent_withdrawn');assert.deepEqual((await consent(withdrawal)).body,withdrawn.body);
 const statusHash=locationDigest(JSON.stringify({consent_id:original.consent_id}));assert.equal((await tlsCall('/v1/location-consents/status',{token,body:{consent_id:original.consent_id,proof:await locationProof('status',statusHash,original.consent_id)}})).body.state,'withdrawn');
 assert.equal((await tlsCall('/v2/batches',{token,body:signed})).status,400);assert.equal((await tlsCall('/v2/batches',{token,body:encode(batch('location',sample))})).status,400);
 const ordinary=await grant();assert.equal(ordinary.claims.actions.includes('location'),false);assert.equal((await tlsCall('/v2/batches',{token,body:encode(batch('incident',{description:'Synthetic incident after location withdrawal; no real event.'},ordinary.claims))})).status,200);
 records=(await tlsCall('/test/receipts')).body;assert.equal(records.location_count,1);assert.equal(records.incident_count,1);assert.equal((await transition('end','Synthetic HTTPS location test complete')).body.status,'shift_recorded_local_only');
 const ended=await tlsCall('/v1/shift-grant',{token,body:{assignment_id:assignmentId,proof:await enrollmentProof()}});assert.equal(ended.status,400);
 const signedOut=await tlsCall('/v1/session/logout',{token,body:{}});assert.equal(signedOut.status,400); // Logout never accepts a body.
 assert.equal((await tlsCall('/v1/session/logout',{token,method:'POST'})).status,200);assert.equal((await tlsCall('/v1/me',{token})).status,401);
 console.log('PASS: trusted localhost TLS and nonce/device confinement; actual Auth/shift/consent/conditional signed grant/typed location and exact retry; withdrawal denies location while ordinary incident remains independent.');
}

try{
 mkdirSync(new URL('.local-backend/',root),{recursive:true,mode:0o700});writeFileSync(privateFile,JSON.stringify({pid:process.pid,run,guardId,vendorId,siteId,deviceId,assignmentId}),{mode:0o600,flag:'wx'});ownsPrivateFile=true;
 await owner.connect();ownerConnected=true;
 adminSubject=await createUser(adminEmail,adminPassword);guardSubject=await createUser(guardEmail,password);
 await owner.query('INSERT INTO mercury_guard.vendors(vendor_id,kind,active) VALUES($1,$2,true)',[vendorId,'individual']);await owner.query('INSERT INTO mercury_guard.sites(site_id,active) VALUES($1,true)',[siteId]);await owner.query('INSERT INTO mercury_guard.guards(guard_id,auth_subject,vendor_id,active) VALUES($1,$2,$3,true)',[guardId,guardSubject,vendorId]);await owner.query('INSERT INTO mercury_guard.guard_login(guard_id,email) VALUES($1,$2)',[guardId,guardEmail]);await owner.query('INSERT INTO mercury_guard.admin_accounts(auth_subject,email,active) VALUES($1,$2,true)',[adminSubject,adminEmail]);
 directory=await openLocalGuardDirectory({config,mode:'postgres'});devices=new PostgresDeviceAssignments(directory.client);await devices.assign({assignmentId,guardId,vendorId,siteId,active:true,startsAt:Date.now()-1000,endsAt:Date.now()+3600000,locationPolicy:policy});
 // Avoid the production scheduler's global assignment scan/state in a fixture.
 devices.scheduledAfter=async()=>[];const locationConsents=new PostgresLocationConsents({devices}),store=new PostgresDurableIngest(devices,{locationConsents});store.workerState={cursor:()=>'',saveCursor:()=>{},finalized:()=>false,mark:()=>{}};
 const signing=generateKeyPairSync('rsa',{modulusLength:2048});issuer=new PostgresShiftGrantIssuer({devices,locationConsents,privateKey:signing.privateKey,keyId:'https-fixture',issuer:'mercury-local',audience:'mercury-local'});
 service=createLocalService({config,directory,devices,store,grantIssuer:issuer,shiftLifecycle:new PostgresShiftLifecycle(devices),admin:new PostgresAdministration({devices}),locationConsents});origin=await service.start();
 writeFileSync(privateFile,JSON.stringify({pid:process.pid,run,origin,guardId,vendorId,siteId,deviceId,assignmentId,adminEmail,adminPassword}),{mode:0o600});
 for(const part of ['res/raw/','res/xml/','assets/','main-assets/'])mkdirSync(new URL(part,dir),{recursive:true});
 // Generate files in temporary paths first; track every replacement for exact
 // ownership-aware restoration when this process stops.
 const tempKey=new URL('tls-location-'+run+'.key',dir),tempCert=new URL('tls-location-'+run+'.pem',dir);
 try{execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',tempKey.pathname,'-out',tempCert.pathname,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost','-addext','extendedKeyUsage=serverAuth'],{stdio:'ignore'});generatedFile('tls-location-private.pem',readFileSync(tempKey));generatedFile('res/raw/https_fixture_ca.pem',readFileSync(tempCert));}finally{for(const file of [tempKey,tempCert])try{unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}}
 generatedFile('res/xml/https_test_network.xml','<network-security-config><base-config cleartextTrafficPermitted="false"/><domain-config cleartextTrafficPermitted="false"><domain>localhost</domain><trust-anchors><certificates src="@raw/https_fixture_ca"/></trust-anchors></domain-config></network-security-config>');
 const publicIssuer=issuer.publicKey();generatedFile('assets/https-test-issuer.json',JSON.stringify({public_key_spki:publicIssuer}));
 generatedFile('main-assets/guard-service.json',JSON.stringify({endpoint:'https://localhost:55446',issuer:'mercury-local',audience:'mercury-local',device_id:deviceId,issuer_keys:{'https-fixture':publicIssuer}}));
 generatedFile('assets/location-test-fixture.json',JSON.stringify({fixture_type:'real_pg_auth_location',guard_id:guardId,vendor_id:vendorId,site_id:siteId,device_id:deviceId,assignment_id:assignmentId,email:guardEmail,password,test_nonce:nonce}));
 tls=createServer({key:readFileSync(new URL('tls-location-private.pem',dir)),cert:readFileSync(new URL('res/raw/https_fixture_ca.pem',dir)),minVersion:'TLSv1.2'},(req,res)=>{const task=handle(req,res);inflight.add(task);task.finally(()=>inflight.delete(task)).catch(()=>{});});tls.requestTimeout=15000;tls.headersTimeout=10000;
 await new Promise((resolve,reject)=>{tls.once('error',reject);tls.listen(55446,'127.0.0.1',resolve);});
 if(check){await selfCheck();await cleanup();}
 else{console.log('Real local PostgreSQL/Auth Android location HTTPS fixture ready on localhost:55446; debug-only resources generated.');await stopped;await cleanup();}
}catch(error){await cleanup();throw error;}
