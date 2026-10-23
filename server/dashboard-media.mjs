import {createHash,timingSafeEqual} from 'node:crypto';import {strictJson} from './verify-batch.mjs';import {photoMetadata} from './photo-metadata.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function dashboardPhoto(value){
 if(value?.source!=='mercury_one'||value.version!==1||value.observation?.kind!=='photo_evidence'||!/^[a-f0-9]{64}$/.test(value.delivery_id??''))throw Error('Stored photo observation required');
 const meta=photoMetadata({...value.observation.data,capture:'camera_intent'});return {...meta,delivery_id:value.delivery_id,destination:value.destination,event_id:value.observation.event_id};
}
export function dashboardMediaReceipt(value){const p=dashboardPhoto(value);return {delivery_id:p.delivery_id,destination:p.destination,event_id:p.event_id,evidence_id:p.evidence_id,sha256:p.sha256,bytes:p.bytes,status:'media_stored_in_integration_inbox'};}
export function validateDashboardMediaReceipt(receipt,body){const expected=dashboardMediaReceipt(strictJson(body));if(!receipt||Object.keys(receipt).sort().join()!==Object.keys(expected).sort().join()||Object.keys(expected).some(k=>receipt[k]!==expected[k]))throw Error('Media receipt mismatch');}
export function validateDashboardMediaJob(job){
 if(typeof job?.body!=='string'||Buffer.byteLength(job.body)>64000||hash(job.body)!==job.hash)throw Error('Immutable photo observation required');const value=strictJson(job.body),meta=dashboardPhoto(value);
 if(job.id!==meta.delivery_id||!Buffer.isBuffer(job.bytes)||job.bytes.length!==meta.bytes||hash(job.bytes)!==meta.sha256)throw Error('Original photo bytes required');return meta;
}
export function createDashboardMediaTransport({endpoint,token,allowLocal=false,fetchImpl=fetch}){
 const url=new URL(endpoint);if((url.protocol!=='https:'&&!(allowLocal&&url.protocol==='http:'&&url.hostname==='127.0.0.1'))||url.username||url.password||url.search||url.hash||typeof token!=='string'||token.length<32||token.length>4096||/\s/.test(token))throw Error('Explicit secure media destination required');
 const base=url.href.replace(/\/+$/,'');
 return async job=>{
  validateDashboardMediaJob(job);const response=await fetchImpl(base+'/'+job.id,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(30000),headers:{authorization:'Bearer '+token,'content-type':'image/jpeg'},body:job.bytes});
  if(response.status!==200){await response.body?.cancel();throw Error('Photo not accepted by destination');}
  const reader=response.body?.getReader();if(!reader)throw Error('Media receipt missing');const chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();throw Error('Media receipt too large');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
  const receipt=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));validateDashboardMediaReceipt(receipt,job.body);return receipt;
 };
}
export function createDashboardMediaHandler({token,destination,inbox}){
 if(typeof token!=='string'||token.length<32||token.length>4096||/\s/.test(token)||typeof destination!=='string'||!destination||typeof inbox?.mediaMetadata!=='function'||typeof inbox?.acceptMedia!=='function')throw Error('Private media receiver configuration required');const secret=hash(token);
 const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
 return async request=>{
  const route=/^\/v1\/mercury-one\/media\/([a-f0-9]{64})$/.exec(new URL(request.url).pathname);if(!route)return reply(404,{error:'not_found'});if(request.method!=='POST')return reply(405,{error:'post_required'});
  const authorization=request.headers.get('authorization')??'';if(authorization.length>4103||!authorization.startsWith('Bearer ')||!timingSafeEqual(Buffer.from(secret,'hex'),Buffer.from(hash(authorization.slice(7)),'hex')))return reply(401,{error:'unauthorized'});
  if(request.headers.get('content-type')!=='image/jpeg')return reply(415,{error:'jpeg_required'});
  let meta;try{meta=await inbox.mediaMetadata(route[1],destination);}catch{return reply(403,{error:'media_unavailable'});}if(!meta)return reply(403,{error:'media_unavailable'});
  const reader=request.body?.getReader();if(!reader)return reply(400,{error:'body_required'});try{
   const chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>meta.bytes){await reader.cancel();return reply(413,{error:'media_too_large'});}chunks.push(Buffer.from(value));}
   return reply(200,await inbox.acceptMedia(route[1],destination,Buffer.concat(chunks)));
  }catch{return reply(400,{error:'media_rejected'});}finally{reader.releaseLock();}
 };
}
export async function deliverDashboardMediaOnce(queue,send,now=Date.now){const job=await queue.claim(now());if(!job)return 'idle';try{const receipt=await send(job);await queue.accepted(job,receipt);return 'delivered';}catch{await queue.retry(job,now());return 'pending';}}
