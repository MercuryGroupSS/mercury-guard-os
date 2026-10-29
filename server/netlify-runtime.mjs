import {Pool} from 'pg';
import {AsyncLocalStorage} from 'node:async_hooks';
import {performance} from 'node:perf_hooks';
import {validateNetlifyConfiguration} from './netlify-config.mjs';
import {createGuardApplication} from './guard-application.mjs';
import {configuredDeploymentIdentity} from './configured-service-config.mjs';
import {assertConfiguredDatabase,assertConfiguredDeploymentIdentity} from './configured-database.mjs';
import {PostgresGuardDirectory} from './postgres-guard-directory.mjs';
import {PostgresDeviceAssignments} from './postgres-device-assignments.mjs';
import {PostgresOpsAssignmentSync} from './postgres-ops-assignment-sync.mjs';
import {PostgresOpsBindingStore} from './postgres-ops-binding-store.mjs';
import {createOpsSourceReader} from './ops-source-reader.mjs';
import {createOpsRefreshWorker} from './ops-refresh-worker.mjs';
import {PostgresLocationConsents} from './postgres-location-consents.mjs';
import {PostgresDurableIngest} from './postgres-durable-ingest.mjs';
import {PostgresShiftGrantIssuer} from './postgres-shift-grant-issuer.mjs';
import {PostgresShiftLifecycle} from './postgres-shift-lifecycle.mjs';
import {PostgresDispatchFeed} from './postgres-dispatch-feed.mjs';
import {PostgresAdministration} from './postgres-administration.mjs';
import {PostgresEscalations} from './postgres-escalations.mjs';
import {createAdminAuthAccountReader} from './admin-auth-account.mjs';
import {PostgresDashboardBindings,PostgresDashboardOutbox} from './postgres-dashboard-delivery.mjs';
import {createDashboardRouter,createDashboardMediaRouter} from './dashboard-router.mjs';
import {createDashboardBridge} from './dashboard-bridge.mjs';
import {PostgresDashboardMedia} from './postgres-dashboard-media.mjs';
import {deliverDashboardMediaOnce,createDashboardMediaHandler} from './dashboard-media.mjs';
import {PostgresDashboardInbox} from './postgres-dashboard-inbox.mjs';
import {createDashboardInboxHandler} from './dashboard-inbox.mjs';
import {createCheckInWorker} from './check-in-worker.mjs';

