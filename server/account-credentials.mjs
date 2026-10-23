export class AccountCodeError extends Error{}
export class AccountPasswordError extends Error{}
export class AccountUnavailableError extends Error{}
export class AccountUnconfirmedError extends Error{}
// The publishable Auth API handles credentials. No server-role key, password,
// OTP, access token or refresh token is persisted by this adapter.
export function createAccountCredentials({url,publishableKey,verifySession,allowLocal=false,fetchImpl=fetch}){
 const base=new URL(url);
 if(base.username||base.password||base.search||base.hash||base.pathname!=='/'||(base.protocol!=='https:'&&!(allowLocal&&base.origin==='http://127.0.0.1:55321'))||typeof publishableKey!=='string'||!publishableKey||typeof verifySession!=='function')throw Error('Trusted account configuration required');
 const request=(path,body,token,method='POST')=>fetchImpl(base.origin+'/auth/v1/'+path,{method,headers:{apikey:publishableKey,...(body?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(5000)});
 return {
  async assertConfiguration(){
   let response;try{response=await request('settings',null,null,'GET');}catch{throw new AccountUnavailableError();}if(!response.ok)throw new AccountUnavailableError();const settings=await response.json();
   if(settings.mailer_autoconfirm!==false||settings.external?.email!==true||settings.disable_signup!==false)throw Error('Confirmed-email account configuration required');
  },
  async sendCode(email,intent){
   let response;try{response=await request('otp',{email,create_user:intent==='setup'});}catch{throw new AccountUnavailableError();}
   // Never disclose whether a recovery email has a registered account.
   if(response.status===429||response.status>=500)throw new AccountUnavailableError();
   if(!response.ok&&response.status!==400&&response.status!==422)throw new AccountUnavailableError();
  },
  async setPassword(email,code,password){
   let token=null,updateAttempted=false;
   try{
    const verified=await request('verify',{email,token:code,type:'email'});if(!verified.ok){if([400,401,403,422].includes(verified.status))throw new AccountCodeError();throw new AccountUnavailableError();}
    const result=await verified.json();token=result.access_token;delete result.refresh_token;
    if(typeof token!=='string'||!token||token.length>16384)throw new AccountUnavailableError();
    const session=await verifySession(token);if(!session?.active)throw new AccountCodeError();
    const current=await request('user',null,token,'GET');if(!current.ok)throw new AccountCodeError();const user=await current.json();
    if(user.id!==session.subject||user.email?.toLowerCase()!==email||!Number.isFinite(Date.parse(user.email_confirmed_at)))throw new AccountCodeError();
    updateAttempted=true;const update=await request('user',{password},token,'PUT');if(!update.ok){if([400,422].includes(update.status))throw new AccountPasswordError();throw new AccountUnconfirmedError();}
    const logout=await request('logout?scope=global',null,token);if(!logout.ok)throw new AccountUnconfirmedError();
    token=null;return {subject:session.subject,email};
   }catch(error){if(error instanceof AccountCodeError||error instanceof AccountPasswordError||error instanceof AccountUnavailableError||error instanceof AccountUnconfirmedError)throw error;throw updateAttempted?new AccountUnconfirmedError():new AccountUnavailableError();}
   finally{if(token){try{await request('logout?scope=local',null,token);}catch{/* Best effort cleanup of a server-only OTP session. */}token=null;}}
  }
 };
}
