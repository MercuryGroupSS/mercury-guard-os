import {openConfiguredDatabase,assertConfiguredDatabase,assertConfiguredDeploymentIdentity} from './configured-database.mjs';
import {configuredDeploymentIdentity} from './configured-service-config.mjs';
import {createConfiguredApplication,createConfiguredService} from './configured-service.mjs';
import {PostgresGuardDirectory} from './postgres-guard-directory.mjs';
import {PostgresDeviceAssignments} from './postgres-device-assignments.mjs';
import {PostgresOpsAssignmentSync} from './postgres-ops-assignment-sync.mjs';
import {PostgresOpsBindingStore} from './postgres-ops-binding-store.mjs';
import {createOpsShiftReader} from './ops-shift-reader.mjs';
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
import {openDashboardDelivery} from './dashboard-delivery-config.mjs';
import {createDashboardBridge} from './dashboard-bridge.mjs';
import {PostgresDashboardMedia} from './postgres-dashboard-media.mjs';
import {deliverDashboardMediaOnce} from './dashboard-media.mjs';
import {createCheckInWorker} from './check-in-worker.mjs';
import {createConfiguredReceiver} from './configured-receiver.mjs';

// No migrations, users, memberships, mappings, issuer keys or enrollment are created here.
export async function openConfiguredRuntime(config,materials,{fetchImpl=fetch,poolFactory,schedule=setInterval,cancel=clearInterval}={}){
 const send=config.dashboard_delivery?openDashboardDelivery({mode:'on',path:config.dashboard_delivery.configuration_path,fetchImpl}):null;
 const pool=await openConfiguredDatabase(config,materials,{poolFactory});
 try{
  let timer=null,bridgeRun=null,started=false,closing=null,starting=null,shutdownRequested=false,bridgeFailures=0;
  const directory=new PostgresGuardDirectory({client:pool}),devices=new PostgresDeviceAssignments(pool,config.issuer.audience),locationConsents=new PostgresLocationConsents({devices,audience:config.issuer.audience}),store=new PostgresDurableIngest(devices,{locationConsents}),shiftLifecycle=new PostgresShiftLifecycle(devices),dispatch=new PostgresDispatchFeed(devices);
  const grantIssuer=new PostgresShiftGrantIssuer({devices,locationConsents,privateKey:materials.issuerKey,keyId:config.issuer.key_id,issuer:config.issuer.issuer, audience:config.issuer.audience});
  const admin=new PostgresAdministration({devices,loadAuthAccount:createAdminAuthAccountReader({url:config.auth.origin,serverKey:config.auth.server_key,allowLocal:config.mode==='isolated_local_pilot',fetchImpl})}),escalations=new PostgresEscalations({devices,audience:config.issuer.audience});
  const identity=configuredDeploymentIdentity(config,materials),receiver=createConfiguredReceiver({config,pool,identity});
  const application=createConfiguredApplication({config,pool,directory,devices,grantIssuer,store,dispatch,shiftLifecycle,admin,escalations,locationConsents,receiver,fetchImpl}),handle=application.handle;
  application.handle=async request=>{try{await assertConfiguredDeploymentIdentity(pool,identity);}catch{return new Response('{"error":"deployment_unavailable"}',{status:503,headers:{'content-type':'application/json','cache-control':'no-store'}});}return handle(request);};
  const requireDeployment=()=>{if(shutdownRequested)throw Error('Configured runtime stopping');return assertConfiguredDeploymentIdentity(pool,identity);},workerDevices=Object.create(devices);
  workerDevices.scheduledAfter=async(...args)=>{await requireDeployment();return devices.scheduledAfter(...args);};
  const service=createConfiguredService({config,materials,application,preflight:()=>assertConfiguredDatabase(pool,identity)}),checkIns=createCheckInWorker({store,devices:workerDevices,shiftLifecycle,schedule,cancel});
  const bindings=new PostgresDashboardBindings(devices),outbox=new PostgresDashboardOutbox(devices),media=new PostgresDashboardMedia(devices),bridge=createDashboardBridge({store,bindings,outbox,shiftLifecycle,send:send?async job=>{await requireDeployment();return send.observations(job);}:null});
  let ops=null;
  if(config.ops_refresh){const source=createOpsShiftReader({url:config.ops_refresh.origin,serverKey:config.ops_refresh.server_key,fetchImpl}),sync=new PostgresOpsAssignmentSync(devices),approved=new PostgresOpsBindingStore(pool);ops=createOpsRefreshWorker({loadBindings:async()=>{await requireDeployment();return approved.list();},readShifts:async ids=>{await requireDeployment();return source(ids);},sync:{apply:async(...args)=>{await requireDeployment();return sync.apply(...args);},revokeBinding:async(...args)=>{await requireDeployment();return sync.revokeBinding(...args);}},directory,intervalMs:config.ops_refresh.interval_ms,schedule,cancel});}
  async function pump(){
   if(bridgeRun)return bridgeRun;
   bridgeRun=(async()=>{await requireDeployment();await bridge.run();if(send?.media)await deliverDashboardMediaOnce(media,async job=>{const p=JSON.parse(job.body),m=await bindings.get({assignmentId:p.assignment_id,guardId:p.guard_id,vendorId:p.vendor_id,siteId:p.site_id});if(!m?.active||m.revision!==p.mapping_revision||m.destination!==p.destination||m.dashboardShiftId!==p.dashboard_shift_id)throw Error('Original media mapping unavailable');await requireDeployment();return send.media(job);});})().catch(()=>{bridgeFailures++;}).finally(()=>{bridgeRun=null;});return bridgeRun;
  }
  return {check:()=>service.check(),status:()=>({started,ops_enabled:ops!==null,delivery_enabled:send!==null,bridge_failures:bridgeFailures,check_ins:checkIns.status(),ops:ops?.status()??null}),
   start(){if(shutdownRequested)return Promise.reject(Error('Configured runtime closed'));if(starting)return starting;const requireOpen=()=>{if(shutdownRequested)throw Error('Configured runtime stopping');};starting=(async()=>{requireOpen();await service.start();requireOpen();await checkIns.start();requireOpen();ops?.start();requireOpen();timer=schedule(()=>pump(),config.dashboard_delivery?.interval_ms??30000);timer?.unref?.();await pump();requireOpen();started=true;return config.public_origin;})();return starting.catch(async()=>{await this.close();throw Error('Configured service startup failed');});},
   close(){if(closing)return closing;shutdownRequested=true;const draining=service.stop();closing=(async()=>{await starting?.catch(()=>{});started=false;if(timer!==null){cancel(timer);timer=null;}try{await ops?.stop();await checkIns.stop();await bridgeRun;await draining;}finally{await pool.end();}})();return closing;}
  };
 }catch{await pool.end();throw Error('Configured Guard component startup failed');}
}
