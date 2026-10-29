import {createOpsShiftReader} from './ops-shift-reader.mjs';
import {createOpsScheduleBridgeReader} from './ops-schedule-bridge.mjs';

export function createOpsSourceReader(config,{fetchImpl=fetch}={}){
 if(config?.transport==='schedule_bridge')return createOpsScheduleBridgeReader({url:config.origin,token:config.schedule_token,historyFallback:config.history_fallback??false,fetchImpl});
 if(Object.hasOwn(config??{},'transport'))throw Error('Unsupported Ops source transport');
 return createOpsShiftReader({url:config.origin,serverKey:config.server_key,historyFallback:config.history_fallback??false,fetchImpl});
}
