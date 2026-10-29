import {readConfiguredFile} from './configured-service-config.mjs';
import {assertConfiguredDeploymentIdentity} from './configured-database.mjs';
import {strictJson} from './verify-batch.mjs';
import {PostgresDashboardInbox} from './postgres-dashboard-inbox.mjs';
import {createDashboardInboxHandler} from './dashboard-inbox.mjs';
import {createDashboardMediaHandler} from './dashboard-media.mjs';

// A separate integration credential never grants administrator or guard access.
export function readConfiguredReceiver(config){
 if(config.dashboard_receiver==null)return null;
 try{
  const value=strictJson(readConfiguredFile(config.dashboard_receiver.configuration_path,{maxBytes:16384}).toString('utf8'));
  if(!value||Object.keys(value).sort().join()!=='destination,token,version'||value.version!==1||
   typeof value.destination!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value.destination)||
   typeof value.token!=='string'||!(/^[\x21-\x7e]{32,4096}$/).test(value.token)||
   [config.auth.publishable_key,config.auth.server_key,config.ops_refresh?.server_key,config.ops_refresh?.schedule_token].includes(value.token))throw Error();
  return {destination:value.destination,token:value.token};
 }catch{throw Error('Configured receiver private configuration invalid');}
}
export function createConfiguredReceiver({config,pool,identity}){
 const settings=readConfiguredReceiver(config);if(settings===null)return null;
 const inbox=new PostgresDashboardInbox(pool,{authorizeCommit:client=>assertConfiguredDeploymentIdentity(client,identity)});
 return {observations:createDashboardInboxHandler({...settings,inbox,loadMapping:scope=>inbox.get(scope)}),media:createDashboardMediaHandler({...settings,inbox}),cleanupPhotoChunks:(now,limit)=>inbox.cleanupPhotoChunks(now,limit)};
}
