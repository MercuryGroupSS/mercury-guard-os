import {createGuardResolver} from './guard-directory.mjs';
import {strictJson} from './verify-batch.mjs';
export function createAssignmentHandler({verifySession,directory,devices,now=Date.now}){
 const resolve=createGuardResolver({loadGuardsForSubject:s=>directory.loadGuardsForSubject(s),loadVendor:id=>directory.loadVendor(id)});
 const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
 return async request=>{
  const path=new URL(request.url).pathname;
  if(!['/v1/device-challenge','/v1/assignments'].includes(path))return reply(404,{error:'not_found'});
  if(request.method!=='POST')return reply(405,{error:'method_not_allowed'});
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return reply(415,{error:'json_required'});
  const auth=request.headers.get('authorization')??'';
  const match=auth.length<=16384?/^Bearer ([^\s]+)$/.exec(auth):null;
  if(!match)return reply(401,{error:'authentication_required'});
  let identity;
  try{
   const session=await verifySession(match[1]);
   if(!session||!Number.isSafeInteger(session.expiresAt)||session.expiresAt*1000<=now())return reply(401,{error:'authentication_required'});
   identity=await resolve(session);if(!identity)return reply(403,{error:'guard_access_unavailable'});
  }catch{return reply(503,{error:'identity_unavailable'});}
  const reader=request.body?.getReader();if(!reader)return reply(400,{error:'body_required'});
  try{
   let size=0;const chunks=[];
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();return reply(413,{error:'body_too_large'});}chunks.push(Buffer.from(value));}
   const body=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
   if(path==='/v1/device-challenge'){
    if(!body||Object.keys(body).join()!=='device_id')throw Error('Invalid request');
    return reply(200,devices.challenge(identity,body.device_id,now()));
   }
   return reply(200,devices.list(identity,body,now()));
  }catch{return reply(400,{error:'device_request_rejected'});}
  finally{reader.releaseLock();}
 };
}
