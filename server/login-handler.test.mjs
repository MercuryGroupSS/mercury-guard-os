import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LocalGuardDirectory} from './local-guard-directory.mjs';
import {createLoginHandler} from './login-handler.mjs';
function setup(){const d=new LocalGuardDirectory(':memory:');d.addVendor({vendorId:'vendor',kind:'company',active:true});d.addGuard({guardId:'guard',authSubject:'user',vendorId:'vendor',active:true});d.setLoginEmail('guard','guard@example.invalid');return d;}
const req=(guard_id='guard',password='correct')=>new Request('https://guard.test/v1/session/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({guard_id,password})});
test('guard ID login resolves server mapping and gives generic credential failures',async()=>{
 const directory=setup();try{
  let calls=0;const h=createLoginHandler({directory,now:()=>1000,passwordSession:async a=>{calls++;assert.equal(a.email,'guard@example.invalid');assert.equal(a.subject,'user');return a.password==='correct'?{access_token:'token',expires_at:200}:null;}});
  assert.equal((await h(req())).status,200);assert.equal((await h(req('guard','wrong'))).status,401);assert.equal((await h(req('unknown'))).status,401);assert.equal(calls,2);
  directory.setGuardActive('guard',false);assert.equal((await h(req())).status,401);
 }finally{directory.close();}
});
test('attempt budget limits valid and invalid credentials and resets after window',async()=>{
 const directory=setup();let at=1000,calls=0;try{
  const h=createLoginHandler({directory,now:()=>at,passwordSession:async()=>{calls++;return null;}});
  for(let n=0;n<5;n++)assert.equal((await h(req())).status,401);
  assert.equal((await h(req())).status,429);assert.equal(calls,5);at+=300000;assert.equal((await h(req())).status,401);
 }finally{directory.close();}
});
test('deactivation during credential verification prevents session disclosure',async()=>{
 const directory=setup();try{
  const h=createLoginHandler({directory,passwordSession:async()=>{directory.setGuardActive('guard',false);return {access_token:'secret',expires_at:200};}});
  const result=await h(req());assert.equal(result.status,401);assert.equal((await result.text()).includes('secret'),false);
 }finally{directory.close();}
});
test('global limit bounds account-bucket allocation under ID spraying',()=>{
 const d=setup();try{
  for(let i=0;i<100;i++)assert.equal(d.consumeLoginAttempt('id-'+i,1000),true);
  for(let i=100;i<1000;i++)assert.equal(d.consumeLoginAttempt('id-'+i,1000),false);
  assert.equal(d.db.prepare('SELECT count(*) AS n FROM login_attempts').get().n,101);
 }finally{d.close();}
});
