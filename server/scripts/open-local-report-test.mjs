// Attended local browser fixture. Contains only synthetic receiver records.
// SIGINT/SIGTERM removes its own records, temporary administrator and input file.
import {Client,Pool} from 'pg';import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {openLocalGuardDirectory} from '../local-directory-factory.mjs';import {openLocalAssignmentStore} from '../local-assignment-factory.mjs';
import {PostgresAdministration} from '../postgres-administration.mjs';import {createAdminAuthAccountReader} from '../admin-auth-account.mjs';import {createLocalService} from '../local-service.mjs';
import {ReceiverMappingOwner} from '../receiver-mapping-owner.mjs';import {PostgresDashboardInbox} from '../postgres-dashboard-inbox.mjs';import {projectDashboardObservation} from '../dashboard-delivery.mjs';
import {locationDigest,locationPolicySnapshot,validateLocationSample} from '../location-policy.mjs';
const root=new URL('../../',import.meta.url),config=JSON.parse(readFileSync(new URL('supabase-start.log',root),'utf8').split('\n').findLast(l=>l.startsWith('{')&&l.includes('API_URL'))),dbUrl=new URL(config.DB_URL);
if(config.API_URL!=='http://127.0.0.1:55321'||!['postgres:','postgresql:'].includes(dbUrl.protocol)||dbUrl.hostname!=='127.0.0.1'||dbUrl.port!=='55322'||dbUrl.search||dbUrl.hash)throw Error('Isolated local report fixture required');
const run='reports-test-'+randomUUID(),email=run+'@example.invalid',password=randomBytes(32).toString('base64url'),file=new URL('.local-backend/report-console-test.json',root);
const database={connectionString:config.DB_URL,connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:12000};
const owner=new Client(database),ownerPool=new Pool({...database,max:2}),receiverPool=new Pool({...database,max:3,options:'-c role=service_role'}),inbox=new PostgresDashboardInbox(receiverPool),receiverOwner=new ReceiverMappingOwner(ownerPool);
ownerPool.on('error',()=>{});receiverPool.on('error',()=>{});
const mapping={assignmentId:run+'-shift',guardId:'synthetic-guard-'+randomUUID(),vendorId:run+'-company',siteId:'synthetic-west-entrance',dashboardShiftId:run+'-ops',destination:run+'-inbox',revision:1,active:true},approval={requestId:randomUUID(),mapping,operator:'Local browser fixture',reason:'Disposable report rendering test; no real operational event'},thumbprint=randomBytes(32).toString('hex'),photoBytes=Buffer.from(readFileSync(new URL('../fixtures/receiver-photo.base64',import.meta.url),'utf8').trim(),'base64'),photoHash=createHash('sha256').update(photoBytes).digest('hex'),photoEvidence=randomUUID(),photoEvent=randomUUID(),now=Date.now();
const headers={apikey:config.SERVICE_ROLE_KEY,authorization:'Bearer '+config.SERVICE_ROLE_KEY,'content-type':'application/json'};
const provider=(path,options)=>fetch(config.API_URL+'/auth/v1/'+path,{...options,redirect:'error',signal:AbortSignal.timeout(8000)});
let subject,directory,assignmentStore,service,ownsFile=false,ownerConnected=false,cleanupPromise,signalStop;const stopped=new Promise(resolve=>{signalStop=resolve;});
process.once('SIGINT',signalStop);process.once('SIGTERM',signalStop);
async function cleanup(){
 if(cleanupPromise)return cleanupPromise;
 cleanupPromise=(async()=>{const failures=[],attempt=async fn=>{try{await fn();}catch(error){failures.push(error);}};
  await attempt(async()=>service?.stop());await attempt(async()=>assignmentStore?.close());await attempt(async()=>directory?.close());await attempt(()=>receiverPool.end());await attempt(()=>ownerPool.end());
  if(ownerConnected){
   await attempt(async()=>{if(!subject){const recovered=(await owner.query("SELECT id FROM auth.users WHERE email=$1 AND raw_user_meta_data->>'mercury_fixture_run'=$2",[email,run])).rows;if(recovered.length>1)throw Error('Ambiguous temporary account recovery');subject=recovered[0]?.id;}});
   await attempt(async()=>{await owner.query('BEGIN');try{await owner.query('DELETE FROM mercury_guard_receiver.media WHERE delivery_id IN(SELECT delivery_id FROM mercury_guard_receiver.observations WHERE assignment_id=$1 AND vendor_id=$2)',[mapping.assignmentId,mapping.vendorId]);await owner.query('DELETE FROM mercury_guard_receiver.observations WHERE assignment_id=$1 AND vendor_id=$2',[mapping.assignmentId,mapping.vendorId]);await owner.query('DELETE FROM mercury_guard_receiver.bindings WHERE assignment_id=$1 AND vendor_id=$2',[mapping.assignmentId,mapping.vendorId]);await owner.query('DELETE FROM mercury_guard_receiver.mapping_history WHERE assignment_id=$1 AND vendor_id=$2',[mapping.assignmentId,mapping.vendorId]);await owner.query('COMMIT');}catch(error){await owner.query('ROLLBACK');throw error;}});
   if(subject){for(const table of ['admin_audit','admin_membership_audit','admin_accounts'])await attempt(()=>owner.query('DELETE FROM mercury_guard.'+table+' WHERE '+(table==='admin_audit'?'actor_subject':'auth_subject')+'=$1',[subject]));}
   const bucket='account:'+createHash('sha256').update('admin-login:'+email).digest('hex');await attempt(()=>owner.query('DELETE FROM mercury_guard.login_attempts WHERE bucket=$1',[bucket]));
   if(subject)await attempt(async()=>{const deleted=await provider('admin/users/'+subject,{method:'DELETE',headers});if(!deleted.ok)throw Error('Temporary report account cleanup failed');});
   await attempt(async()=>{const result=(await owner.query(`SELECT
    (SELECT count(*) FROM mercury_guard_receiver.observations WHERE assignment_id=$1 AND vendor_id=$2) AS reports,
    (SELECT count(*) FROM mercury_guard_receiver.mapping_history WHERE assignment_id=$1 AND vendor_id=$2) AS approvals,
    (SELECT count(*) FROM mercury_guard_receiver.bindings WHERE assignment_id=$1 AND vendor_id=$2) AS bindings,
    (SELECT count(*) FROM mercury_guard.admin_accounts WHERE auth_subject=$3) AS memberships,
    (SELECT count(*) FROM mercury_guard.admin_audit WHERE actor_subject=$3) AS audit,
    (SELECT count(*) FROM mercury_guard.admin_membership_audit WHERE auth_subject=$3) AS access_audit,
    (SELECT count(*) FROM mercury_guard.login_attempts WHERE bucket=$4) AS limiter,
    (SELECT count(*) FROM auth.users WHERE email=$5 AND raw_user_meta_data->>'mercury_fixture_run'=$6) AS users,
    (SELECT count(*) FROM auth.sessions WHERE user_id=$3) AS sessions`,[mapping.assignmentId,mapping.vendorId,subject??null,bucket,email,run])).rows[0];if(!Object.values(result).every(value=>Number(value)===0))throw Error('Temporary report cleanup left scoped rows');});
  }
  if(ownsFile&&!failures.length)await attempt(async()=>{const saved=JSON.parse(readFileSync(file,'utf8'));if(saved.pid!==process.pid||saved.run!==run)throw Error('Private fixture ownership changed');rmSync(file);ownsFile=false;});
  await attempt(()=>owner.end());if(failures.length)throw new AggregateError(failures,'Report fixture cleanup could not be fully verified; private ownership file retained');
  console.log('PASS: exact temporary report/location/media records, approvals, administrator, Auth user/session and account limiter removed; global limiter retained.');
 })();return cleanupPromise;
}
async function observation(kind,data,{eventId=randomUUID(),at=now,bytes=null,locationValidation=null}={}){
 const value=projectDashboardObservation({vendor_id:mapping.vendorId,scope:{guard_id:mapping.guardId,site_id:mapping.siteId,assignment_id:mapping.assignmentId,device_thumbprint:thumbprint},event:{event_id:eventId,kind,at,data},...(locationValidation?{location_validation:locationValidation}:{})},mapping);
 await inbox.accept(value,JSON.stringify(value));if(bytes)await inbox.acceptMedia(value.delivery_id,mapping.destination,bytes);return value.delivery_id;
}
try{
 mkdirSync(new URL('.local-backend/',root),{recursive:true,mode:0o700});writeFileSync(file,JSON.stringify({pid:process.pid,run,assignmentId:mapping.assignmentId,vendorId:mapping.vendorId}),{mode:0o600,flag:'wx'});ownsFile=true;
 await owner.connect();ownerConnected=true;
 const created=await provider('admin/users',{method:'POST',headers,body:JSON.stringify({email,password,email_confirm:true,user_metadata:{mercury_fixture_run:run}})});if(!created.ok)throw Error('Temporary report Auth account unavailable');subject=(await created.json()).id;if(typeof subject!=='string'||!/^[a-f0-9-]{36}$/.test(subject))throw Error('Temporary account ID missing');
 await owner.query('INSERT INTO mercury_guard.admin_accounts(auth_subject,email,active) VALUES($1,$2,true)',[subject,email]);await receiverOwner.approve(approval);
 const photoData={evidence_id:photoEvidence,sha256:photoHash,bytes:photoBytes.length,width:192,height:108,capture:'camera_intent'};
 const photoDeliveryId=await observation('photo_evidence',photoData,{eventId:photoEvent,at:now-90000,bytes:photoBytes});
 await observation('check_in',{policy_revision:1,slot:0,photo_event_id:photoEvent,evidence_id:photoEvidence,biometric:{method:'android_local_biometric',at:now-94000},location:{at:now-92000,latitude:0,longitude:0,accuracy_m:10,mock:false}},{at:now-90000});
 await observation('patrol_checkpoint',{route_id:'synthetic-route',route_revision:1,checkpoint_id:'west-entrance'},{at:now-60000});
 await observation('photo_evidence',{...photoData,evidence_id:randomUUID()},{at:now-45000});
 await observation('incident',{description:'Synthetic browser test — west entrance panel reset. No real incident.\nLiteral text test: <script>untrusted()</script>'},{at:now-30000});
 // Exercise the real typed validation and receiver projection without claiming
 // a native fix, an operational consent or physical presence was observed.
 const notice='Synthetic report-rendering notice only. No operational tracking, real position or geofence alert is represented.',snapshot=locationPolicySnapshot({version:1,revision:7,notice_revision:3,notice_text:notice,notice_sha256:locationDigest(notice),sample_interval_ms:1000,min_distance_m:0,max_fix_age_ms:20000,max_accuracy_m:30,max_capture_lease_ms:10000,geofence:{type:'circle',id:run+'-synthetic-circle',revision:2,latitude:0,longitude:0,radius_m:100}}),consentId=randomUUID(),locationGrant={grant_id:randomUUID(),not_before_ms:now-15000,expires_at_ms:now-5000},locationAt=now-10000;
 const locationData={capture_grant_id:locationGrant.grant_id,consent_id:consentId,policy_revision:snapshot.policy.revision,policy_sha256:snapshot.policy_sha256,fix_at_ms:locationAt-1000,latitude:0,longitude:0,accuracy_m:10,mock:false};
 const validation=validateLocationSample({consent_id:consentId,policy_sha256:snapshot.policy_sha256,policy_payload:snapshot.policy_payload},{kind:'location',at:locationAt,data:locationData},locationGrant,now);
 const locationDeliveryId=await observation('location',locationData,{at:locationAt,locationValidation:validation});
 directory=await openLocalGuardDirectory({config,mode:'postgres'});assignmentStore=await openLocalAssignmentStore({mode:'postgres',directory});const admin=new PostgresAdministration({devices:assignmentStore.devices,loadAuthAccount:createAdminAuthAccountReader({url:config.API_URL,serverKey:config.SERVICE_ROLE_KEY,allowLocal:true})});
 service=createLocalService({config,store:{ingest:async()=>{throw Error('Read-only report browser fixture');}},admin});const origin=await service.start();writeFileSync(file,JSON.stringify({origin,email,password,subject,assignmentId:mapping.assignmentId,vendorId:mapping.vendorId,photoDeliveryId,locationDeliveryId,locationConsentId:consentId,locationPolicySha256:snapshot.policy_sha256,pid:process.pid,run})+'\n',{mode:0o600});
 console.log('Local report browser fixture: '+origin+'/admin/');console.log('Temporary credentials stay in private .local-backend/report-console-test.json. Stop this process to remove only its synthetic rows.');
 await stopped;await cleanup();
}catch(error){await cleanup();throw error;}
