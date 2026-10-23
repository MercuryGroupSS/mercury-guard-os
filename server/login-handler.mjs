import {createHash} from 'node:crypto';
import {strictJson} from './verify-batch.mjs';
export function createLoginHandler({directory,passwordSession,now=Date.now}){
 const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
 return async request=>{
  if(new URL(request.url).pathname!=='/v1/session/login')return reply(404,{error:'not_found'});
  if(request.method!=='POST')return reply(405,{error:'method_not_allowed'});
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return reply(415,{error:'json_required'});
  const reader=request.body?.getReader();if(!reader)return reply(400,{error:'invalid_request'});
  let body;
  try{
   const chunks=[];let size=0;
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();return reply(413,{error:'body_too_large'});}chunks.push(Buffer.from(value));}
   body=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
   if(!body||Object.keys(body).sort().join()!=='guard_id,password'||typeof body.guard_id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(body.guard_id)||typeof body.password!=='string'||body.password.length<1||body.password.length>1024)throw Error('Invalid request');
  }catch{return reply(400,{error:'invalid_request'});}
  finally{reader.releaseLock();}
  try{
   const bucket=createHash('sha256').update(body.guard_id).digest('hex');
   if(!directory.consumeLoginAttempt(bucket,now()))return reply(429,{error:'try_again_later'});
   const account=directory.loginAccount(body.guard_id);
   if(!account)return reply(401,{error:'sign_in_failed'});
   const result=await passwordSession({...account,password:body.password});
   // Recheck the mapping after asynchronous authentication in case access changed.
   const current=directory.loginAccount(body.guard_id);
   if(!result||!current||current.subject!==account.subject||current.email!==account.email)return reply(401,{error:'sign_in_failed'});
   return reply(200,{...result,server_time_ms:now()});
  }catch{return reply(503,{error:'sign_in_unavailable'});}
  finally{body.password='';}
 };
}
