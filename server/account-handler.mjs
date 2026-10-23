import {createHash} from 'node:crypto';import {strictJson} from './verify-batch.mjs';
import {AccountCodeError,AccountPasswordError,AccountUnconfirmedError} from './account-credentials.mjs';
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function accountBody(request){
 if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw Error('JSON required');const reader=request.body?.getReader();if(!reader)throw Error('Body required');
 try{const chunks=[];let size=0;while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>4096){await reader.cancel();throw Error('Body too large');}chunks.push(Buffer.from(r.value));}return strictJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}finally{reader.releaseLock();}
}
export function createAccountHandler({credentials,consumeAttempt,now=Date.now}){
 if(typeof credentials?.sendCode!=='function'||typeof credentials?.setPassword!=='function'||typeof consumeAttempt!=='function')throw Error('Account dependencies required');
 return async request=>{
  const url=new URL(request.url),path=url.pathname;
  if(!['/v1/account/code','/v1/account/password'].includes(path))return reply(404,{error:'not_found'});if(request.method!=='POST')return reply(405,{error:'method_not_allowed'});if(url.search)return reply(400,{error:'invalid_request'});
  let body;
  try{body=await accountBody(request);const keys=path.endsWith('/code')?['email','intent']:['email','code','password'];if(!body||Array.isArray(body)||Object.keys(body).sort().join()!==keys.sort().join()||typeof body.email!=='string'||body.email.length>254||!/^\S+@\S+\.\S+$/.test(body.email))throw Error('Invalid fields');body.email=body.email.toLowerCase();
   if(path.endsWith('/code')){if(!['setup','recovery'].includes(body.intent))throw Error('Intent required');}
   else if(typeof body.code!=='string'||!/^\d{8}$/.test(body.code)||typeof body.password!=='string'||[...body.password].length<12||[...body.password].length>128||Buffer.byteLength(body.password)>1024||!body.password.trim()||/[\u0000-\u001f]/.test(body.password))return reply(400,{error:'invalid_password_or_code'});
  }catch{return reply(400,{error:'invalid_request'});}
  try{
   const bucket=createHash('sha256').update('account-portal:'+body.email).digest('hex');if(!await consumeAttempt(bucket))return reply(429,{error:'try_again_later'});
   if(path.endsWith('/code')){await credentials.sendCode(body.email,body.intent);return reply(202,{status:'check_email',code_length:8,expires_in_seconds:600});}
   const account=await credentials.setPassword(body.email,body.code,body.password);return reply(200,{status:'password_set',account_id:account.subject,email:account.email,sign_in_required:true,server_time_ms:now()});
  }catch(error){return error instanceof AccountCodeError?reply(400,{error:'code_not_accepted'}):error instanceof AccountPasswordError?reply(400,{error:'password_not_accepted'}):error instanceof AccountUnconfirmedError?reply(503,{error:'password_outcome_unconfirmed'}):reply(503,{error:'account_service_unavailable'});}
  finally{if(body&&typeof body==='object'){body.password='';body.code='';}}
 };
}
