import {accountRequest,validatePassword} from './model.mjs';
const $=id=>document.getElementById(id);let email='',intent='setup',busy=false,generation=0;
function notice(message,error=false){$('notice').textContent=message;$('notice').dataset.error=String(error);}
function clearPrivate(){for(const id of ['code','password','confirm-password'])$(id).value='';$('show-password').checked=false;$('password').type='password';$('confirm-password').type='password';}
function lock(value){busy=value;for(const id of ['send-code','save-password','resend-code','change-email','start-over','email','intent','code','password','confirm-password','show-password'])$(id).disabled=value;}
function reset(){generation++;email='';intent='setup';clearPrivate();$('intent').value='setup';$('email').value='';$('account-id').textContent='';$('complete-email').textContent='';$('target-email').textContent='';$('complete').hidden=true;$('password-form').hidden=true;$('code-form').hidden=false;lock(false);$('email').focus();}
async function sendCode(){
 if(busy)return;const ticket=generation;let sent=false;email=$('email').value.trim().toLowerCase();intent=$('intent').value;lock(true);notice('Requesting a verification code…');
 try{await accountRequest('/v1/account/code',{email,intent});if(ticket!==generation)return;clearPrivate();$('target-email').textContent=email;$('code-form').hidden=true;$('password-form').hidden=false;notice('If this email is eligible, a code has been sent. Check your inbox.');sent=true;}catch(error){if(ticket===generation)notice(error.message,true);}finally{if(ticket===generation){lock(false);if(sent)$('code').focus();}}
}
$('code-form').addEventListener('submit',event=>{event.preventDefault();sendCode();});$('resend-code').addEventListener('click',()=>{clearPrivate();sendCode();});
$('change-email').addEventListener('click',()=>{if(busy)return;generation++;clearPrivate();$('password-form').hidden=true;$('code-form').hidden=false;notice('Enter the email for your individual account.');$('email').focus();});
$('show-password').addEventListener('change',()=>{const type=$('show-password').checked?'text':'password';$('password').type=type;$('confirm-password').type=type;});
$('password-form').addEventListener('submit',async event=>{
 event.preventDefault();if(busy)return;const code=$('code').value,password=$('password').value;try{validatePassword(code,password,$('confirm-password').value);}catch(error){notice(error.message,true);return;}
 const ticket=generation;clearPrivate();lock(true);notice('Verifying ownership and saving your password…');
 try{const result=await accountRequest('/v1/account/password',{email,code,password});if(ticket!==generation)return;$('password-form').hidden=true;$('complete').hidden=false;$('complete-email').textContent=result.email;$('account-id').textContent=result.account_id;notice('Password saved. Sign in again to continue.');$('notice').focus();}
 catch(error){if(ticket===generation)notice(error.message,true);}finally{if(ticket===generation){clearPrivate();lock(false);}}
});
$('start-over').addEventListener('click',()=>{reset();notice('Enter the next account email.');});window.addEventListener('pagehide',()=>{reset();notice('For your privacy, credentials were cleared. Start again to continue.');});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')clearPrivate();});
