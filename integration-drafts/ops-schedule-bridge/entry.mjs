// DRAFT ONLY: build into one function for review in the existing Ops project.
// It is not part of Guard's deployed function directory and is not auto-installed.
import {createOpsScheduleBridge} from '../../server/ops-schedule-bridge.mjs';
import {createOpsShiftReader} from '../../server/ops-shift-reader.mjs';
import {strictJson} from '../../server/verify-batch.mjs';

const OPS_ORIGIN='https://dyctehllmjryjwvrmxdw.supabase.co';
const unavailable=()=>new Response('{"error":"schedule_bridge_unavailable"}',{status:503,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
// Existing Ops SUPABASE_SERVICE_ROLE_KEY is consumed in-place on that server.
// It never leaves Ops and is never placed in Guard, Android, logs or a response.
export function createOpsScheduleEntrypoint({get,fetchImpl=fetch}){
 return async(request,context)=>{
  try{
   const c=strictJson(get('MERCURY_GUARD_SCHEDULE_CONFIG')??'');
   if(!c||Object.keys(c).sort().join()!=='allow_history,allowed_ids,public_origin,site_id,version'||c.version!==1||!(/^[a-f0-9-]{36}$/).test(c.site_id)||context?.site?.id!==c.site_id||context?.deploy?.context!=='production')return unavailable();
   if(get('SUPABASE_URL')!==OPS_ORIGIN)return unavailable();
   const serverKey=get('SUPABASE_SERVICE_ROLE_KEY');
   const handle=createOpsScheduleBridge({publicOrigin:c.public_origin,token:get('MERCURY_GUARD_SCHEDULE_TOKEN'),allowedIds:c.allowed_ids,allowHistory:c.allow_history,readShifts:(ids,{historyFallback})=>createOpsShiftReader({url:OPS_ORIGIN,serverKey,historyFallback,fetchImpl})(ids)});
   return await handle(request);
  }catch{return unavailable();}
 };
}
// This is a Node Function, so credentials come from process.env, as in the
// existing Ops functions. Netlify.env is the separate Edge runtime API.
export default (request,context)=>createOpsScheduleEntrypoint({get:name=>process.env[name]})(request,context);
