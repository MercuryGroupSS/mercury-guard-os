import {Client} from 'pg';
import {readFileSync} from 'node:fs';
import {randomUUID,randomBytes,createHash,generateKeyPairSync,sign,verify,createPublicKey} from 'node:crypto';
import assert from 'node:assert/strict';
import {openLocalAssignmentStore} from '../local-assignment-factory.mjs';
import {parseEnrollmentKey} from '../enrollment-key.mjs';
import {openLocalGuardDirectory} from '../local-directory-factory.mjs';
import {createLocalService} from '../local-service.mjs';
import {ShiftLifecycle} from '../shift-lifecycle.mjs';
import {ShiftGrantIssuer} from '../shift-grant-issuer.mjs';
import {DurableIngest} from '../durable-ingest.mjs';
const lines=readFileSync(new URL('../../supabase-start.log',import.meta.url),'utf8').split('\n');
const config=JSON.parse(lines.findLast(l=>l.startsWith('{')&&l.includes('API_URL'))),url=new URL(config.DB_URL);
if(config.API_URL!=='http://127.0.0.1:55321'||!['127.0.0.1','localhost'].includes(url.hostname)||url.port!=='55322')throw Error('Local environment required');
const admin=new Client({connectionString:config.DB_URL}),vendor='smoke-'+randomUUID(),guard='smoke-'+randomUUID();
const authHeaders={apikey:config.SERVICE_ROLE_KEY,authorization:'Bearer '+config.SERVICE_ROLE_KEY,'content-type':'application/json'};
const email=randomUUID()+'@example.invalid',password=randomBytes(32).toString('hex');
const site='smoke-'+randomUUID(),deviceId='smoke-'+randomUUID(),sourceId='smoke-'+randomUUID();
let subject,directory,service,store,assignmentStore,shiftLifecycle,grantIssuer;
await admin.connect();
try{
 const created=await fetch(config.API_URL+'/auth/v1/admin/users',{method:'POST',headers:authHeaders,body:JSON.stringify({email,password,email_confirm:true})});assert.equal(created.status,200);subject=(await created.json()).id;assert.ok(subject);
 await admin.query('INSERT INTO mercury_guard.vendors(vendor_id,kind,active) VALUES($1,$2,true)',[vendor,'company']);
 await admin.query('INSERT INTO mercury_guard.guards(guard_id,auth_subject,vendor_id,active) VALUES($1,$2,$3,true)',[guard,subject,vendor]);
 await admin.query('INSERT INTO mercury_guard.guard_login VALUES($1,$2)',[guard,email]);
 directory=await openLocalGuardDirectory({config,mode:'postgres'});
 assignmentStore=await openLocalAssignmentStore({mode:'postgres',directory});
 await admin.query('INSERT INTO mercury_guard.sites VALUES($1,true)',[site]);
 const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),spki=keys.publicKey.export({type:'spki',format:'der'}).toString('base64url'),thumb=parseEnrollmentKey(spki).thumbprint;
 await assignmentStore.devices.enroll({deviceId,mode:'site',siteId:site,active:true,revoked:false,publicKeySpki:spki});
 const now=Date.now(),shift={id:sourceId,updated_at:new Date(now).toISOString(),scheduled_start:new Date(now-60000).toISOString(),scheduled_end:new Date(now+3600000).toISOString(),status:'scheduled'},binding={opsShiftId:sourceId,guardId:guard,vendorId:vendor,siteId:site,revision:1,active:true};
 const imported=await assignmentStore.sync.apply(shift,binding);
 store=new DurableIngest(':memory:');shiftLifecycle=new ShiftLifecycle(':memory:');grantIssuer=new ShiftGrantIssuer({path:':memory:',privateKey:generateKeyPairSync('rsa',{modulusLength:2048}).privateKey,keyId:'smoke',issuer:'mercury-local',audience:'mercury-local'});service=createLocalService({config,store,directory,devices:assignmentStore.devices,shiftLifecycle,grantIssuer});const origin=await service.start();
 const login=()=>fetch(origin+'/v1/session/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({guard_id:guard,password})});
 const response=await login();assert.equal(response.status,200);const session=await response.json();assert.equal('refresh_token' in session,false);
 const me=()=>fetch(origin+'/v1/me',{headers:{authorization:'Bearer '+session.access_token}});
 assert.deepEqual(await (await me()).json(),{guard_id:guard,vendor_id:vendor});
 const post=(path,body)=>fetch(origin+path,{method:'POST',headers:{authorization:'Bearer '+session.access_token,'content-type':'application/json'},body:JSON.stringify(body)});
 const proof=async()=>{const response=await post('/v1/device-challenge',{device_id:deviceId});assert.equal(response.status,200);const c=await response.json();return {version:1,algorithm:'SHA256withECDSA',audience:c.audience,request_id:c.request_id,challenge:c.challenge,device_thumbprint:thumb,public_key_spki:spki,signature_der:sign('sha256',Buffer.from(`mercury-enrollment-proof-v1\n${c.audience}\n${c.request_id}\n${c.challenge}\n${thumb}`),keys.privateKey).toString('base64url')};};
 const firstProof=await proof(),listed=await post('/v1/assignments',firstProof);assert.equal(listed.status,200);assert.deepEqual((await listed.json()).assignments.map(a=>a.assignmentId),[imported.assignmentId]);
 assert.equal((await post('/v1/assignments',firstProof)).status,400);
 const grant=()=>proof().then(p=>post('/v1/shift-grant',{assignment_id:imported.assignmentId,proof:p}));
 assert.equal((await grant()).status,400);
 const started=await post('/v1/shift-transition',{assignment_id:imported.assignmentId,proof:await proof(),transition:{action:'start',confirmed:true,request_id:randomUUID(),reason:''}});assert.equal(started.status,200);
 const issued=await grant();assert.equal(issued.status,200);const issuedBody=await issued.json();assert.equal(verify('sha256',Buffer.from(`mercury-shift-grant-v1.${issuedBody.key_id}.${issuedBody.payload}`),createPublicKey({key:Buffer.from(grantIssuer.publicKey(),'base64url'),type:'spki',format:'der'}),Buffer.from(issuedBody.signature,'base64url')),true);const claims=JSON.parse(Buffer.from(issuedBody.payload,'base64url'));assert.equal(claims.guard_id,guard);assert.equal(claims.assignment_id,imported.assignmentId);assert.equal(claims.device_thumbprint,thumb);
 await assignmentStore.sync.apply({...shift,updated_at:new Date(now+1000).toISOString(),status:'cancelled'},binding);
 const cancelled=await post('/v1/assignments',await proof());assert.equal(cancelled.status,200);const cancelledRows=(await cancelled.json()).assignments;assert.equal(cancelledRows.length,1);assert.equal(cancelledRows[0].canStart,false);assert.equal(cancelledRows[0].assignmentActive,false);
 assert.equal((await grant()).status,400);
 const ended=await post('/v1/shift-transition',{assignment_id:imported.assignmentId,proof:await proof(),transition:{action:'end',confirmed:true,request_id:randomUUID(),reason:'Synthetic cancellation closeout'}});assert.equal(ended.status,200);
 await assignmentStore.devices.revoke(deviceId);assert.equal((await post('/v1/device-challenge',{device_id:deviceId})).status,400);
 console.log('PASS: real HTTP device proof, assignment import, confirmed shift, signed capture grant, cancellation closeout and revocation with PostgreSQL storage');
 await admin.query('UPDATE mercury_guard.vendors SET active=false WHERE vendor_id=$1',[vendor]);assert.equal((await me()).status,403);assert.equal((await login()).status,401);
 console.log('PASS: real HTTP login and Auth verification with PostgreSQL directory/pool/shared limiter; suspension denies existing session');
}finally{
 if(service)await service.stop();await assignmentStore?.close();await directory?.close();store?.close();shiftLifecycle?.close();grantIssuer?.close();
 try{
  await admin.query('DELETE FROM mercury_guard.device_challenges WHERE device_id=$1',[deviceId]);
  await admin.query('DELETE FROM mercury_guard.ops_assignment_history WHERE source_id=$1',[sourceId]);
  await admin.query('DELETE FROM mercury_guard.ops_assignment_sync WHERE source_id=$1',[sourceId]);
  await admin.query('DELETE FROM mercury_guard.ops_binding_revocations WHERE source_id=$1',[sourceId]);
  await admin.query('DELETE FROM mercury_guard.assignments WHERE guard_id=$1',[guard]);
  await admin.query('DELETE FROM mercury_guard.devices WHERE device_id=$1',[deviceId]);
  await admin.query('DELETE FROM mercury_guard.sites WHERE site_id=$1',[site]);
  await admin.query('DELETE FROM mercury_guard.guard_login WHERE guard_id=$1',[guard]);await admin.query('DELETE FROM mercury_guard.guards WHERE guard_id=$1',[guard]);await admin.query('DELETE FROM mercury_guard.vendors WHERE vendor_id=$1',[vendor]);
  await admin.query('DELETE FROM mercury_guard.login_attempts WHERE bucket=$1',['account:'+createHash('sha256').update(guard).digest('hex')]);
  if(subject){const deleted=await fetch(config.API_URL+'/auth/v1/admin/users/'+subject,{method:'DELETE',headers:authHeaders});assert.equal(deleted.ok,true);}
  console.log('PASS: synthetic identity/account rows removed; shared global limiter count retained');
 }finally{await admin.end();}
}
