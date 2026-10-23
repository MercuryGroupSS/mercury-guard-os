import {strictJson} from './verify-batch.mjs';
// Validates every token remotely; never treats decoded claims alone as identity.
export function createSupabaseSessionVerifier({url,publishableKey,fetchImpl=fetch,now=()=>Math.floor(Date.now()/1000),allowLocal=false}) {
 const base=new URL(url);
 if(base.username||base.password||base.search||base.hash||base.pathname!=='/'||
   (base.protocol!=='https:'&&!(allowLocal&&base.origin==='http://127.0.0.1:55321'))) throw Error('Trusted Auth origin required');
 if(typeof publishableKey!=='string'||!publishableKey)throw Error('API key required');
 return async token=>{
  if(typeof token!=='string'||token.length>16384||token.split('.').length!==3)return null;
  const response=await fetchImpl(base.origin+'/auth/v1/user',{headers:{apikey:publishableKey,authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!response.ok)return null;
  const user=await response.json();
  // Auth has validated this exact token before its expiry is read.
  let claims;try{claims=strictJson(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));}catch{return null;}
  if(typeof user.id!=='string'||!user.id||claims.sub!==user.id||!Number.isSafeInteger(claims.exp)||claims.exp<=now())return null;
  return {subject:user.id,active:true,expiresAt:claims.exp};
 };
}
