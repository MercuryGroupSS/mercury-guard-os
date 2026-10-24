import {createHash,timingSafeEqual} from 'node:crypto';import {strictJson} from './verify-batch.mjs';import {photoMetadata} from './photo-metadata.mjs';
import {PHOTO_CHUNK_BYTES,photoChunkSize,photoHash,validatePhotoChunk,readPhotoBody} from './photo-chunks.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function dashboardPhoto(value){
 if(value?.source!=='mercury_one'||value.version!==1||value.observation?.kind!=='photo_evidence'||!/^[a-f0-9]{64}$/.test(value.delivery_id??''))throw Error('Stored photo observation required');
 const meta=photoMetadata({...value.observation.data,capture:'camera_intent'});return {...meta,delivery_id:value.delivery_id,destination:value.destination,event_id:value.observation.event_id};
}
export function dashboardMediaReceipt(value){const p=dashboardPhoto(value);return {delivery_id:p.delivery_id,destination:p.destination,event_id:p.event_id,evidence_id:p.evidence_id,sha256:p.sha256,bytes:p.bytes,status:'media_stored_in_integration_inbox'};}
export function dashboardMediaChunkReceipt(meta,index,bytes){return {delivery_id:meta.delivery_id,destination:meta.destination,event_id:meta.event_id,evidence_id:meta.evidence_id,sha256:meta.sha256,bytes:meta.bytes,chunk_index:index,chunk_sha256:validatePhotoChunk(meta,index,bytes),chunk_bytes:bytes.length,status:'media_chunk_retained_in_integration_inbox'};}
export function dashboardMediaStatus(meta,rows,receipt=null){
 if(receipt!==null){const expected={delivery_id:meta.delivery_id,destination:meta.destination,event_id:meta.event_id,evidence_id:meta.evidence_id,sha256:meta.sha256,bytes:meta.bytes,status:'media_stored_in_integration_inbox'};if(!receipt||Object.keys(receipt).sort().join()!==Object.keys(expected).sort().join()||Object.keys(expected).some(key=>receipt[key]!==expected[key]))throw Error('Stored final media receipt mismatch');}
 const chunks=rows.map(row=>{if(validatePhotoChunk(meta,Number(row.chunk_index),row.bytes)!==row.sha256)throw Error('Stored receiver chunk integrity failed');return {chunk_index:Number(row.chunk_index),sha256:row.sha256,bytes:row.bytes.length};});
 return {delivery_id:meta.delivery_id,destination:meta.destination,event_id:meta.event_id,evidence_id:meta.evidence_id,sha256:meta.sha256,bytes:meta.bytes,chunk_size:PHOTO_CHUNK_BYTES,chunks,receipt,status:'media_transfer_status'};
}
function validateMediaStatus(value,meta,body){
 const expected={delivery_id:meta.delivery_id,destination:meta.destination,event_id:meta.event_id,evidence_id:meta.evidence_id,sha256:meta.sha256,bytes:meta.bytes,chunk_size:PHOTO_CHUNK_BYTES,status:'media_transfer_status'};
 if(!value||Object.keys(value).sort().join()!==[...Object.keys(expected),'chunks','receipt'].sort().join()||Object.keys(expected).some(key=>value[key]!==expected[key])||!Array.isArray(value.chunks)||value.chunks.length>Math.ceil(meta.bytes/PHOTO_CHUNK_BYTES))throw Error('Original media progress mismatch');
 const chunks=new Map();for(const row of value.chunks){if(!row||Object.keys(row).sort().join()!=='bytes,chunk_index,sha256'||chunks.has(row.chunk_index)||photoChunkSize(meta,row.chunk_index)!==row.bytes||!(/^[a-f0-9]{64}$/).test(row.sha256))throw Error('Invalid media progress');chunks.set(row.chunk_index,row);}
 if(value.receipt!==null)validateDashboardMediaReceipt(value.receipt,body);return {chunks,receipt:value.receipt};
}
export function validateDashboardMediaReceipt(receipt,body){const expected=dashboardMediaReceipt(strictJson(body));if(!receipt||Object.keys(receipt).sort().join()!==Object.keys(expected).sort().join()||Object.keys(expected).some(k=>receipt[k]!==expected[k]))throw Error('Media receipt mismatch');}
export function validateDashboardMediaJob(job){
 if(typeof job?.body!=='string'||Buffer.byteLength(job.body)>64000||hash(job.body)!==job.hash)throw Error('Immutable photo observation required');const value=strictJson(job.body),meta=dashboardPhoto(value);
 if(job.id!==meta.delivery_id||!Buffer.isBuffer(job.bytes)||job.bytes.length!==meta.bytes||hash(job.bytes)!==meta.sha256)throw Error('Original photo bytes required');return meta;
}
export function createDashboardMediaTransport({endpoint,token,allowLocal=false,fetchImpl=fetch}){
 const url=new URL(endpoint);if((url.protocol!=='https:'&&!(allowLocal&&url.protocol==='http:'&&url.hostname==='127.0.0.1'))||url.username||url.password||url.search||url.hash||typeof token!=='string'||token.length<32||token.length>4096||/\s/.test(token))throw Error('Explicit secure media destination required');
 const base=url.href.replace(/\/+$/,'');
 return async job=>{
  const meta=validateDashboardMediaJob(job);
  if(job.bytes.length>PHOTO_CHUNK_BYTES){
   const response=await fetchImpl(base+'/'+job.id+'/status',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(30000),headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:'{}'});
   if(response.status!==200){await response.body?.cancel();throw Error('Media progress unavailable');}
   const progress=validateMediaStatus(strictJson(new TextDecoder('utf-8',{fatal:true}).decode(await readPhotoBody(response,8192))),meta,job.body);if(progress.receipt)return progress.receipt;
   for(let index=0;index<Math.ceil(meta.bytes/PHOTO_CHUNK_BYTES);index++){
    const bytes=job.bytes.subarray(index*PHOTO_CHUNK_BYTES,(index+1)*PHOTO_CHUNK_BYTES);if(progress.chunks.get(index)?.sha256===photoHash(bytes))continue;
    const response=await fetchImpl(base+'/'+job.id+'/chunks/'+index,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(30000),headers:{authorization:'Bearer '+token,'content-type':'application/octet-stream','x-mercury-chunk-sha256':photoHash(bytes)},body:bytes});
    if(response.status!==200){await response.body?.cancel();throw Error('Photo chunk not accepted by destination');}
    const receipt=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(await readPhotoBody(response,4096))),expected=dashboardMediaChunkReceipt(meta,index,bytes);
    if(!receipt||Object.keys(receipt).sort().join()!==Object.keys(expected).sort().join()||Object.keys(expected).some(key=>receipt[key]!==expected[key]))throw Error('Photo chunk receipt mismatch');
   }
  }
  const chunked=job.bytes.length>PHOTO_CHUNK_BYTES,response=await fetchImpl(base+'/'+job.id+(chunked?'/finalize':''),{method:'POST',redirect:'manual',signal:AbortSignal.timeout(30000),headers:{authorization:'Bearer '+token,'content-type':chunked?'application/json':'image/jpeg'},body:chunked?'{}':job.bytes});
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
  const url=new URL(request.url),route=/^\/v1\/mercury-one\/media\/([a-f0-9]{64})(?:\/(chunks)\/(0|[1-9][0-9]?)|\/(finalize|status))?$/.exec(url.pathname);if(!route)return reply(404,{error:'not_found'});if(request.method!=='POST')return reply(405,{error:'post_required'});if(url.search)return reply(400,{error:'invalid_request'});
  const authorization=request.headers.get('authorization')??'';if(authorization.length>4103||!authorization.startsWith('Bearer ')||!timingSafeEqual(Buffer.from(secret,'hex'),Buffer.from(hash(authorization.slice(7)),'hex')))return reply(401,{error:'unauthorized'});
  const chunk=route[2]==='chunks',finalize=route[4]==='finalize',status=route[4]==='status',json=finalize||status,index=chunk?Number(route[3]):null;
  if(request.headers.get('content-type')!==(chunk?'application/octet-stream':json?'application/json':'image/jpeg'))return reply(415,{error:'content_type_required'});
  if((chunk||finalize)&&(typeof inbox.acceptMediaChunk!=='function'||typeof inbox.finalizeMediaChunks!=='function'))return reply(501,{error:'chunk_transfer_unavailable'});
  if(status&&typeof inbox.mediaStatus!=='function')return reply(501,{error:'chunk_transfer_unavailable'});
  let meta;try{meta=await inbox.mediaMetadata(route[1],destination);}catch{return reply(403,{error:'media_unavailable'});}if(!meta)return reply(403,{error:'media_unavailable'});
  let max=meta.bytes;try{if(chunk)max=photoChunkSize(meta,index);if(json)max=128;}catch{return reply(400,{error:'chunk_index_invalid'});}
  const reader=request.body?.getReader();if(!reader)return reply(400,{error:'body_required'});try{
   const chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();return reply(413,{error:'media_too_large'});}chunks.push(Buffer.from(value));}
   const bytes=Buffer.concat(chunks);
   if(chunk&&(bytes.length!==max||photoHash(bytes)!==request.headers.get('x-mercury-chunk-sha256')))return reply(400,{error:'chunk_digest_mismatch'});
   if(json){const input=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).length)return reply(400,{error:'invalid_finalization'});}
   return reply(200,chunk?await inbox.acceptMediaChunk(route[1],destination,index,bytes):finalize?await inbox.finalizeMediaChunks(route[1],destination):status?await inbox.mediaStatus(route[1],destination):await inbox.acceptMedia(route[1],destination,bytes));
  }catch{return reply(400,{error:'media_rejected'});}finally{reader.releaseLock();}
 };
}
export async function deliverDashboardMediaOnce(queue,send,now=Date.now){const job=await queue.claim(now());if(!job)return 'idle';try{const receipt=await send(job);await queue.accepted(job,receipt);return 'delivered';}catch{await queue.retry(job,now());return 'pending';}}
