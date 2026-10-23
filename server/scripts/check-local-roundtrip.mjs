import {ShiftLifecycle} from '../shift-lifecycle.mjs';
import {ShiftGrantIssuer} from '../shift-grant-issuer.mjs';
import {LocalDeviceAssignments} from '../local-device-assignments.mjs';
import {LocalGuardDirectory} from '../local-guard-directory.mjs';
// Local-only smoke check. Reads startup credentials without printing them.
import {createSupabaseSessionVerifier} from '../supabase-session.mjs';
import {readFileSync} from 'node:fs';
import {createLocalService} from '../local-service.mjs';
import {DurableIngest} from '../durable-ingest.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,generateKeyPairSync,sign,verify,randomUUID,randomBytes} from 'node:crypto';
const lines=readFileSync(new URL('../../supabase-start.log',import.meta.url),'utf8').trim().split('\n');
const config=JSON.parse(lines.findLast(line=>line.startsWith('{')&&line.includes('API_URL')));
if(config.API_URL!=='http://127.0.0.1:55321') throw Error('Local environment required');
const base=config.API_URL+'/auth/v1';
const admin={apikey:config.SERVICE_ROLE_KEY,authorization:'Bearer '+config.SERVICE_ROLE_KEY,'content-type':'application/json'};
const email=`mercury-test-${randomUUID()}@example.invalid`,password=randomBytes(32).toString('hex');
let id;
async function call(path,options){const r=await fetch(base+path,options);if(!r.ok)throw Error(`Local auth check failed: ${r.status}`);return r.json();}
try {
 const user=await call('/admin/users',{method:'POST',headers:admin,body:JSON.stringify({email,password,email_confirm:true})});id=user.id;
 if(!id)throw Error('Missing synthetic user ID');
 const session=await call('/token?grant_type=password',{method:'POST',headers:{apikey:config.ANON_KEY,'content-type':'application/json'},body:JSON.stringify({email,password})});
 const verifySession=createSupabaseSessionVerifier({url:config.API_URL,publishableKey:config.PUBLISHABLE_KEY,allowLocal:true});
 const checked=await verifySession(session.access_token);
 if(checked?.subject!==id)throw Error('Session provider failed');
 if(await verifySession('invalid')!==null)throw Error('Malformed token accepted');
 const verified=await call('/user',{headers:{apikey:config.ANON_KEY,authorization:'Bearer '+session.access_token}});
 if(verified.id!==id)throw Error('Identity mismatch');
 const invalid=await fetch(base+'/user',{headers:{apikey:config.ANON_KEY,authorization:'Bearer invalid'}});
 if(![401,403].includes(invalid.status))throw Error('Unexpected invalid-token status: '+invalid.status);

 const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const spki=publicKey.export({type:'spki',format:'der'}),thumbprint=createHash('sha256').update(spki).digest('hex');
 const now=Math.floor(Date.now()/1000);
 const authority={subject:id,active:true,enrolled:true,revoked:false,audience:'mercury-local',guard_id:'synthetic-guard',site_id:'synthetic-site',assignment_id:'synthetic-shift',thumbprint,public_key_spki:spki.toString('base64url'),revocation_version:1,not_before:now-1,expires_at:now+600,allowed_kinds:['incident']};
 const scope={guard_id:authority.guard_id,site_id:authority.site_id,assignment_id:authority.assignment_id,device_thumbprint:thumbprint,revocation_version:1};
 const batch={batch_id:randomUUID(),schema_version:2,scope,events:[{event_id:randomUUID(),sequence:1,at:Date.now(),kind:'incident',data:{note:'Synthetic only'}}]};
 const payload=Buffer.from(JSON.stringify(batch)).toString('base64url');
 let proof=JSON.stringify({version:2,algorithm:'SHA256withECDSA',audience:'mercury-local',device_thumbprint:thumbprint,public_key_spki:authority.public_key_spki,payload,signature_der:sign('sha256',Buffer.from(`mercury-event-batch-v2\nmercury-local\n${thumbprint}\n${payload}`),privateKey).toString('base64url')});
 const dir=mkdtempSync(join(tmpdir(),'mercury-network-'));const directory=new LocalGuardDirectory(join(dir,'directory.sqlite'));
 directory.addVendor({vendorId:'synthetic-vendor',kind:'company',active:true});
 directory.addGuard({guardId:'synthetic-guard',authSubject:id,vendorId:'synthetic-vendor',active:true});
 directory.setLoginEmail('synthetic-guard',email);
 const devices=new LocalDeviceAssignments(join(dir,'devices.sqlite'));
 const issuerKeys=generateKeyPairSync('rsa',{modulusLength:2048});
 const grantIssuer=new ShiftGrantIssuer({path:join(dir,'grants.sqlite'),privateKey:issuerKeys.privateKey,keyId:'local-v1',issuer:'mercury-local',audience:'mercury-local'});
 devices.enroll({deviceId:'synthetic-phone',mode:'site',siteId:'synthetic-site',active:true,revoked:false,publicKeySpki:authority.public_key_spki});
 devices.assign({assignmentId:'synthetic-shift',guardId:'synthetic-guard',vendorId:'synthetic-vendor',siteId:'synthetic-site',active:true,startsAt:Date.now()-1000,endsAt:Date.now()+600000});
 let shiftLifecycle=new ShiftLifecycle(join(dir,'shifts.sqlite'));
 let store=new DurableIngest(join(dir,'events.sqlite')),service=createLocalService({config,store,directory,devices,grantIssuer,shiftLifecycle}),started=false;
 try {
  let origin=await service.start();started=true;
  const loginResponse=await fetch(origin+'/v1/session/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({guard_id:'synthetic-guard',password})});
  if(loginResponse.status!==200)throw Error('Guard ID login failed');
  const loggedIn=await loginResponse.json();
  if((await verifySession(loggedIn.access_token))?.subject!==id||'refresh_token' in loggedIn)throw Error('Invalid guard session');
  console.log('PASS: guard ID/password login with verified identity and no refresh token');
  const profile=()=>fetch(origin+'/v1/me',{headers:{authorization:'Bearer '+session.access_token}});
  let me=await profile();if(me.status!==200||JSON.stringify(await me.json())!==JSON.stringify({guard_id:'synthetic-guard',vendor_id:'synthetic-vendor'}))throw Error('Guard profile failed');
  directory.setGuardActive('synthetic-guard',false);if((await profile()).status!==403)throw Error('Disabled guard accepted');
  directory.setGuardActive('synthetic-guard',true);
  console.log('PASS: authenticated guard profile and disabled guard denial');
  const post=(path,body)=>fetch(origin+path,{method:'POST',headers:{authorization:'Bearer '+session.access_token,'content-type':'application/json'},body:JSON.stringify(body)});
  const challengeResponse=await post('/v1/device-challenge',{device_id:'synthetic-phone'});
  if(challengeResponse.status!==200)throw Error('Device challenge failed');
  const c=await challengeResponse.json();
  const deviceProof={version:1,algorithm:'SHA256withECDSA',audience:c.audience,request_id:c.request_id,challenge:c.challenge,device_thumbprint:thumbprint,public_key_spki:authority.public_key_spki,
   signature_der:sign('sha256',Buffer.from(`mercury-enrollment-proof-v1\n${c.audience}\n${c.request_id}\n${c.challenge}\n${thumbprint}`),privateKey).toString('base64url')};
  const assignmentResponse=await post('/v1/assignments',deviceProof);
  if(assignmentResponse.status!==200)throw Error('Assignment request failed');
  const assigned=await assignmentResponse.json();if(assigned.assignments.length!==1||assigned.assignments[0].assignmentId!=='synthetic-shift')throw Error('Assignment scope incorrect');
  if((await post('/v1/assignments',deviceProof)).status!==400)throw Error('Device proof replay accepted');
  console.log('PASS: enrolled device proof + scoped assignment delivery + replay denial');
  const freshProof=async()=>{
   const challenge=await post('/v1/device-challenge',{device_id:'synthetic-phone'});if(challenge.status!==200)throw Error('Challenge unavailable');const c=await challenge.json();
   return {...deviceProof,request_id:c.request_id,challenge:c.challenge,signature_der:sign('sha256',Buffer.from(`mercury-enrollment-proof-v1\n${c.audience}\n${c.request_id}\n${c.challenge}\n${thumbprint}`),privateKey).toString('base64url')};
  };
  const transition=async request=>post('/v1/shift-transition',{assignment_id:'synthetic-shift',transition:request,proof:await freshProof()});
  if(assigned.assignments[0].shift_state.state!=='not_started')throw Error('Unexpected shift state');
  if((await post('/v1/shift-grant',{assignment_id:'synthetic-shift',proof:await freshProof()})).status!==400)throw Error('Unstarted shift received grant');
  const startRequest={request_id:randomUUID(),action:'start',reason:'',confirmed:true};
  const startedResponse=await transition(startRequest);if(startedResponse.status!==200)throw Error('Clock-in failed');const startReceipt=await startedResponse.json();
  if(JSON.stringify(await (await transition(startRequest)).json())!==JSON.stringify(startReceipt))throw Error('Clock-in retry changed time');
  console.log('PASS: confirmed clock-in, exact retry and pre-start grant denial');
  const grantChallenge=await post('/v1/device-challenge',{device_id:'synthetic-phone'});
  const gc=await grantChallenge.json();
  const gp={...deviceProof,request_id:gc.request_id,challenge:gc.challenge,signature_der:sign('sha256',Buffer.from(`mercury-enrollment-proof-v1\n${gc.audience}\n${gc.request_id}\n${gc.challenge}\n${thumbprint}`),privateKey).toString('base64url')};
  const grantResponse=await post('/v1/shift-grant',{assignment_id:'synthetic-shift',proof:gp});
  if(grantResponse.status!==200)throw Error('Shift grant issuance failed');
  const grant=await grantResponse.json(),claims=JSON.parse(Buffer.from(grant.payload,'base64url'));
  if(!verify('sha256',Buffer.from(`mercury-shift-grant-v1.${grant.key_id}.${grant.payload}`),issuerKeys.publicKey,Buffer.from(grant.signature,'base64url'))||claims.guard_id!=='synthetic-guard'||claims.device_thumbprint!==thumbprint||claims.expires_at_ms-claims.issued_at_ms>900000)throw Error('Invalid issued grant');
  if((await post('/v1/shift-grant',{assignment_id:'synthetic-shift',proof:gp})).status!==400)throw Error('Grant proof replay accepted');
  console.log('PASS: authenticated shift grant issuance, RSA signature and replay denial');
  batch.events[0].data.capture_grant_id=claims.grant_id;
  batch.events[0].at=grant.server_time_ms;
  const authorizedPayload=Buffer.from(JSON.stringify(batch)).toString('base64url');
  proof=JSON.stringify({version:2,algorithm:'SHA256withECDSA',audience:'mercury-local',device_thumbprint:thumbprint,public_key_spki:authority.public_key_spki,payload:authorizedPayload,signature_der:sign('sha256',Buffer.from(`mercury-event-batch-v2\nmercury-local\n${thumbprint}\n${authorizedPayload}`),privateKey).toString('base64url')});



  const send=()=>fetch(origin+'/v2/batches',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+session.access_token},body:proof});
  let response=await send();if(response.status!==200)throw Error('Signed network ingestion failed: '+response.status);
  const receipt=await response.json();if(store.count()!==1)throw Error('Missing event');
  directory.setGuardActive('synthetic-guard',false);if((await send()).status!==401)throw Error('Disabled guard uploaded');
  directory.setGuardActive('synthetic-guard',true);
  console.log('PASS: disabled roster identity denies batch retries');
  directory.setVendorActive('synthetic-vendor',false);
  if((await profile()).status!==403)throw Error('Suspended vendor retained authenticated profile');
  if((await send()).status!==401)throw Error('Suspended vendor uploaded with existing grant');
  if((await post('/v1/device-challenge',{device_id:'synthetic-phone'})).status!==403)throw Error('Suspended vendor requested device challenge');
  const suspendedLogin=await fetch(origin+'/v1/session/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({guard_id:'synthetic-guard',password})});
  if(suspendedLogin.status!==401)throw Error('Suspended vendor logged in');
  if(store.count()!==1)throw Error('Suspension altered recorded incident');
  directory.setVendorActive('synthetic-vendor',true);
  if((await profile()).status!==200)throw Error('Vendor reactivation did not restore eligible guard');
  response=await send();
  if(response.status!==200||JSON.stringify(await response.json())!==JSON.stringify(receipt)||store.count()!==1)throw Error('Vendor reactivation lost original receipt');
  console.log('PASS: vendor suspension denies login, existing session, device challenge and batch retry; reactivation preserves receipt');
  await service.stop();started=false;store.close();shiftLifecycle.close();shiftLifecycle=new ShiftLifecycle(join(dir,'shifts.sqlite'));store=new DurableIngest(join(dir,'events.sqlite'));service=createLocalService({config,store,directory,devices,grantIssuer,shiftLifecycle});origin=await service.start();started=true;
  response=await send();if(response.status!==200||JSON.stringify(await response.json())!==JSON.stringify(receipt)||store.count()!==1)throw Error('Restart retry failed');
  if(JSON.stringify(await (await transition(startRequest)).json())!==JSON.stringify(startReceipt))throw Error('Restart lost clock-in receipt');
  const endRequest={request_id:randomUUID(),action:'end',reason:'Synthetic smoke test complete',confirmed:true};
  const ended=await transition(endRequest);if(ended.status!==200)throw Error('Confirmed early exit failed');const endReceipt=await ended.json();
  if(!endReceipt.early_exit||endReceipt.clocked_out_at_ms<startReceipt.clocked_in_at_ms)throw Error('Invalid clock-out');
  if(JSON.stringify(await (await transition(endRequest)).json())!==JSON.stringify(endReceipt))throw Error('Clock-out retry changed time');
  if((await post('/v1/shift-grant',{assignment_id:'synthetic-shift',proof:await freshProof()})).status!==400)throw Error('Ended shift received grant');
  if((await send()).status!==200)throw Error('Valid pre-exit upload retry denied');
  console.log('PASS: persisted shift recovery, confirmed early exit, post-exit grant denial and pre-exit upload');
  grantIssuer.revoke(claims.grant_id);
  if((await send()).status!==400)throw Error('Revoked grant accepted');
  console.log('PASS: real local Auth + issued grant history + signed HTTP ingestion + restart deduplication + revocation');
 } finally {if(started)await service.stop();store.close();directory.close();devices.close();grantIssuer.close();shiftLifecycle.close();rmSync(dir,{recursive:true,force:true});}

} finally {
 if(id){await call('/admin/users/'+id,{method:'DELETE',headers:admin});console.log('PASS: synthetic account removed');}
}
