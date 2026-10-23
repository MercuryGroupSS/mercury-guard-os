import {strictJson} from './verify-batch.mjs';
import {escalationExact,escalationMaxRequestBytes,EscalationInputError,EscalationAuthError,EscalationDeniedError,EscalationConflictError,EscalationNotFoundError} from './escalation-input.mjs';
const paths=new Set(['/v1/escalations','/v1/escalations/status']);
const headers={'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
const reply=(status,value,extra={})=>new Response(JSON.stringify(value),{status,headers:{...headers,...extra}});
const tooLarge=Symbol('escalation_body_too_large');
async function readBody(request,max){
 const reader=request.body?.getReader();if(!reader)throw new EscalationInputError('Escalation body required');
 try{const chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();return tooLarge;}chunks.push(Buffer.from(value));}return strictJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}finally{reader.releaseLock();}
}
export function createEscalationHandler({verifySession,store,now=Date.now}){
 if(typeof verifySession!=='function'||['receive','status'].some(k=>typeof store?.[k]!=='function'))throw Error('Protected escalation dependencies required');
 return async request=>{
  const url=new URL(request.url);if(!paths.has(url.pathname))return reply(404,{error:'not_found'});if(request.method!=='POST')return reply(405,{error:'method_not_allowed'},{allow:'POST'});
  if(url.search)return reply(400,{error:'invalid_escalation_request'});
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return reply(415,{error:'json_required'});
  const auth=request.headers.get('authorization')??'',token=auth.length<=16384?/^Bearer ([^\s]+)$/.exec(auth)?.[1]:null;if(!token)return reply(401,{error:'authentication_required'});
  let session;try{session=await verifySession(token);if(!session||session.active!==true||!Number.isSafeInteger(session.expiresAt)||session.expiresAt*1000<=now())return reply(401,{error:'authentication_required'});}catch{return reply(503,{error:'escalation_authorization_unavailable'});}
  try{
   let value;try{value=await readBody(request,url.pathname==='/v1/escalations'?escalationMaxRequestBytes:4096);}catch{return reply(400,{error:'invalid_escalation_request'});}if(value===tooLarge)return reply(413,{error:'escalation_body_too_large'});
   if(url.pathname==='/v1/escalations'){escalationExact(value,['intent','proof']);return reply(200,await store.receive(session,value.intent,value.proof));}
   escalationExact(value,['escalation_id','proof']);const result=await store.status(session,value.escalation_id,value.proof);return result?reply(200,result):reply(404,{error:'escalation_unavailable'});
  }catch(error){
   if(error instanceof EscalationAuthError)return reply(401,{error:'authentication_required'});
   if(error instanceof EscalationDeniedError)return reply(403,{error:'escalation_access_unavailable'});
   if(error instanceof EscalationConflictError)return reply(409,{error:'escalation_request_conflict'});
   if(error instanceof EscalationNotFoundError)return reply(404,{error:'escalation_unavailable'});
   if(error instanceof EscalationInputError)return reply(400,{error:'invalid_escalation_request'});
   return reply(503,{error:'escalation_service_unavailable'});
  }
 };
}
