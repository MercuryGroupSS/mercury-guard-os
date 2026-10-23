export function createAdminAuthAccountReader({url,serverKey,allowLocal=false,fetchImpl=fetch}){
 const base=new URL(url);
 if(base.username||base.password||base.search||base.hash||base.pathname!=='/'||(base.protocol!=='https:'&&!(allowLocal&&base.origin==='http://127.0.0.1:55321'))||typeof serverKey!=='string'||!serverKey||serverKey.length>16384||/\s/.test(serverKey))throw Error('Trusted Auth administration configuration required');
 const headers={apikey:serverKey,...(!serverKey.startsWith('sb_secret_')?{authorization:'Bearer '+serverKey}:{})};
 return async subject=>{
  if(typeof subject!=='string'||!/^[a-f0-9-]{36}$/i.test(subject))throw Error('Auth subject required');
  const response=await fetchImpl(base.origin+'/auth/v1/admin/users/'+subject,{headers,redirect:'error',signal:AbortSignal.timeout(5000)});
  if(response.status===404)return null;if(!response.ok)throw Error('Auth account unavailable');
  const user=await response.json();if(user.id!==subject||typeof user.email!=='string')return null;
  return {subject:user.id,email:user.email.toLowerCase(),confirmed:Number.isFinite(Date.parse(user.email_confirmed_at)),enabled:!user.banned_until||Date.parse(user.banned_until)<=Date.now()};
 };
}