const budgetContext=new AsyncLocalStorage(),WORKER_LOCK='724910621355099';
const unavailable=()=>new Response('{"error":"deployment_unavailable"}',{status:503,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
function remaining(clock){const b=budgetContext.getStore();if(!b)return 4000;const n=Math.floor(b.deadline-clock());if(n<1){b.expired=true;throw Error('Netlify worker budget exhausted');}return Math.min(4000,n);}
function checkBudget(clock){remaining(clock);}

// Session/direct mode is deliberate: each checkout awaits the role switch and verifies it.
// No fire-and-forget connect hook, transaction-pool session assumption or privileged fallback.
export async function openNetlifyDatabase(config,materials,{poolFactory=options=>new Pool(options),clock=()=>performance.now()}={}){
 const c=validateNetlifyConfiguration(config,materials),raw=poolFactory({connectionString:c.database.url,max:2,connectionTimeoutMillis:1000,idleTimeoutMillis:10000,query_timeout:4500,statement_timeout:4000,ssl:{rejectUnauthorized:true,...(materials.databaseCa?{ca:materials.databaseCa}:{})}});
 let ended=false;raw.on('error',()=>{});
 async function checkout(){
  if(ended)throw Error('Netlify database closed');checkBudget(clock);let client;
  try{
   client=await raw.connect();checkBudget(clock);
   await client.query({text:'SET statement_timeout=4000',query_timeout:remaining(clock)});
   await client.query({text:'SET ROLE service_role',query_timeout:remaining(clock)});
   const role=await client.query({text:'SELECT current_user AS role',query_timeout:remaining(clock)});
   if(role.rows.length!==1||role.rows[0].role!=='service_role')throw Error('Netlify database role unavailable');
   return client;
  }catch{client?.release(true);throw Error('Netlify database authority unavailable');}
 }
 function bound(client){let released=false,failed=false;return {
  async query(text,values){
   if(released)throw Error('Netlify database checkout released');
   if(typeof text!=='string'||values!==undefined&&!Array.isArray(values))throw Error('Bounded SQL call required');
   // A rollback is always allowed after deadline so partially executed mutations do not commit.
   const cleanup=/^ROLLBACK\s*;?$/i.test(text),limit=cleanup?1000:remaining(clock);
   try{
    if(!cleanup)await client.query({text:"SELECT set_config('statement_timeout',$1,false)",values:[String(Math.max(1,limit-100))],query_timeout:limit});
    return await client.query({text,values,query_timeout:cleanup?1000:remaining(clock)});
   }catch(error){if(error?.code==='QUERY_TIMEOUT'||error?.message==='Query read timeout')failed=true;throw error;}
  },
  release(destroy=false){if(released)return;released=true;client.release(Boolean(destroy||failed));}
 };}
 const pool={
  async connect(){return bound(await checkout());},
  async query(text,values){const client=await this.connect();try{return await client.query(text,values);}finally{client.release();}},
  async withWorkerLock(fn){
   const client=await checkout();let held=false,broken=false;
   try{
    const result=await client.query({text:'SELECT pg_try_advisory_lock($1::bigint) AS acquired',values:[WORKER_LOCK],query_timeout:remaining(clock)});
    held=result.rows[0]?.acquired===true;if(!held)return {status:'busy',completed:false};checkBudget(clock);return await fn();
   }catch(error){broken=true;throw error;
   }finally{
    if(held)try{const unlocked=await client.query({text:'SELECT pg_advisory_unlock($1::bigint) AS released',values:[WORKER_LOCK],query_timeout:1000});if(unlocked.rows[0]?.released!==true)broken=true;}catch{broken=true;}
    client.release(broken);
   }
  },
  async end(){if(ended)return;ended=true;await raw.end();}
 };
 try{await assertConfiguredDatabase(pool,configuredDeploymentIdentity(c,materials));return pool;}catch{await pool.end();throw Error('Netlify PostgreSQL startup failed; no authority or TLS fallback');}
}

// Finite calls only. No HTTPS listener, filesystem secret loader, setInterval, automatic
// enrollment/approval/migration, startup scan, or response-triggered background continuation.
export async function openNetlifyRuntime(config,materials,{fetchImpl=fetch,poolFactory,clock=()=>performance.now()}={}){
 const c=validateNetlifyConfiguration(config,materials),pool=await openNetlifyDatabase(c,materials,{poolFactory,clock});
 try{
  let closed=false,closing=null,workerRun=null;const active=new Set(),identity=configuredDeploymentIdentity(c,materials);
  const fetchBound=async(input,options={})=>{
   const b=budgetContext.getStore();if(!b)return fetchImpl(input,options);
   const limit=remaining(clock),signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(limit)]):AbortSignal.timeout(limit);
   try{const response=await fetchImpl(input,{...options,signal});checkBudget(clock);return response;}catch(error){if(clock()>=b.deadline)b.expired=true;throw error;}
  };
  const requireDeployment=async()=>{if(closed)throw Error('Netlify runtime closed');checkBudget(clock);await assertConfiguredDeploymentIdentity(pool,identity);};
  const directory=new PostgresGuardDirectory({client:pool}),devices=new PostgresDeviceAssignments(pool,c.issuer.audience),locationConsents=new PostgresLocationConsents({devices,audience:c.issuer.audience}),store=new PostgresDurableIngest(devices,{locationConsents}),shiftLifecycle=new PostgresShiftLifecycle(devices),dispatch=new PostgresDispatchFeed(devices);
  const grantIssuer=new PostgresShiftGrantIssuer({devices,locationConsents,privateKey:materials.issuerKey,keyId:c.issuer.key_id,issuer:c.issuer.issuer,audience:c.issuer.audience});
  const admin=new PostgresAdministration({devices,loadAuthAccount:createAdminAuthAccountReader({url:c.auth.origin,serverKey:c.auth.server_key,fetchImpl:fetchBound})}),escalations=new PostgresEscalations({devices,audience:c.issuer.audience});
  let receiver=null,inbox=null;
  if(c.dashboard_receiver){inbox=new PostgresDashboardInbox(pool,{authorizeCommit:client=>assertConfiguredDeploymentIdentity(client,identity)});receiver={observations:createDashboardInboxHandler({...c.dashboard_receiver,inbox,loadMapping:scope=>inbox.get(scope)}),media:createDashboardMediaHandler({...c.dashboard_receiver,inbox})};}
  const application=createGuardApplication({configuration:{deployment_id:c.deployment_id,public_origin:c.public_origin,auth:c.auth,issuer:c.issuer,allow_local_auth:false,receiver_enabled:receiver!==null,mail_recipients:c.mail_recipients},pool,directory,devices,grantIssuer,store,dispatch,shiftLifecycle,admin,escalations,locationConsents,receiver,fetchImpl:fetchBound});
  const workerDevices=Object.create(devices);workerDevices.scheduledAfter=async(...args)=>{await requireDeployment();return devices.scheduledAfter(...args);};
  const checkIns=createCheckInWorker({store,devices:workerDevices,shiftLifecycle,batchSize:c.workers.batch_size});
  const bindings=new PostgresDashboardBindings(devices),outbox=new PostgresDashboardOutbox(devices),media=new PostgresDashboardMedia(devices);
  const delivery=c.dashboard_delivery?{observations:createDashboardRouter({...c.dashboard_delivery,fetchImpl:fetchBound}),media:createDashboardMediaRouter({...c.dashboard_delivery,fetchImpl:fetchBound})}:null;
  const bridge=createDashboardBridge({store,bindings,outbox,shiftLifecycle,batchSize:c.workers.batch_size,send:delivery?async job=>{await requireDeployment();return delivery.observations(job);}:null});
  let ops=null;
  if(c.ops_refresh){const approved=new PostgresOpsBindingStore(pool),source=createOpsSourceReader(c.ops_refresh,{fetchImpl:fetchBound}),sync=new PostgresOpsAssignmentSync(devices);ops=createOpsRefreshWorker({loadBindings:async()=>{await requireDeployment();return approved.list();},readShifts:async ids=>{await requireDeployment();return source(ids);},sync:{apply:async(...args)=>{await requireDeployment();return sync.apply(...args);},revokeBinding:async(...args)=>{await requireDeployment();return sync.revokeBinding(...args);}},directory});}
  const track=operation=>{active.add(operation);void operation.finally(()=>active.delete(operation)).catch(()=>{});return operation;};
  const runtime={
   check(){if(closed)return Promise.reject(Error('Netlify runtime closed'));return track((async()=>{await assertConfiguredDatabase(pool,identity);await application.assertConfiguration();if(closed)throw Error('Netlify runtime closed');return {status:'configuration_verified',origin:c.public_origin,deployment_id:c.deployment_id};})());},
   handle(request){if(closed)return Promise.resolve(unavailable());return track((async()=>{try{await requireDeployment();}catch{return unavailable();}return application.handle(request);})());},
   runWorkersOnce({maxDurationMs=c.workers.max_duration_ms}={}){
    if(closed)return Promise.reject(Error('Netlify runtime closed'));if(!Number.isSafeInteger(maxDurationMs)||maxDurationMs<1||maxDurationMs>c.workers.max_duration_ms)return Promise.reject(Error('Bounded Netlify worker duration required'));
    if(workerRun)return Promise.resolve({status:'busy',completed:false});
    const budget={deadline:clock()+maxDurationMs,expired:false};
    workerRun=budgetContext.run(budget,()=>pool.withWorkerLock(async()=>{
     const progress={check_ins:null,ops:null,bridge:null,media:'disabled',staging_cleanup:{source:null,receiver:null}};
     try{
      await requireDeployment();progress.check_ins=await checkIns.run();checkBudget(clock);
      if(ops){await requireDeployment();progress.ops=await ops.run();checkBudget(clock);}
      await requireDeployment();progress.bridge=await bridge.run();checkBudget(clock);
      if(delivery?.media){await requireDeployment();progress.media=await deliverDashboardMediaOnce(media,async job=>{const p=JSON.parse(job.body),m=await bindings.get({assignmentId:p.assignment_id,guardId:p.guard_id,vendorId:p.vendor_id,siteId:p.site_id});if(!m?.active||m.revision!==p.mapping_revision||m.destination!==p.destination||m.dashboardShiftId!==p.dashboard_shift_id)throw Error('Original media mapping unavailable');await requireDeployment();return delivery.media(job);});checkBudget(clock);}
      if(typeof store.cleanupPhotoChunks==='function'){await requireDeployment();progress.staging_cleanup.source=await store.cleanupPhotoChunks(Date.now(),40);checkBudget(clock);}
      if(typeof inbox?.cleanupPhotoChunks==='function'){await requireDeployment();progress.staging_cleanup.receiver=await inbox.cleanupPhotoChunks(Date.now(),40);checkBudget(clock);}
      const failed=(progress.check_ins?.failed??0)+(progress.ops?.failed??0)+(progress.bridge?.failed??0)+(progress.bridge?.delivery==='pending'?1:0)+(progress.media==='pending'?1:0);
      return {status:failed?'incomplete':'completed',completed:failed===0,...progress};
     }catch{return {status:budget.expired||clock()>=budget.deadline?'timed_out':'incomplete',completed:false,...progress};}
    })).catch(()=>({status:budget.expired||clock()>=budget.deadline?'timed_out':'incomplete',completed:false})).finally(()=>{workerRun=null;});return track(workerRun);
   },
   status:()=>({closed,worker_running:workerRun!==null,ops_enabled:ops!==null,delivery_enabled:delivery!==null,receiver_enabled:receiver!==null,mail_recipient_count:c.mail_recipients.length}),
   close(){if(closing)return closing;closed=true;closing=(async()=>{await Promise.allSettled([...active]);await pool.end();})();return closing;}
  };
  await runtime.check();return runtime;
 }catch{await pool.end();throw Error('Netlify Guard startup failed; no fallback was selected');}
}
