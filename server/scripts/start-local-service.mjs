import {DashboardOutbox} from '../dashboard-delivery.mjs';
import {DashboardBindings,createDashboardBridge} from '../dashboard-bridge.mjs';
import {ShiftGrantIssuer} from '../shift-grant-issuer.mjs';
import {localIssuerKey} from '../local-issuer-key.mjs';
import {LocalDeviceAssignments} from '../local-device-assignments.mjs';
import {LocalGuardDirectory} from '../local-guard-directory.mjs';
import {readFileSync,mkdirSync} from 'node:fs';
import {createLocalService} from '../local-service.mjs';
import {DurableIngest} from '../durable-ingest.mjs';
const root=new URL('../../',import.meta.url);
const lines=readFileSync(new URL('supabase-start.log',root),'utf8').split('\n');
const config=JSON.parse(lines.findLast(l=>l.startsWith('{')&&l.includes('API_URL')));
const dir=new URL('.local-backend/',root);mkdirSync(dir,{recursive:true,mode:0o700});
const store=new DurableIngest(new URL('events.sqlite',dir).pathname);
const directory=new LocalGuardDirectory(new URL('directory.sqlite',dir).pathname);
const devices=new LocalDeviceAssignments(new URL('devices.sqlite',dir).pathname);
const grantIssuer=new ShiftGrantIssuer({path:new URL('grants.sqlite',dir).pathname,privateKey:localIssuerKey(new URL('issuer-private.pem',dir)),keyId:'local-v1',issuer:'mercury-local',audience:'mercury-local'});
const dashboardOutbox=new DashboardOutbox(new URL('dashboard-outbox.sqlite',dir).pathname);
const dashboardBindings=new DashboardBindings(new URL('dashboard-bindings.sqlite',dir).pathname);
// No send function is configured: explicit mappings can queue records locally only.
const dashboardBridge=createDashboardBridge({store,bindings:dashboardBindings,outbox:dashboardOutbox});
const service=createLocalService({config,store,directory,devices,grantIssuer});
try {console.log('Local synthetic-data ingestion service: '+await service.start());}
catch(error){dashboardOutbox.close();dashboardBindings.close();store.close();directory.close();devices.close();grantIssuer.close();throw error;}
let bridgeRun=null;
function pumpBridge(){if(bridgeRun)return;bridgeRun=dashboardBridge.run().catch(()=>console.error('Local dashboard projection failed; source records retained.')).finally(()=>{bridgeRun=null;});}
pumpBridge();const bridgeTimer=setInterval(pumpBridge,30000);bridgeTimer.unref();
// Report aggregate scheduler failures without printing guard identities or credentials.
let reportedFailures=0;
const healthTimer=setInterval(()=>{const status=service.schedulerStatus();if(status&&status.totalFailures>reportedFailures){reportedFailures=status.totalFailures;console.error('Check-in scheduler recorded failures: '+JSON.stringify(status));}},60000);
healthTimer.unref();
let stopping=false;
async function stop(){if(stopping)return;stopping=true;clearInterval(healthTimer);clearInterval(bridgeTimer);await bridgeRun;await service.stop();dashboardOutbox.close();dashboardBindings.close();store.close();directory.close();devices.close();grantIssuer.close();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
