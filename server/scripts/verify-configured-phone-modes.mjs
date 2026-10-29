import {personalLoginMessage,personalRefreshMessage} from '../personal-session.mjs';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,sign,randomBytes,randomUUID} from 'node:crypto';
import {writeFileSync,readFileSync,unlinkSync,chmodSync} from 'node:fs';

// Called only by the actual LOCAL Auth/TLS fixture. This does not simulate a
// human biometric, persist a login, clock in, or modify hosted phone enrollment.
export async function verifyConfiguredPhoneModes({owner,devices,request,provider,serviceHeaders,identity,token,ownerPassword,prefix,privateDir}){
 assert.match(prefix,/^configured-real-auth-[a-f0-9-]{36}$/);
 const guardB=prefix+'-second-guard',email=guardB+'@example.invalid',password=randomBytes(32).toString('base64url');
 const siteA=prefix+'-site-a',siteB=prefix+'-site-b',sitePhone=prefix+'-site-phone',personalPhone=prefix+'-personal-phone';
 const assignments=[prefix+'-a-at-a',prefix+'-a-at-b',prefix+'-b-at-a',prefix+'-b-at-b'];
 const file=new URL('configured-phone-modes.json',privateDir);
 const pairs=[sitePhone,personalPhone].map(deviceId=>{
  const key=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),spki=key.publicKey.export({type:'spki',format:'der'});
  return {deviceId,key,spki:spki.toString('base64url'),thumb:createHash('sha256').update(spki).digest('hex')};
 });
 const minuteStarted=Math.floor(Date.now()/60000);
 const personalBuckets=()=>Array.from({length:Math.floor(Date.now()/60000)-minuteStarted+1},(_,i)=>'account:'+createHash('sha256').update('personal:'+personalPhone+':'+identity.subject+':'+(minuteStarted+i)).digest('hex'));
 let subjectB,tokenB,owned=false,completed=false,cleanupConfirmed=false;
 const record=()=>{
  const value={prefix,minuteStarted,guardB,email,siteA,siteB,sitePhone,personalPhone,assignments,ownerSubject:identity.subject,vendorId:identity.vendorId,deviceKeys:pairs.map(({deviceId,spki,thumb})=>({deviceId,spki,thumb})),...(subjectB?{subjectB}:{})};
  writeFileSync(file,JSON.stringify(value),{mode:0o600,...(!owned?{flag:'wx'}:{})});chmodSync(file,0o600);owned=true;
 };
 const proof=(pair,c)=>({version:1,algorithm:'SHA256withECDSA',audience:c.audience,request_id:c.request_id,challenge:c.challenge,device_thumbprint:pair.thumb,public_key_spki:pair.spki,signature_der:sign('sha256',Buffer.from(`mercury-enrollment-proof-v1\n${c.audience}\n${c.request_id}\n${c.challenge}\n${pair.thumb}`),pair.key.privateKey).toString('base64url')});
 async function challenge(t,deviceId){const r=await request('/v1/device-challenge',{token:t,body:{device_id:deviceId}});assert.equal(r.status,200);return r.data;}
 async function list(t,p){const r=await request('/v1/assignments',{token:t,body:p});assert.equal(r.status,200);return r.data.assignments.map(a=>a.assignmentId);}
 async function cleanup(){
  const failures=[],attempt=async fn=>{try{await fn();}catch(error){failures.push(error);}};
  if(!owned)return;
  await attempt(async()=>{
   const rows=(await owner.query("SELECT id FROM auth.users WHERE email=$1 AND raw_user_meta_data->>'mercury_fixture_run'=$2",[email,prefix])).rows;assert.ok(rows.length<=1);if(rows.length){if(subjectB)assert.equal(rows[0].id,subjectB);subjectB=rows[0].id;}
  });
  await attempt(async()=>{
   const saved=JSON.parse(readFileSync(file,'utf8'));assert.equal(saved.prefix,prefix);assert.equal(saved.ownerSubject,identity.subject);assert.equal(saved.email,email);
   for(const pair of pairs){const rows=(await owner.query('SELECT public_key_spki,thumbprint FROM mercury_guard.devices WHERE device_id=$1',[pair.deviceId])).rows;assert.ok(rows.length<=1);if(rows.length){assert.equal(rows[0].public_key_spki,pair.spki);assert.equal(rows[0].thumbprint,pair.thumb);}}
   const rows=(await owner.query('SELECT guard_id,auth_subject::text,vendor_id FROM mercury_guard.guards WHERE guard_id=$1',[guardB])).rows;assert.ok(rows.length<=1);if(rows.length){assert.equal(rows[0].auth_subject,subjectB);assert.equal(rows[0].vendor_id,identity.vendorId);}
  });
  // An ownership mismatch must preserve all rows for investigation.
  if(failures.length)throw new AggregateError(failures,'Phone-mode fixture ownership unconfirmed');
  await attempt(()=>owner.query('DELETE FROM mercury_guard.device_challenges WHERE device_id=ANY($1::text[])',[[sitePhone,personalPhone]]));
  await attempt(()=>owner.query('DELETE FROM mercury_guard.devices WHERE device_id=ANY($1::text[])',[[sitePhone,personalPhone]]));
  await attempt(()=>owner.query('DELETE FROM mercury_guard.assignments WHERE assignment_id=ANY($1::text[])',[assignments]));
  await attempt(()=>owner.query('DELETE FROM mercury_guard.sites WHERE site_id=ANY($1::text[])',[[siteA,siteB]]));
  await attempt(()=>owner.query('DELETE FROM mercury_guard.guard_login WHERE guard_id=$1 AND email=$2',[guardB,email]));
  await attempt(()=>owner.query('DELETE FROM mercury_guard.guards WHERE guard_id=$1 AND auth_subject=$2::uuid AND vendor_id=$3',[guardB,subjectB??null,identity.vendorId]));
  const bucket='account:'+createHash('sha256').update(guardB).digest('hex');
  await attempt(()=>owner.query('DELETE FROM mercury_guard.login_attempts WHERE bucket=ANY($1::text[])',[[bucket,...personalBuckets()]]));
  if(subjectB)await attempt(async()=>{
   const rows=(await owner.query("SELECT id FROM auth.users WHERE id=$1::uuid AND email=$2 AND raw_user_meta_data->>'mercury_fixture_run'=$3",[subjectB,email,prefix])).rows;
   if(rows.length){const r=await provider('admin/users/'+subjectB,{method:'DELETE',headers:serviceHeaders});assert.equal(r.ok,true);}
  });
  await attempt(async()=>{
   const row=(await owner.query(`SELECT
    (SELECT count(*) FROM mercury_guard.device_challenges WHERE device_id=ANY($1::text[])) AS challenges,
    (SELECT count(*) FROM mercury_guard.devices WHERE device_id=ANY($1::text[])) AS devices,
    (SELECT count(*) FROM mercury_guard.assignments WHERE assignment_id=ANY($2::text[])) AS assignments,
    (SELECT count(*) FROM mercury_guard.sites WHERE site_id=ANY($3::text[])) AS sites,
    (SELECT count(*) FROM mercury_guard.guard_login WHERE guard_id=$4) AS logins,
    (SELECT count(*) FROM mercury_guard.guards WHERE guard_id=$4) AS guards,
    (SELECT count(*) FROM mercury_guard.login_attempts WHERE bucket=$5 OR bucket=ANY($9::text[])) AS account_limiter,
    (SELECT count(*) FROM auth.users WHERE email=$6 AND raw_user_meta_data->>'mercury_fixture_run'=$7) AS users,
    (SELECT count(*) FROM auth.sessions WHERE user_id=$8::uuid) AS sessions`,[[sitePhone,personalPhone],assignments,[siteA,siteB],guardB,bucket,email,prefix,subjectB??null,personalBuckets()])).rows[0];
   assert.ok(Object.values(row).every(n=>Number(n)===0));
  });
  if(failures.length)throw new AggregateError(failures,'Exact phone-mode fixture cleanup unconfirmed');
  const saved=JSON.parse(readFileSync(file,'utf8'));assert.equal(saved.prefix,prefix);unlinkSync(file);owned=false;cleanupConfirmed=true;tokenB=null;
 }
 try{
  record();assert.equal((await owner.query('SELECT count(*)::int n FROM mercury_guard.devices WHERE device_id=ANY($1::text[])',[[sitePhone,personalPhone]])).rows[0].n,0);
  const created=await provider('admin/users',{method:'POST',headers:serviceHeaders,body:JSON.stringify({email,password,email_confirm:true,user_metadata:{mercury_fixture_run:prefix}})});assert.equal(created.status,200);
  const user=await created.json();assert.equal(user.email,email);assert.equal(user.user_metadata?.mercury_fixture_run,prefix);assert.match(user.id,/^[a-f0-9-]{36}$/i);subjectB=user.id;assert.notEqual(subjectB,identity.subject);record();
  await owner.query('INSERT INTO mercury_guard.guards(guard_id,auth_subject,vendor_id,active) VALUES($1,$2,$3,true)',[guardB,subjectB,identity.vendorId]);
  await owner.query('INSERT INTO mercury_guard.guard_login(guard_id,email) VALUES($1,$2)',[guardB,email]);
  await owner.query('INSERT INTO mercury_guard.sites(site_id,active) VALUES($1,true),($2,true)',[siteA,siteB]);
  await devices.enroll({deviceId:sitePhone,mode:'site',siteId:siteA,active:true,revoked:false,publicKeySpki:pairs[0].spki});
  await devices.enroll({deviceId:personalPhone,mode:'personal',guardId:identity.guardId,active:true,revoked:false,publicKeySpki:pairs[1].spki});
  const now=Date.now();
  for(const [i,g,s] of [[0,identity.guardId,siteA],[1,identity.guardId,siteB],[2,guardB,siteA],[3,guardB,siteB]])await devices.assign({assignmentId:assignments[i],guardId:g,vendorId:identity.vendorId,siteId:s,active:true,startsAt:now-1000,endsAt:now+600000});
  const login=await request('/v1/session/login',{body:{guard_id:guardB,password}});assert.equal(login.status,200);assert.deepEqual(Object.keys(login.data).sort(),['access_token','expires_at','server_time_ms']);tokenB=login.data.access_token;
  const profile=await request('/v1/me',{token:tokenB});assert.equal(profile.status,200);assert.equal(profile.data.auth_subject,subjectB);assert.equal(profile.data.guard_id,guardB);assert.equal(profile.data.vendor_id,identity.vendorId);
  assert.equal((await request('/v1/admin/me',{token:tokenB})).status,403);
  const sessionB=JSON.parse(Buffer.from(tokenB.split('.')[1],'base64url'));assert.equal((await owner.query('SELECT EXISTS(SELECT 1 FROM auth.sessions WHERE id=$1::uuid AND user_id=$2::uuid) AS active',[sessionB.session_id,subjectB])).rows[0].active,true);
  assert.equal((await request('/v1/device-challenge',{body:{device_id:sitePhone,biometric_verified:true}})).status,401);
  // A site key does not identify the guard. Same-company subjects receive only
  // their own assignments, narrowed to the approved site, even concurrently.
  const [a,b]=await Promise.all([challenge(token,sitePhone),challenge(tokenB,sitePhone)]),proofA=proof(pairs[0],a),proofB=proof(pairs[0],b);
  assert.equal((await request('/v1/assignments',{token:tokenB,body:proofA})).status,400);
  assert.deepEqual(await list(token,proofA),[assignments[0]]);assert.deepEqual(await list(tokenB,proofB),[assignments[2]]);
  assert.equal((await request('/v1/assignments',{token,body:proofA})).status,400);
  assert.equal((await request('/v1/device-challenge',{token,body:{device_id:sitePhone,guard_id:guardB}})).status,400);
  assert.equal((await request('/v1/device-challenge',{token,body:{device_id:sitePhone,mode:'personal'}})).status,400);
  assert.equal((await request('/v1/device-challenge',{token,body:{device_id:sitePhone,biometric_verified:true}})).status,400);
  assert.equal((await request('/v1/shift-grant',{token,body:{assignment_id:assignments[0],proof:proof(pairs[0],await challenge(token,sitePhone))}})).status,400);
  // One personal enrollment follows its bound guard across approved sites.
  assert.deepEqual(await list(token,proof(pairs[1],await challenge(token,personalPhone))),assignments.slice(0,2));
  assert.equal((await request('/v1/device-challenge',{token:tokenB,body:{device_id:personalPhone}})).status,400);
  const wrongKeyChallenge=await challenge(token,sitePhone),wrongProof=proof(pairs[0],wrongKeyChallenge);const changed=Buffer.from(wrongProof.signature_der,'base64url');changed[changed.length-1]^=1;
  assert.equal((await request('/v1/assignments',{token,body:{...wrongProof,signature_der:changed.toString('base64url')}})).status,400);
  assert.deepEqual(await list(token,wrongProof),[assignments[0]]);
  // Site deactivation blocks that shared phone and excludes only that site
  // from a personal device; it cannot silently retarget the site phone.
  const beforeDisabled=proof(pairs[0],await challenge(token,sitePhone));await owner.query('UPDATE mercury_guard.sites SET active=false WHERE site_id=$1',[siteA]);
  assert.equal((await request('/v1/assignments',{token,body:beforeDisabled})).status,400);
  assert.equal((await request('/v1/device-challenge',{token:tokenB,body:{device_id:sitePhone}})).status,400);
  assert.deepEqual(await list(token,proof(pairs[1],await challenge(token,personalPhone))),[assignments[1]]);
  await owner.query('UPDATE mercury_guard.sites SET active=true WHERE site_id=$1',[siteA]);
  // Actual provider refresh with one personal installation. A site key, a
  // company peer, a spoofed biometric flag and an unbound token cannot opt in.
  const loginProof=(pair,guard)=>{const issued_at_ms=Date.now(),request_id=randomUUID();return {issued_at_ms,request_id,thumbprint:pair.thumb,signature_der:sign('sha256',Buffer.from(personalLoginMessage(devices.audience,guard,pair.deviceId,issued_at_ms,request_id,pair.thumb)),pair.key.privateKey).toString('base64url')};};
  const personalLogin=(pair,guard,pw,extra={})=>request('/v1/session/personal/login',{body:{guard_id:guard,password:pw,device_id:pair.deviceId,proof:loginProof(pair,guard),...extra}});
  assert.equal((await personalLogin(pairs[0],identity.guardId,ownerPassword)).status,401);
  assert.equal((await personalLogin(pairs[1],guardB,password)).status,401);
  assert.equal((await personalLogin(pairs[1],identity.guardId,ownerPassword,{biometric_verified:true})).status,400);
  const first=await personalLogin(pairs[1],identity.guardId,ownerPassword);assert.equal(first.status,200);
  assert.deepEqual(Object.keys(first.data).sort(),['access_token','expires_at','permit','refresh_token','server_time_ms']);
  const firstClaims=JSON.parse(Buffer.from(first.data.access_token.split('.')[1],'base64url'));
  const makeRefresh=async credentials=>{
   const c=await request('/v1/session/personal/challenge',{body:{permit:credentials.permit}});assert.equal(c.status,200);
   return {permit:credentials.permit,refresh_token:credentials.refresh_token,proof:{request_id:c.data.request_id,challenge:c.data.challenge,signature_der:sign('sha256',Buffer.from(personalRefreshMessage(devices.audience,c.data.request_id,c.data.challenge,pairs[1].thumb,credentials.permit,credentials.refresh_token)),pairs[1].key.privateKey).toString('base64url')}};
  };
  const original=await makeRefresh(first.data),renewed=await request('/v1/session/personal/refresh',{body:original});assert.equal(renewed.status,200);
  assert.equal(JSON.parse(Buffer.from(renewed.data.access_token.split('.')[1],'base64url')).session_id,firstClaims.session_id);
  assert.equal((await request('/v1/session/personal/refresh',{body:original})).status,401);
  // Simulate a lost response, retaining the exact original sealed credential.
  // After the normal 10-second reuse interval, Auth's parent recovery still works.
  await new Promise(resolve=>setTimeout(resolve,11000));
  const recovered=await request('/v1/session/personal/refresh',{body:await makeRefresh(first.data)});assert.equal(recovered.status,200);
  assert.equal(JSON.parse(Buffer.from(recovered.data.access_token.split('.')[1],'base64url')).session_id,firstClaims.session_id);
  const bound=JSON.parse(Buffer.from(recovered.data.permit.payload,'base64url'));
  assert.equal(bound.expires_at_ms,JSON.parse(Buffer.from(first.data.permit.payload,'base64url')).expires_at_ms);
  const altered=await makeRefresh(recovered.data);altered.refresh_token+='x';assert.equal((await request('/v1/session/personal/refresh',{body:altered})).status,401);
  assert.equal((await request('/v1/me',{token:recovered.data.access_token})).status,200);
  const pendingLogout=await makeRefresh(recovered.data);
  assert.equal((await request('/v1/session/logout',{token:recovered.data.access_token,method:'POST'})).status,200);
  assert.equal((await request('/v1/session/personal/refresh',{body:pendingLogout})).status,401);
  assert.equal((await request('/v1/session/personal/challenge',{body:{permit:recovered.data.permit}})).status,401);
  assert.equal((await request('/v1/me',{token})).status,200);
  const forRevoke=await personalLogin(pairs[1],identity.guardId,ownerPassword);assert.equal(forRevoke.status,200);
  const beforeRevoked=proof(pairs[1],await challenge(token,personalPhone));await devices.revoke(personalPhone);
  assert.equal((await request('/v1/assignments',{token,body:beforeRevoked})).status,400);
  assert.equal((await request('/v1/device-challenge',{token,body:{device_id:personalPhone}})).status,400);
  assert.equal((await request('/v1/session/personal/challenge',{body:{permit:forRevoke.data.permit}})).status,401);
  assert.deepEqual(await list(tokenB,proof(pairs[0],await challenge(tokenB,sitePhone))),[assignments[2]]);
  const beforeLogout=proof(pairs[0],await challenge(tokenB,sitePhone));
  assert.deepEqual(await request('/v1/session/logout',{token:tokenB,method:'POST'}),{status:200,data:{status:'signed_out'}});
  assert.equal((await request('/v1/assignments',{token:tokenB,body:beforeLogout})).status,401);
  assert.equal((await request('/v1/device-challenge',{token:tokenB,body:{device_id:sitePhone}})).status,401);
  assert.deepEqual(await list(token,proof(pairs[0],await challenge(token,sitePhone))),[assignments[0]]);
  const attendance=(await owner.query('SELECT count(*)::int n FROM mercury_guard.shift_sessions WHERE assignment=ANY($1::text[])',[assignments])).rows[0].n;assert.equal(attendance,0);
  completed=true;
 }finally{await cleanup();}
 assert.ok(completed&&cleanupConfirmed);
 return {status:'passed',provider:'actual_local_supabase_auth',distinct_individual_accounts:2,shared_company_vendor:true,site_phone_per_guard_and_site_isolation:true,concurrent_shared_phone_challenges:true,personal_phone_exact_guard_only:true,personal_phone_authorized_multiple_sites:true,cross_guard_proof_and_payload_spoof_denied:true,client_biometric_flag_not_identity:true,pre_clock_in_capture_grant_denied:true,altered_signature_and_replay_denied:true,inactive_site_and_revoked_personal_device_denied:true,real_provider_logout_stops_original_guard_only:true,attendance_rows_created:0,exact_cleanup:'confirmed',phone_actions:0,personal_return_protocol:'actual_refresh_rotation_parent_recovery_and_revocation_passed',human_biometric:'not_simulated_or_claimed'};
}
