const messages={code_not_accepted:'That code was not accepted. Check the email and code, or request a new code.',password_not_accepted:'The account service did not accept that password. Request a new code and choose a different password.',invalid_password_or_code:'Use an 8-digit code and a password of 12–128 characters.',try_again_later:'Too many attempts. Wait a few minutes before trying again.',password_outcome_unconfirmed:'The password change could not be confirmed. Try signing in with your new password first. If it does not work, request a new code and reset it again.',account_service_unavailable:'The account service is unavailable. Request a new code when it is available again.'};
export function validatePassword(code,password,confirmation){
 if(!/^\d{8}$/.test(code))throw Error('Enter the 8-digit code from your email.');
 if([...password].length<12||[...password].length>128||!password.trim()||/[\u0000-\u001f]/.test(password))throw Error('Use a password of 12–128 characters.');
 if(password!==confirmation)throw Error('The two passwords do not match.');
}
export async function accountRequest(path,body,{fetchImpl=(...args)=>globalThis.fetch(...args)}={}){
 if(!['/v1/account/code','/v1/account/password'].includes(path))throw Error('Invalid account request');
 let response;
 try{response=await fetchImpl(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),credentials:'omit',cache:'no-store',mode:'same-origin',redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw Error(path.endsWith('/password')?messages.password_outcome_unconfirmed:'Connection interrupted. Try requesting a code again.');}
 let result;try{result=await response.json();}catch{throw Error(path.endsWith('/password')?messages.password_outcome_unconfirmed:'The code request could not be confirmed. Try again.');}
 if(!response.ok)throw Error(messages[result.error]??'The account request was rejected. Check your details.');
 if(path.endsWith('/password')&&(result.status!=='password_set'||typeof result.account_id!=='string'||typeof result.email!=='string'||result.sign_in_required!==true))throw Error(messages.password_outcome_unconfirmed);
 if(path.endsWith('/code')&&(result.status!=='check_email'||result.code_length!==8))throw Error('The code request could not be confirmed. Try again.');
 return result;
}
