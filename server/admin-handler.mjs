import {createHash} from 'node:crypto';
import {strictJson} from './verify-batch.mjs';
import {AdminDeniedError,AdminConflictError} from './postgres-administration.mjs';
const reply=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
async function body(request,max=65536){
 if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw Error('JSON required');
 const reader=request.body?.getReader();if(!reader)throw Error('Body required');
 try{let size=0;const chunks=[];while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>max){await reader.cancel();throw Error('Body too large');}chunks.push(Buffer.from(r.value));}return strictJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}finally{reader.releaseLock();}
}
export function createAdminHandler({admin,verifySession,passwordSession,now=Date.now}){
 return async request=>{
  const url=new URL(request.url),path=url.pathname,media=/^\/v1\/admin\/media\/([a-f0-9]{64})$/.exec(path);
  if(!media&&!['/v1/admin/login','/v1/admin/me','/v1/admin/catalog','/v1/admin/actions','/v1/admin/resolve'].includes(path))return reply(404,{error:'not_found'});
  if(request.method!==(media||path==='/v1/admin/me'||path==='/v1/admin/catalog'?'GET':'POST'))return reply(405,{error:'method_not_allowed'});
  if(path!=='/v1/admin/catalog'&&url.search)return reply(400,{error:'invalid_request'});
  if(path==='/v1/admin/login'){
   let input;
   try{input=await body(request,4096);}catch{return reply(400,{error:'invalid_request'});}
   try{if(!input||Object.keys(input).sort().join()!=='email,password'||typeof input.email!=='string'||input.email.length>254||!/^\S+@\S+\.\S+$/.test(input.email)||typeof input.password!=='string'||!input.password||input.password.length>1024)return reply(400,{error:'invalid_request'});
    const email=input.email.toLowerCase(),bucket=createHash('sha256').update('admin-login:'+email).digest('hex');
    if(!await admin.consumeLoginAttempt(bucket))return reply(429,{error:'try_again_later'});
    const account=await admin.loginAccount(email);if(!account)return reply(401,{error:'sign_in_failed'});
    const session=await passwordSession({...account,password:input.password}),current=await admin.loginAccount(email);
    if(!session||!current||current.subject!==account.subject||current.email!==account.email)return reply(401,{error:'sign_in_failed'});
    return reply(200,{...session,server_time_ms:now()});
   }catch{return reply(503,{error:'admin_sign_in_unavailable'});}finally{if(input&&typeof input==='object')input.password='';}
  }
  const header=request.headers.get('authorization')??'',token=header.length<=16384?/^Bearer ([^\s]+)$/.exec(header)?.[1]:null;
  if(!token)return reply(401,{error:'authentication_required'});
  let session;
  try{session=await verifySession(token);if(!session||!Number.isSafeInteger(session.expiresAt)||session.expiresAt*1000<=now())return reply(401,{error:'authentication_required'});if(!await admin.member(session))return reply(403,{error:'administrator_required'});}catch{return reply(503,{error:'admin_authorization_unavailable'});}
  try{
   if(media){const image=await admin.media(session,media[1]);if(!image)return reply(404,{error:'media_unavailable'});return new Response(image.bytes,{status:200,headers:{'content-type':'image/jpeg','content-length':String(image.bytes.length),'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','cross-origin-resource-policy':'same-origin','content-disposition':'inline'}});}
   if(path==='/v1/admin/me'){if(url.search)return reply(400,{error:'invalid_request'});return reply(200,{subject:session.subject,role:'guard_os_admin',expires_at:session.expiresAt});}
   if(path==='/v1/admin/catalog'){
    if([...url.searchParams.keys()].some(k=>!['kind','after'].includes(k))||url.searchParams.getAll('kind').length!==1||url.searchParams.getAll('after').length>1)return reply(400,{error:'invalid_request'});
    return reply(200,await admin.catalog(session,url.searchParams.get('kind'),url.searchParams.get('after')??''));
   }
   return reply(200,await (path==='/v1/admin/resolve'?admin.settle(session,await body(request)):admin.apply(session,await body(request))));
  }catch(error){return error instanceof AdminDeniedError?reply(403,{error:'administrator_required'}):error instanceof AdminConflictError?reply(409,{error:'request_id_conflict'}):reply(400,{error:'admin_request_rejected'});}
 };
}
