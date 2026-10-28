// Disposable real local Auth + HTTP console fixture. No hosted destinations,
// contacts, notifications or real guard records are read or modified.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {generateKeyPairSync,randomBytes,randomUUID,sign,createHash} from 'node:crypto';
import {Client} from 'pg';
import {openLocalGuardDirectory} from '../local-directory-factory.mjs';
import {PostgresDeviceAssignments} from '../postgres-device-assignments.mjs';
import {PostgresAdministration} from '../postgres-administration.mjs';
import {PostgresEscalations} from '../postgres-escalations.mjs';
import {createLocalService} from '../local-service.mjs';
import {escalationProofMessage} from '../escalation-proof.mjs';
const check=process.argv.slice(2).join()==='--check';if(process.argv.length>2&&!check)throw Error('Only --check is supported');
const root=new URL('../../',import.meta.url),config=JSON.parse(readFileSync(new URL('supabase-start.log',root),'utf8').split('\n').findLast(l=>l.startsWith('{')&&l.includes('API_URL'))),dbUrl=new URL(config.DB_URL);
if(config.API_URL!=='http://127.0.0.1:55321'||dbUrl.hostname!=='127.0.0.1'||dbUrl.port!=='55322'||dbUrl.search||dbUrl.hash)throw Error('Own isolated local environment required');
const suffix=randomUUID(),prefix='escalation-test-'+suffix,guardId=prefix+'-guard',vendorId=prefix+'-vendor',siteId=prefix+'-site',deviceId=prefix+'-phone',id=randomUUID(),owner=new Client({connectionString:config.DB_URL});
const adminEmail=prefix+'-admin@example.invalid',guardEmail=prefix+'-guard@example.invalid',adminPassword=randomBytes(32).toString('base64url'),guardPassword=randomBytes(32).toString('base64url'),keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),spki=keys.publicKey.export({type:'spki',format:'der'}).toString('base64url'),thumb=createHash('sha256').update(Buffer.from(spki,'base64url')).digest('hex');
const privateFile=new URL('.local-backend/escalation-console-test.json',root),serviceHeaders={apikey:config.SERVICE_ROLE_KEY,authorization:'Bearer '+config.SERVICE_ROLE_KEY,'content-type':'application/json'},publicHeaders={apikey:config.PUBLISHABLE_KEY,'content-type':'application/json'};
let guardToken,adminSubject,guardSubject,directory,service,origin,devices,stopping=false,ownsPrivateFile=false,cleanupPromise;
const provider=(path,options)=>fetch(config.API_URL+'/auth/v1/'+path,{...options,redirect:'error',signal:AbortSignal.timeout(8000)});
const http=(path,token,body)=>fetch(origin+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(10000)});
async function user(email,password){const r=await provider('admin/users',{method:'POST',headers:serviceHeaders,body:JSON.stringify({email,password,email_confirm:true,user_metadata:{mercury_fixture_run:prefix}})});assert.equal(r.status,200);const u=await r.json();assert.match(u.id,/^[a-f0-9-]{36}$/);return u.id;}
async function proof(operation,hash){
 // The same production challenge store/authorizer is used. This fixture has no
 // assignment worker and seeds only this synthetic account's device challenge.
 const response=await http('/v1/device-challenge',guardToken,{device_id:deviceId});assert.equal(response.status,200);const c=await response.json(),message=escalationProofMessage({audience:c.audience,operation,requestId:c.request_id,challenge:c.challenge,thumbprint:thumb,payloadHash:hash});
 return {version:1,algorithm:'SHA256withECDSA',audience:c.audience,request_id:c.request_id,challenge:c.challenge,device_thumbprint:thumb,public_key_spki:spki,signature_der:sign('sha256',Buffer.from(message),keys.privateKey).toString('base64url')};
}
async function cleanup(){
 if(cleanupPromise)return cleanupPromise;stopping=true;
 cleanupPromise=(async()=>{const failures=[],attempt=async fn=>{try{await fn();}catch(error){failures.push(error);}};
  await attempt(async()=>service?.stop());await attempt(async()=>directory?.close());
  // Recover only a marked account from this exact random run if creation
  // committed but its HTTP response was lost before its ID reached this process.
  async function recover(email,subject){if(subject)return subject;const rows=(await owner.query("SELECT id FROM auth.users WHERE email=$1 AND raw_user_meta_data->>'mercury_fixture_run'=$2",[email,prefix])).rows;assert.ok(rows.length<=1);return rows[0]?.id;}
  await attempt(async()=>{adminSubject=await recover(adminEmail,adminSubject);});await attempt(async()=>{guardSubject=await recover(guardEmail,guardSubject);});
  if(guardSubject)await attempt(()=>owner.query('DELETE FROM mercury_guard.escalation_acknowledgements a USING mercury_guard.escalations e WHERE a.escalation_id=e.escalation_id AND e.escalation_id=$1 AND e.subject=$2 AND e.device_id=$3',[id,guardSubject,deviceId]));
  if(adminSubject)await attempt(()=>owner.query('DELETE FROM mercury_guard.admin_audit WHERE actor_subject=$1',[adminSubject]));
  if(guardSubject)await attempt(()=>owner.query('DELETE FROM mercury_guard.escalations WHERE escalation_id=$1 AND subject=$2 AND device_id=$3',[id,guardSubject,deviceId]));
  if(guardSubject)await attempt(()=>owner.query('DELETE FROM mercury_guard.device_challenges WHERE auth_subject=$1 AND device_id=$2',[guardSubject,deviceId]));
  await attempt(()=>owner.query('DELETE FROM mercury_guard.devices WHERE device_id=$1 AND thumbprint=$2',[deviceId,thumb]));await attempt(()=>owner.query('DELETE FROM mercury_guard.guard_login WHERE guard_id=$1 AND email=$2',[guardId,guardEmail]));await attempt(()=>owner.query('DELETE FROM mercury_guard.guards WHERE guard_id=$1 AND vendor_id=$2',[guardId,vendorId]));await attempt(()=>owner.query('DELETE FROM mercury_guard.vendors WHERE vendor_id=$1',[vendorId]));await attempt(()=>owner.query('DELETE FROM mercury_guard.sites WHERE site_id=$1',[siteId]));
  if(adminSubject)await attempt(()=>owner.query('DELETE FROM mercury_guard.admin_accounts WHERE auth_subject=$1 AND email=$2',[adminSubject,adminEmail]));
  const loginBucket='account:'+createHash('sha256').update('admin-login:'+adminEmail).digest('hex');await attempt(()=>owner.query('DELETE FROM mercury_guard.login_attempts WHERE bucket=$1',[loginBucket]));
  for(const subject of [guardSubject,adminSubject].filter(Boolean))await attempt(async()=>{const r=await provider('admin/users/'+subject,{method:'DELETE',headers:serviceHeaders});assert.equal(r.ok,true);});
  await attempt(async()=>{const remaining=(await owner.query(`SELECT
   (SELECT count(*) FROM mercury_guard.escalations WHERE escalation_id=$1) AS intents,
   (SELECT count(*) FROM mercury_guard.escalation_acknowledgements WHERE escalation_id=$1) AS acknowledgements,
   (SELECT count(*) FROM mercury_guard.admin_audit WHERE actor_subject=$2) AS audit,
   (SELECT count(*) FROM mercury_guard.admin_accounts WHERE auth_subject=$2) AS memberships,
   (SELECT count(*) FROM mercury_guard.device_challenges WHERE auth_subject=$3 AND device_id=$4) AS challenges,
   (SELECT count(*) FROM mercury_guard.devices WHERE device_id=$4) AS phones,
   (SELECT count(*) FROM mercury_guard.guard_login WHERE guard_id=$5) AS logins,
   (SELECT count(*) FROM mercury_guard.guards WHERE guard_id=$5) AS guards,
   (SELECT count(*) FROM mercury_guard.vendors WHERE vendor_id=$6) AS vendors,
   (SELECT count(*) FROM mercury_guard.sites WHERE site_id=$7) AS sites,
   (SELECT count(*) FROM mercury_guard.login_attempts WHERE bucket=$8) AS limiter,
   (SELECT count(*) FROM auth.users WHERE email=ANY($9::text[]) AND raw_user_meta_data->>'mercury_fixture_run'=$10) AS users,
   (SELECT count(*) FROM auth.sessions WHERE user_id=ANY($11::uuid[])) AS sessions`,[id,adminSubject??null,guardSubject??null,deviceId,guardId,vendorId,siteId,loginBucket,[adminEmail,guardEmail],prefix,[guardSubject,adminSubject].filter(Boolean)])).rows[0];assert.ok(Object.values(remaining).every(value=>Number(value)===0),'Exact synthetic cleanup left fixture rows');});
  if(ownsPrivateFile)await attempt(async()=>{try{const saved=JSON.parse(readFileSync(privateFile,'utf8'));assert.equal(saved.pid,process.pid);assert.equal(saved.escalationId,id);unlinkSync(privateFile);ownsPrivateFile=false;}catch(error){if(error.code!=='ENOENT')throw error;}});
  await attempt(()=>owner.end());if(failures.length)throw new AggregateError(failures,'Synthetic escalation cleanup could not be fully verified');console.log('PASS: exact synthetic escalation, acknowledgement/audit, device, roster, login bucket, Auth accounts and sessions removed; global limiter retained.');
 })();return cleanupPromise;
}
await owner.connect();
try{
 adminSubject=await user(adminEmail,adminPassword);guardSubject=await user(guardEmail,guardPassword);
 await owner.query('INSERT INTO mercury_guard.vendors(vendor_id,kind,active) VALUES($1,$2,true)',[vendorId,'individual']);await owner.query('INSERT INTO mercury_guard.sites(site_id,active) VALUES($1,true)',[siteId]);await owner.query('INSERT INTO mercury_guard.guards(guard_id,auth_subject,vendor_id,active) VALUES($1,$2,$3,true)',[guardId,guardSubject,vendorId]);await owner.query('INSERT INTO mercury_guard.guard_login(guard_id,email) VALUES($1,$2)',[guardId,guardEmail]);await owner.query('INSERT INTO mercury_guard.admin_accounts(auth_subject,email,active) VALUES($1,$2,true)',[adminSubject,adminEmail]);
 directory=await openLocalGuardDirectory({config,mode:'postgres'});devices=new PostgresDeviceAssignments(directory.client);await devices.enroll({deviceId,mode:'site',siteId,active:true,revoked:false,publicKeySpki:spki});
 const admin=new PostgresAdministration({devices}),escalations=new PostgresEscalations({devices});service=createLocalService({config,directory,admin,escalations,store:{ingest(){throw Error('Escalation fixture only');}}});origin=await service.start();
 const login=await provider('token?grant_type=password',{method:'POST',headers:publicHeaders,body:JSON.stringify({email:guardEmail,password:guardPassword})});assert.equal(login.status,200);guardToken=(await login.json()).access_token;
 const intent={version:1,escalation_id:id,guard_id:guardId,vendor_id:vendorId,assignment_id:null,occurred_at_ms:Date.now(),urgency:'urgent',description:'Synthetic test — assistance requested at the training entrance. No real emergency. Literal text: <script>untrusted()</script>',location:null},raw=Buffer.from(JSON.stringify(intent)),hash=createHash('sha256').update(raw).digest('hex');
 const receive=()=>proof('create',hash).then(p=>http('/v1/escalations',guardToken,{intent:raw.toString('base64url'),proof:p}));
 const response=await receive();assert.equal(response.status,200);const receipt=await response.json();assert.equal(receipt.status,'received_by_guard_service');assert.equal(receipt.intent_sha256,hash);assert.deepEqual(await (await receive()).json(),receipt);
 const statusRequest=async()=>{const raw=JSON.stringify({escalation_id:id}),p=await proof('status',createHash('sha256').update(raw).digest('hex'));return {escalation_id:id,proof:p};},status=async()=>{const r=await http('/v1/escalations/status',guardToken,await statusRequest());assert.equal(r.status,200);return r.json();};assert.equal((await status()).status,'received_by_guard_service');
 if(check){
  const r=await fetch(origin+'/v1/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:adminEmail,password:adminPassword}),redirect:'error'});assert.equal(r.status,200);const token=(await r.json()).access_token,catalog=await http('/v1/admin/catalog?kind=escalations',token);assert.equal(catalog.status,200);assert.ok((await catalog.json()).items.some(row=>row.escalation_id===id));
  const request={request_id:randomUUID(),action:'escalation.acknowledge',reason:'Synthetic operator received this request and is reviewing it.',payload:{escalation_id:id}},ack=await http('/v1/admin/actions',token,request);assert.equal(ack.status,200);const saved=await ack.json();assert.equal(saved.status,'applied');assert.deepEqual(await(await http('/v1/admin/actions',token,request)).json(),saved);assert.deepEqual(await(await http('/v1/admin/resolve',token,request)).json(),saved);const state=await status();assert.equal(state.status,'operator_acknowledged');assert.equal(state.acknowledgement.note,request.reason);
  // The same signed proof cannot be replayed, or attached to different bytes.
  const oneUse={intent:raw.toString('base64url'),proof:await proof('create',hash)};assert.equal((await http('/v1/escalations',guardToken,oneUse)).status,200);assert.equal((await http('/v1/escalations',guardToken,oneUse)).status,403);
  const changedRaw=Buffer.from(JSON.stringify({...intent,description:'Altered synthetic intent'})),mismatched={intent:changedRaw.toString('base64url'),proof:await proof('create',hash)};assert.equal((await http('/v1/escalations',guardToken,mismatched)).status,403);
  const spoofedRaw=Buffer.from(JSON.stringify({...intent,guard_id:guardId+'-other'}));assert.equal((await http('/v1/escalations',guardToken,{intent:spoofedRaw.toString('base64url'),proof:await proof('create',createHash('sha256').update(spoofedRaw).digest('hex'))})).status,403);
  assert.equal((await http('/v1/admin/catalog?kind=escalations',guardToken)).status,403);
  const guardStatus=await statusRequest();await owner.query('UPDATE mercury_guard.guards SET active=false WHERE guard_id=$1 AND auth_subject=$2',[guardId,guardSubject]);assert.equal((await http('/v1/escalations/status',guardToken,guardStatus)).status,403);await owner.query('UPDATE mercury_guard.guards SET active=true WHERE guard_id=$1 AND auth_subject=$2',[guardId,guardSubject]);assert.equal((await http('/v1/escalations/status',guardToken,guardStatus)).status,200);
  const siteStatus=await statusRequest();await owner.query('UPDATE mercury_guard.sites SET active=false WHERE site_id=$1',[siteId]);assert.equal((await http('/v1/escalations/status',guardToken,siteStatus)).status,403);await owner.query('UPDATE mercury_guard.sites SET active=true WHERE site_id=$1',[siteId]);assert.equal((await http('/v1/escalations/status',guardToken,siteStatus)).status,200);
  await owner.query('UPDATE mercury_guard.admin_accounts SET active=false WHERE auth_subject=$1 AND email=$2',[adminSubject,adminEmail]);for(const path of ['/v1/admin/actions','/v1/admin/resolve'])assert.equal((await http(path,token,request)).status,403);assert.equal((await http('/v1/admin/catalog?kind=escalations',token)).status,403);await owner.query('UPDATE mercury_guard.admin_accounts SET active=true WHERE auth_subject=$1 AND email=$2',[adminSubject,adminEmail]);assert.equal((await http('/v1/admin/catalog?kind=escalations',token)).status,200);
  const logout=await fetch(origin+'/v1/session/logout',{method:'POST',headers:{authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(10000)});assert.equal(logout.status,200);assert.deepEqual(await logout.json(),{status:'signed_out'});assert.equal((await http('/v1/admin/catalog?kind=escalations',token)).status,401);assert.equal((await http('/v1/admin/actions',token,request)).status,401);assert.equal((await status()).status,'operator_acknowledged');
  assert.equal((await owner.query('SELECT count(*)::int n FROM mercury_guard.escalations WHERE escalation_id=$1 AND subject=$2',[id,guardSubject])).rows[0].n,1);assert.equal((await owner.query('SELECT count(*)::int n FROM mercury_guard.escalation_acknowledgements WHERE escalation_id=$1',[id])).rows[0].n,1);
  console.log('PASS: real HTTP proof replay/alteration and guard-spoof denial, guard/site revocation with nonce rollback, operator membership/session denial and independent guard-session preservation.');
  console.log('PASS: real local Auth and HTTP escalation intake, exact retry, protected operator catalog, reviewed idempotent acknowledgement/resolution and originating-device status; no external notifications.');await cleanup();
 }else{
  mkdirSync(new URL('.local-backend/',root),{recursive:true,mode:0o700});writeFileSync(privateFile,JSON.stringify({origin,email:adminEmail,password:adminPassword,subject:adminSubject,guardSubject,escalationId:id,pid:process.pid}),{mode:0o600,flag:'wx'});ownsPrivateFile=true;console.log('Local escalation browser fixture: '+origin+'/admin/');console.log('Temporary credentials are private in .local-backend/escalation-console-test.json. Stop this process to remove its exact synthetic records.');
  await new Promise((resolve,reject)=>{const stop=()=>cleanup().then(resolve,reject);process.once('SIGTERM',stop);process.once('SIGINT',stop);});
 }
}catch(e){await cleanup();throw e;}
