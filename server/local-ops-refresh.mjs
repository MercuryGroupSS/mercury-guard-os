import {OpsBindingStore} from './ops-binding-store.mjs';
import {createOpsShiftReader} from './ops-shift-reader.mjs';
import {createOpsRefreshWorker} from './ops-refresh-worker.mjs';
// Opt-in composition only; never discovers or approves bindings from display names.
export function openLocalOpsRefresh({mode='off',config,source,bindingsPath,sync,directory,intervalMs=30000,fetchImpl=fetch,schedule=setInterval,cancel=clearInterval}){
 if(config?.API_URL!=='http://127.0.0.1:55321'||!['off','local','remote'].includes(mode))throw Error('Explicit local Ops refresh mode required');
 if(mode==='off')return {start:async()=>{},run:async()=>null,status:()=>({enabled:false}),close:async()=>{}};
 let readShifts;
 if(mode==='local'){
  if(source)throw Error('Local Ops mode does not accept source overrides');
  readShifts=createOpsShiftReader({url:config.API_URL,serverKey:config.SERVICE_ROLE_KEY,allowLocal:true,fetchImpl});
 }else{
  if(!source||new URL(source.url).protocol!=='https:')throw Error('Explicit HTTPS Ops source required');
  readShifts=createOpsShiftReader({url:source.url,serverKey:source.serverKey,fetchImpl});
 }
 const bindings=new OpsBindingStore(bindingsPath);
 try{
  const worker=createOpsRefreshWorker({loadBindings:()=>bindings.list(),readShifts,sync,directory,intervalMs,schedule,cancel});
  let closed=false;
  return {async start(){if(closed)throw Error('Ops refresh closed');worker.start();return worker.run();},
   run(){if(closed)throw Error('Ops refresh closed');return worker.run();},
   status:()=>({enabled:true,mode,...worker.status()}),
   async close(){if(closed)return;closed=true;await worker.stop();bindings.close();}};
 }catch(error){bindings.close();throw error;}
}
