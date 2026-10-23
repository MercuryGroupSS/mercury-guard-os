import {createSupabaseSessionVerifier} from './supabase-session.mjs';
// Backend-only exchange. Never persist passwords or forward refresh tokens to site phones.
export function createPasswordSession({url,publishableKey,allowLocal=false,fetchImpl=fetch,now=()=>Math.floor(Date.now()/1000),loadSession}){
 const verify=createSupabaseSessionVerifier({url,publishableKey,allowLocal,fetchImpl,now,loadSession});
 const base=new URL(url).origin;
 return async ({email,password,subject})=>{
  const response=await fetchImpl(base+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:publishableKey,'content-type':'application/json'},body:JSON.stringify({email,password}),redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!response.ok)return null;
  const session=await response.json();
  const checked=await verify(session.access_token);
  if(!checked||checked.subject!==subject)return null;
  return {access_token:session.access_token,expires_at:checked.expiresAt};
 };
}
