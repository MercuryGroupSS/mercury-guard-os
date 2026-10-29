import {strictJson} from './verify-batch.mjs';
import {scheduleBridgeToken} from './ops-schedule-bridge.mjs';

export function validateOpsSourceConfig(value,{credentials=false,interval=false}={}){
 const fail=()=>{throw Error('Ops source configuration invalid');};
 if(!value||typeof value!=='object'||Array.isArray(value))fail();
 const bridge=Object.hasOwn(value,'transport');if(bridge&&value.transport!=='schedule_bridge')fail();
 const keys=['origin',...(bridge?['transport']:[]),...(credentials?[bridge?'schedule_token':'server_key']:[]),...(interval?['interval_ms']:[]),...(Object.hasOwn(value,'history_fallback')?['history_fallback']:[])];
 if(Object.keys(value).sort().join()!==keys.sort().join())fail();
 try{
  if(typeof value.origin!=='string'||value.origin.length>256)fail();const url=new URL(value.origin);
  if(url.protocol!=='https:'||url.origin!==value.origin||url.username||url.password||url.search||url.hash||url.pathname!=='/')fail();
  if(Object.hasOwn(value,'history_fallback')&&typeof value.history_fallback!=='boolean')fail();
  if(interval&&(!Number.isSafeInteger(value.interval_ms)||value.interval_ms<1000||value.interval_ms>3600000))fail();
  if(credentials){
   if(bridge)scheduleBridgeToken(value.schedule_token);
   else{
    const key=value.server_key;if(typeof key!=='string'||!key||key.length>16384||/[\u0000-\u0020\u007f]/.test(key))fail();
    if(!key.startsWith('sb_secret_')){const p=key.split('.');if(p.length!==3||p.some(v=>!v||!/^[A-Za-z0-9_-]+$/.test(v))||strictJson(Buffer.from(p[1],'base64url').toString('utf8'))?.role!=='service_role')fail();}
   }
  }
  return structuredClone(value);
 }catch{fail();}
}
