// Attended local browser fixture. Contains only synthetic receiver records.
// SIGINT/SIGTERM removes its own records, temporary administrator and input file.
import {Client,Pool} from 'pg';import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {openLocalGuardDirectory} from '../local-directory-factory.mjs';import {openLocalAssignmentStore} from '../local-assignment-factory.mjs';
import {PostgresAdministration} from '../postgres-administration.mjs';import {createAdminAuthAccountReader} from '../admin-auth-account.mjs';import {createLocalService} from '../local-service.mjs';
import {ReceiverMappingOwner} from '../receiver-mapping-owner.mjs';import {PostgresDashboardInbox} from '../postgres-dashboard-inbox.mjs';import {projectDashboardObservation} from '../dashboard-delivery.mjs';
const root=new URL('../../',import.meta.url),config=JSON.parse(readFileSync(new URL('supabase-start.log',root),'utf8').split('\n').findLast(l=>l.startsWith('{')&&l.includes('API_URL'))),dbUrl=new URL(config.DB_URL);
if(config.API_URL!=='http://127.0.0.1:55321'||dbUrl.hostname!=='127.0.0.1'||dbUrl.port!=='55322'||dbUrl.search||dbUrl.hash)throw Error('Isolated local report fixture required');
const run='reports-test-'+randomUUID(),email=run+'@example.invalid',password=randomBytes(32).toString('base64url'),file=new URL('.local-backend/report-console-test.json',root);
if(existsSync(file))throw Error('An existing report browser fixture owns the private test file');
const owner=new Client({connectionString:config.DB_URL}),ownerPool=new Pool({connectionString:config.DB_URL,max:2}),receiverPool=new Pool({connectionString:config.DB_URL,max:3,options:'-c role=service_role'}),inbox=new PostgresDashboardInbox(receiverPool),receiverOwner=new ReceiverMappingOwner(ownerPool);
const mapping={assignmentId:run+'-shift',guardId:'synthetic-guard-'+randomUUID(),vendorId:run+'-company',siteId:'synthetic-west-entrance',dashboardShiftId:run+'-ops',destination:run+'-inbox',revision:1,active:true},approval={requestId:randomUUID(),mapping,operator:'Local browser fixture',reason:'Disposable report rendering test; no real operational event'},thumbprint=randomBytes(32).toString('hex'),photoBytes=Buffer.from(readFileSync(new URL('../fixtures/receiver-photo.base64',import.meta.url),'utf8').trim(),'base64'),photoHash=createHash('sha256').update(photoBytes).digest('hex'),photoEvidence=randomUUID(),photoEvent=randomUUID(),now=Date.now();
const headers={apikey:config.SERVICE_ROLE_KEY,authorization:'Bearer '+config.SERVICE_ROLE_KEY,'content-type':'application/json'};
let subject,directory,assignmentStore,service,closing=false,ownsFile=false,fixturePrepared=false;
async function cleanup(){
 if(closing)return;closing=true;
 try{await service?.stop();await assignmentStore?.close();await directory?.close();
  if(fixturePrepared){await owner.query('BEGIN');try{await owner.query('DELETE FROM mercury_guard_receiver.media WHERE delivery_id IN(SELECT delivery_id FROM mercury_guard_receiver.observations WHERE assignment_id=$1 AND vendor_id=$2)',[mapping.assignmentId,mapping.vendorId]);await owner.query('DELETE FROM mercury_guard_receiver.observations WHERE assignment_id=$1 AND vendor_id=$2',[mapping.assignmentId,mapping.vendorId]);await owner.query('DELETE FROM mercury_guard_receiver.bindings WHERE assignment_id=$1 AND vendor_id=$2',[mapping.assignmentId,mapping.vendorId]);await owner.query('DELETE FROM mercury_guard_receiver.mapping_history WHERE request_id=$1 AND assignment_id=$2',[approval.requestId,mapping.assignmentId]);await owner.query('COMMIT');}catch(error){await owner.query('ROLLBACK');throw error;}}
  if(subject){await owner.query('DELETE FROM mercury_guard.admin_audit WHERE actor_subject=$1',[subject]);await owner.query('DELETE FROM mercury_guard.admin_membership_audit WHERE auth_subject=$1',[subject]);await owner.query('DELETE FROM mercury_guard.admin_accounts WHERE auth_subject=$1',[subject]);await owner.query('DELETE FROM mercury_guard.login_attempts WHERE bucket=$1',['account:'+createHash('sha256').update('admin-login:'+email).digest('hex')]);const deleted=await fetch(config.API_URL+'/auth/v1/admin/users/'+subject,{method:'DELETE',headers});if(!deleted.ok)throw Error('Temporary report account cleanup failed');}
  if(ownsFile)rmSync(file,{force:true});console.log('Temporary report records, media, approval and administrator removed.');
 }finally{await receiverPool.end();await ownerPool.end();await owner.end();}
}
async function observation(kind,data,{eventId=randomUUID(),at=now,bytes=null}={}){
 const value=projectDashboardObservation({vendor_id:mapping.vendorId,scope:{guard_id:mapping.guardId,site_id:mapping.siteId,assignment_id:mapping.assignmentId,device_thumbprint:thumbprint},event:{event_id:eventId,kind,at,data}},mapping);
 await inbox.accept(value,JSON.stringify(value));if(bytes)await inbox.acceptMedia(value.delivery_id,mapping.destination,bytes);return value.delivery_id;
}
await owner.connect();
try{
 const created=await fetch(config.API_URL+'/auth/v1/admin/users',{method:'POST',headers,body:JSON.stringify({email,password,email_confirm:true})});if(!created.ok)throw Error('Temporary report Auth account unavailable');subject=(await created.json()).id;if(!subject)throw Error('Temporary account ID missing');
 await owner.query('INSERT INTO mercury_guard.admin_accounts(auth_subject,email,active) VALUES($1,$2,true)',[subject,email]);fixturePrepared=true;await receiverOwner.approve(approval);
 const photoData={evidence_id:photoEvidence,sha256:photoHash,bytes:photoBytes.length,width:192,height:108,capture:'camera_intent'};
 const photoDeliveryId=await observation('photo_evidence',photoData,{eventId:photoEvent,at:now-90000,bytes:photoBytes});
 await observation('check_in',{policy_revision:1,slot:0,photo_event_id:photoEvent,evidence_id:photoEvidence,biometric:{method:'android_local_biometric',at:now-94000},location:{at:now-92000,latitude:0,longitude:0,accuracy_m:10,mock:false}},{at:now-90000});
 await observation('patrol_checkpoint',{route_id:'synthetic-route',route_revision:1,checkpoint_id:'west-entrance'},{at:now-60000});
 await observation('photo_evidence',{...photoData,evidence_id:randomUUID()},{at:now-45000});
 await observation('incident',{description:'Synthetic browser test — west entrance panel reset. No real incident.\nLiteral text test: <script>untrusted()</script>'},{at:now-30000});
 directory=await openLocalGuardDirectory({config,mode:'postgres'});assignmentStore=await openLocalAssignmentStore({mode:'postgres',directory});const admin=new PostgresAdministration({devices:assignmentStore.devices,loadAuthAccount:createAdminAuthAccountReader({url:config.API_URL,serverKey:config.SERVICE_ROLE_KEY,allowLocal:true})});
 service=createLocalService({config,store:{ingest:async()=>{throw Error('Read-only report browser fixture');}},admin});const origin=await service.start();mkdirSync(new URL('.local-backend/',root),{recursive:true,mode:0o700});writeFileSync(file,JSON.stringify({origin,email,password,subject,assignmentId:mapping.assignmentId,vendorId:mapping.vendorId,photoDeliveryId,pid:process.pid})+'\n',{mode:0o600,flag:'wx'});ownsFile=true;
 console.log('Local report browser fixture: '+origin+'/admin/');console.log('Temporary credentials stay in private .local-backend/report-console-test.json. Stop this process to remove only its synthetic rows.');
 process.once('SIGINT',()=>cleanup().then(()=>process.exit(0),()=>process.exit(1)));process.once('SIGTERM',()=>cleanup().then(()=>process.exit(0),()=>process.exit(1)));
}catch(error){await cleanup();throw error;}
