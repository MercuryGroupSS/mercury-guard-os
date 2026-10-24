// Netlify is the TLS terminator. Authority comes from its supplied Context and
// the configured canonical URL, never from forwarded or caller-supplied headers.
import {performance} from 'node:perf_hooks';
export const NETLIFY_BODY_LIMIT=4*1024*1024;
const discarded=['forwarded','x-forwarded-host','x-forwarded-proto','x-original-url','x-rewrite-url'];
const denied=(status,error)=>Response.json({error},{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','strict-transport-security':'max-age=31536000'}});
const contextMatches=(config,context)=>config?.platform?.deployment_context==='production'&&typeof config?.platform?.site_id==='string'&&context?.site?.id===config.platform.site_id&&context?.deploy?.context==='production';
function contentLength(headers){
 const v=headers.get('content-length');
 if(v===null)return null;
 if(!/^(0|[1-9][0-9]*)$/.test(v)||!Number.isSafeInteger(Number(v)))throw Error('Invalid length');
 return Number(v);
}
function cancelQuietly(target){try{void Promise.resolve(target?.cancel()).catch(()=>{});}catch{}}
const readError=kind=>Object.assign(Error('Bounded body unavailable'),{kind});
async function readBounded(body,limit,{signal,timeoutMs}){
 if(signal?.aborted)throw readError('unavailable');
 if(body===null)return new Uint8Array(0);
 const reader=body.getReader(),parts=[];let size=0,stopped=false,rejectStop;
 const interruption=new Promise((_,reject)=>{rejectStop=reject;});void interruption.catch(()=>{});
 const stop=()=>{if(stopped)return;stopped=true;cancelQuietly(reader);rejectStop(readError('unavailable'));};
 const timer=setTimeout(stop,timeoutMs);signal?.addEventListener('abort',stop,{once:true});
 try{
  if(signal?.aborted)stop();
  while(true){if(stopped)throw readError('unavailable');const {done,value}=await Promise.race([reader.read(),interruption]);if(stopped)throw readError('unavailable');if(done)break;if(!(value instanceof Uint8Array))throw readError('unavailable');size+=value.byteLength;if(size>limit){cancelQuietly(reader);throw readError('size');}parts.push(value);}
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);try{reader.releaseLock();}catch{}}
 const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.byteLength;}return bytes;
}
async function boundedResponse(response,readOptions){
 if(!(response instanceof Response))return denied(503,'service_unavailable');
 let length;
 try{length=contentLength(response.headers);}catch{return denied(502,'response_unavailable');}
 if(length!==null&&length>NETLIFY_BODY_LIMIT){cancelQuietly(response.body);return denied(502,'response_requires_ranges');}
 let bytes;try{bytes=await readBounded(response.body,NETLIFY_BODY_LIMIT,readOptions);}catch(error){return denied(502,error?.kind==='size'?'response_requires_ranges':'response_unavailable');}
 if(length!==null&&length!==bytes.byteLength)return denied(502,'response_unavailable');
 const headers=new Headers(response.headers);
 headers.set('cache-control','no-store');headers.set('x-content-type-options','nosniff');headers.set('referrer-policy','no-referrer');headers.set('strict-transport-security','max-age=31536000');
 return new Response([204,205,304].includes(response.status)?null:bytes,{status:response.status,headers});
}

// One instance per deployed function module. Concurrent initialization shares one
// promise. A rejected initialization can be retried; no credentials are logged.
export function createNetlifyIngress({loadConfiguration,openRuntime,clock=()=>performance.now(),ioTimeoutMs=5000}){
 if(typeof loadConfiguration!=='function'||typeof openRuntime!=='function'||!Number.isSafeInteger(ioTimeoutMs)||ioTimeoutMs<1||ioTimeoutMs>5000)throw Error('Explicit bounded Netlify dependencies required');
 let configuration,runtimePromise;
 function load(){return configuration??=(loadConfiguration());}
 async function runtime(){
  if(!runtimePromise){const {config,materials}=load();runtimePromise=Promise.resolve().then(()=>openRuntime(config,materials)).catch(()=>{runtimePromise=null;throw Error('Service unavailable');});}
  return runtimePromise;
 }
 return {
  async api(request,context){
   let config;try{({config}=load());}catch{return denied(503,'service_unavailable');}
   if(!contextMatches(config,context))return denied(503,'deployment_unavailable');
   let u;try{u=new URL(request.url);}catch{return denied(421,'origin_unavailable');}
   const suppliedHost=request.headers.get('host');
   if(u.origin!==config.public_origin||u.username||u.password||u.hash||request.url.length>4096||(suppliedHost!==null&&suppliedHost.toLowerCase()!==u.host))return denied(421,'origin_unavailable');
   const origin=request.headers.get('origin');if(origin!==null&&origin!==config.public_origin)return denied(403,'origin_denied');
   if(!['GET','HEAD','POST'].includes(request.method))return denied(405,'method_not_allowed');
   let expected;try{expected=contentLength(request.headers);}catch{return denied(400,'invalid_body');}
   if(expected!==null&&expected>NETLIFY_BODY_LIMIT){cancelQuietly(request.body);return denied(413,'request_requires_chunks');}
   const readOptions={signal:request.signal,timeoutMs:ioTimeoutMs};
   let bytes;try{bytes=await readBounded(request.body,NETLIFY_BODY_LIMIT,readOptions);}catch(error){return denied(error?.kind==='size'?413:408,error?.kind==='size'?'request_requires_chunks':'request_body_unavailable');}
   if(expected!==null&&expected!==bytes.byteLength)return denied(400,'invalid_body');
   const headers=new Headers(request.headers);for(const h of discarded)headers.delete(h);
   let response;
   try{
    const normalized=new Request(request.url,{method:request.method,headers,signal:request.signal,...(['GET','HEAD'].includes(request.method)?{}:{body:bytes})});
    response=await(await runtime()).handle(normalized);
   }catch{return denied(503,'service_unavailable');}
   return boundedResponse(response,readOptions);
  },
  async scheduled(request,context){
   const started=clock();
   let config;try{({config}=load());}catch{return denied(503,'service_unavailable');}
   if(!contextMatches(config,context))return denied(503,'deployment_unavailable');
   // This entry point is exported only as a scheduled function, with no path.
   // Netlify prevents URL invocation; the trusted platform Context is mandatory.
   try{
    const service=await runtime(),remaining=Math.floor(25000-(clock()-started));
    if(remaining<1)return denied(503,'worker_budget_exhausted');
    const result=await service.runWorkersOnce({maxDurationMs:Math.min(config.workers.max_duration_ms,remaining)});
    return Response.json(result,{status:result?.status==='busy'?200:result?.timed_out===true||result?.completed===false?503:200,headers:{'cache-control':'no-store'}});
   }
   catch{return denied(503,'worker_unavailable');}
  }
 };
}
