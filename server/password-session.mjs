import {createSupabaseSessionVerifier} from './supabase-session.mjs';
// Backend-only exchange. Never persist passwords or forward refresh tokens to site phones.
export function createPasswordSession({url,publishableKey,allowLocal=false,fetchImpl=fetch,now=()=>Math.floor(Date.now()/1000),loadSession,includeRefresh=false}){
 const verify=createSupabaseSessionVerifier({url,publishableKey,allowLocal,fetchImpl,now,loadSession});
 const base=new URL(url).origin;
 return async ({email,password,subject})=>{
  const response=await fetchImpl(base+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:publishableKey,'content-type':'application/json'},body:JSON.stringify({email,password}),redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!response.ok)return null;
  const session=await response.json();
  const checked=await verify(session.access_token);
  if(!checked||checked.subject!==subject)return null;
  if(includeRefresh&&(typeof session.refresh_token!=='string'||!session.refresh_token||session.refresh_token.length>16384||/\s/.test(session.refresh_token)))return null;
  return {access_token:session.access_token,expires_at:checked.expiresAt,...(includeRefresh?{refresh_token:session.refresh_token}:{})};
 };
}

// Called only by the approved personal-device protocol. Parent-token retries
// remain recoverable through Auth's normal rotation semantics. No token is logged.
export function createRefreshSession({url,publishableKey,allowLocal=false,fetchImpl=fetch,now,loadSession}){
 const verify=createSupabaseSessionVerifier({url,publishableKey,allowLocal,fetchImpl,now,loadSession}),base=new URL(url).origin;
 return async refresh_token=>{
  const response=await fetchImpl(base+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:publishableKey,'content-type':'application/json'},body:JSON.stringify({refresh_token}),redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!response.ok){if(response.status>=500)throw Error('Auth temporarily unavailable');return null;}const result=await response.json(),checked=await verify(result.access_token);
  if(!checked||typeof result.refresh_token!=='string'||!result.refresh_token||result.refresh_token.length>16384||/\s/.test(result.refresh_token))return null;
  return {access_token:result.access_token,expires_at:checked.expiresAt,refresh_token:result.refresh_token};
 };
}
