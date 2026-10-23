const reply=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
async function emptyBody(request){
 if(request.headers.has('content-length')&&request.headers.get('content-length')!=='0')return false;
 if(!request.body)return true;
 const reader=request.body.getReader();let timer;
 try{
  const result=await Promise.race([reader.read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Body did not finish')),1000);})]);
  return result.done===true;
 }finally{clearTimeout(timer);reader.cancel().catch(()=>{});reader.releaseLock();}
}
// A self-service Auth operation, deliberately independent of roster/admin roles.
// The trusted server configuration fixes the provider; a request never chooses it.
export function createSessionLogoutHandler({url,publishableKey,verifySession,allowLocal=false,fetchImpl=fetch,now=()=>Math.floor(Date.now()/1000)}){
 const base=new URL(url);
 if(base.username||base.password||base.search||base.hash||base.pathname!=='/'||(base.protocol!=='https:'&&!(allowLocal&&base.origin==='http://127.0.0.1:55321'))||typeof publishableKey!=='string'||!publishableKey||publishableKey.length>16384||/\s/.test(publishableKey)||publishableKey.startsWith('sb_secret_')||typeof verifySession!=='function')throw Error('Trusted session logout configuration required');
 return async request=>{
  const incoming=new URL(request.url);
  if(incoming.pathname!=='/v1/session/logout')return reply(404,{error:'not_found'});
  if(request.method!=='POST')return reply(405,{error:'method_not_allowed'});
  if(incoming.search)return reply(400,{error:'invalid_request'});
  try{if(!await emptyBody(request))return reply(400,{error:'invalid_request'});}catch{return reply(400,{error:'invalid_request'});}
  const header=request.headers.get('authorization')??'',token=header.length<=16391?/^Bearer ([^\s]+)$/.exec(header)?.[1]:null;
  if(!token||token.length>16384)return reply(401,{error:'authentication_required'});
  let session;
  try{session=await verifySession(token);}catch{return reply(503,{error:'sign_out_unavailable'});}
  if(!session||session.active!==true||typeof session.subject!=='string'||!session.subject||!Number.isSafeInteger(session.expiresAt)||session.expiresAt<=now())return reply(401,{error:'authentication_required'});
  try{
   const response=await fetchImpl(base.origin+'/auth/v1/logout?scope=local',{method:'POST',headers:{apikey:publishableKey,authorization:'Bearer '+token},redirect:'error',credentials:'omit',signal:AbortSignal.timeout(5000)});
   response.body?.cancel().catch(()=>{});
   return response.status===204?reply(200,{status:'signed_out'}):[401,403].includes(response.status)?reply(401,{error:'authentication_required'}):reply(503,{error:'sign_out_unavailable'});
  }catch{return reply(503,{error:'sign_out_unavailable'});}
 };
}
