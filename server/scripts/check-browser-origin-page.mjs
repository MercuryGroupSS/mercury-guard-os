import {accountRequest,validatePassword} from '/account/model.mjs';
import {AdminClient} from '/admin/model.mjs';

const email='browser-fixture@example.invalid',password='Synthetic browser passphrase 45';
const button=document.getElementById('run'),output=document.getElementById('result');
let running=false,stage='inherited_baseline';
const requireResult=(value,code)=>{if(!value)throw Error(code);};
async function run(){
 if(running)return;running=true;button.disabled=true;output.textContent='Running synthetic browser checks…';
 let report;
 try{
  // Deliberately inherit the actual no-referrer response policy. Observe the
  // engine-generated baseline; never assign an Origin header manually.
  const baseline=await fetch('/v1/account/code',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,intent:'setup'}),credentials:'omit',cache:'no-store',mode:'same-origin',redirect:'error'});
  requireResult([202,403].includes(baseline.status),'inherited_baseline');await baseline.body?.cancel();
  stage='explicit_baseline';
  const explicit=await fetch('/v1/account/code',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,intent:'setup'}),credentials:'omit',cache:'no-store',mode:'same-origin',referrerPolicy:'no-referrer',redirect:'error'});
  requireResult([202,403].includes(explicit.status),stage);await explicit.body?.cancel();
  stage='account_code';const code=await accountRequest('/v1/account/code',{email,intent:'setup'});
  requireResult(code.status==='check_email'&&code.code_length===8,stage);
  stage='account_password';validatePassword('12345678',password,password);
  const saved=await accountRequest('/v1/account/password',{email,code:'12345678',password});
  requireResult(saved.status==='password_set'&&saved.sign_in_required===true,stage);
  const client=new AdminClient();stage='admin_login';await client.login(email,password);
  requireResult(client.session!==null,stage);
  const envelope={request_id:'33333333-3333-4333-8333-333333333333',action:'guard.status',reason:'Synthetic browser-origin regression only',payload:{guard_id:'synthetic-browser-guard',active:true}};
  stage='admin_action';const applied=await client.request('/v1/admin/actions',{method:'POST',body:envelope});
  requireResult(applied.status==='applied'&&applied.request_id===envelope.request_id,stage);
  stage='admin_resolve';const resolved=await client.request('/v1/admin/resolve',{method:'POST',body:envelope});
  requireResult(resolved.status==='applied'&&resolved.request_id===envelope.request_id,stage);
  stage='admin_logout';const signingOut=client.logout();requireResult(client.session===null,stage);
  requireResult(await signingOut==='signed_out',stage);
  report={status:'passed',stage:'complete'};
 }catch{report={status:'failed',stage};}
 try{
  const response=await fetch('/__browser/complete',{method:'POST',mode:'same-origin',referrerPolicy:'same-origin',credentials:'omit',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify(report)});
  const result=await response.json();output.textContent=JSON.stringify(result,null,2);document.body.dataset.status=result.status;
 }catch{output.textContent='Browser regression result could not be confirmed.';document.body.dataset.status='failed';}
}
button.addEventListener('click',run);
if(location.search==='?autorun=1')void run();
