import {openLocalOpsRefresh} from '../local-ops-refresh.mjs';
import {PostgresShiftLifecycle} from '../postgres-shift-lifecycle.mjs';
import {ShiftLifecycle} from '../shift-lifecycle.mjs';
import {PostgresDispatchFeed} from '../postgres-dispatch-feed.mjs';
import {DispatchFeed} from '../dispatch-feed.mjs';
import {PostgresAdministration} from '../postgres-administration.mjs';
import {createAdminAuthAccountReader} from '../admin-auth-account.mjs';
import {PostgresDashboardBindings,PostgresDashboardOutbox} from '../postgres-dashboard-delivery.mjs';
import {DashboardOutbox} from '../dashboard-delivery.mjs';
import {openDashboardDelivery} from '../dashboard-delivery-config.mjs';
import {DashboardBindings,createDashboardBridge} from '../dashboard-bridge.mjs';
import {PostgresShiftGrantIssuer} from '../postgres-shift-grant-issuer.mjs';
import {ShiftGrantIssuer} from '../shift-grant-issuer.mjs';
import {localIssuerKey} from '../local-issuer-key.mjs';
import {openLocalAssignmentStore} from '../local-assignment-factory.mjs';
import {openLocalGuardDirectory} from '../local-directory-factory.mjs';
import {readFileSync,mkdirSync} from 'node:fs';
import {createLocalService} from '../local-service.mjs';
import {PostgresDurableIngest} from '../postgres-durable-ingest.mjs';
import {DurableIngest} from '../durable-ingest.mjs';
const root=new URL('../../',import.meta.url);
const lines=readFileSync(new URL('supabase-start.log',root),'utf8').split('\n');
const config=JSON.parse(lines.findLast(l=>l.startsWith('{')&&l.includes('API_URL')));
const dir=new URL('.local-backend/',root);mkdirSync(dir,{recursive:true,mode:0o700});
const identityMode=process.env.MERCURY_IDENTITY_STORE??'postgres';
// Read before opening stores: invalid delivery configuration fails closed.
if(identityMode!=='postgres'&&(process.env.MERCURY_DASHBOARD_DELIVERY??'off')!=='off')throw Error('Dashboard delivery requires PostgreSQL mode');
const dashboardSend=openDashboardDelivery({mode:process.env.MERCURY_DASHBOARD_DELIVERY??'off',path:process.env.MERCURY_DASHBOARD_DELIVERY_CONFIG});
const directory=await openLocalGuardDirectory({config,mode:identityMode,sqlitePath:new URL('directory.sqlite',dir).pathname});
let assignmentStore;
try{assignmentStore=await openLocalAssignmentStore({mode:identityMode,directory,sqlitePath:new URL('devices.sqlite',dir).pathname});}catch(error){await directory.close();throw error;}
const {devices}=assignmentStore;
let opsRefresh;
try{opsRefresh=openLocalOpsRefresh({mode:process.env.MERCURY_OPS_REFRESH??'off',config,source:process.env.MERCURY_OPS_REFRESH==='remote'?{url:process.env.MERCURY_OPS_URL,serverKey:process.env.MERCURY_OPS_SERVER_KEY}:undefined,bindingsPath:new URL('ops-bindings.sqlite',dir).pathname,sync:assignmentStore.sync,directory});}catch(error){await assignmentStore.close();await directory.close();throw error;}
const store=identityMode==='postgres'?new PostgresDurableIngest(devices):new DurableIngest(new URL('events.sqlite',dir).pathname);
const GrantIssuer=identityMode==='postgres'?PostgresShiftGrantIssuer:ShiftGrantIssuer;
const grantIssuer=new GrantIssuer({devices,path:new URL('grants.sqlite',dir).pathname,privateKey:localIssuerKey(new URL('issuer-private.pem',dir)),keyId:'local-v1',issuer:'mercury-local',audience:'mercury-local'});
const dashboardOutbox=identityMode==='postgres'?new PostgresDashboardOutbox(devices):new DashboardOutbox(new URL('dashboard-outbox.sqlite',dir).pathname);
const dashboardBindings=identityMode==='postgres'?new PostgresDashboardBindings(devices):new DashboardBindings(new URL('dashboard-bindings.sqlite',dir).pathname);
const dispatch=identityMode==='postgres'?new PostgresDispatchFeed(devices):new DispatchFeed(new URL('dispatch.sqlite',dir).pathname);
const shiftLifecycle=identityMode==='postgres'?new PostgresShiftLifecycle(devices):new ShiftLifecycle(new URL('shifts.sqlite',dir).pathname);
const dashboardBridge=createDashboardBridge({store,bindings:dashboardBindings,outbox:dashboardOutbox,shiftLifecycle,send:dashboardSend});
const admin=identityMode==='postgres'?new PostgresAdministration({devices,loadAuthAccount:createAdminAuthAccountReader({url:config.API_URL,serverKey:config.SERVICE_ROLE_KEY,allowLocal:true})}):null;
const service=createLocalService({config,store,directory,devices,grantIssuer,dispatch,shiftLifecycle,admin});
try {console.log('Local synthetic-data ingestion service ('+identityMode+' identity/assignments): '+await service.start());await opsRefresh.start();console.log('Ops refresh: '+JSON.stringify(opsRefresh.status()));}
catch(error){await opsRefresh.close();shiftLifecycle.close();dispatch.close();dashboardOutbox.close();dashboardBindings.close();store.close();await assignmentStore.close();await directory.close();grantIssuer.close();throw error;}
let bridgeRun=null;
function pumpBridge(){if(bridgeRun)return;bridgeRun=dashboardBridge.run().catch(()=>console.error('Local dashboard projection failed; source records retained.')).finally(()=>{bridgeRun=null;});}
pumpBridge();const bridgeTimer=setInterval(pumpBridge,30000);bridgeTimer.unref();
// Report aggregate scheduler failures without printing guard identities or credentials.
let reportedFailures=0;
const healthTimer=setInterval(()=>{const status=service.schedulerStatus();if(status&&status.totalFailures>reportedFailures){reportedFailures=status.totalFailures;console.error('Check-in scheduler recorded failures: '+JSON.stringify(status));}const ops=opsRefresh.status();if(ops.enabled&&ops.failed>0)console.error('Ops refresh failures; prior assignments retained: '+JSON.stringify(ops));},60000);
healthTimer.unref();
let stopping=false;
async function stop(){if(stopping)return;stopping=true;clearInterval(healthTimer);clearInterval(bridgeTimer);await bridgeRun;await opsRefresh.close();await service.stop();shiftLifecycle.close();dispatch.close();dashboardOutbox.close();dashboardBindings.close();store.close();await assignmentStore.close();await directory.close();grantIssuer.close();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
