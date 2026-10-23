import {test} from 'node:test';import assert from 'node:assert/strict';
import {createAccountCredentials,AccountCodeError,AccountUnconfirmedError,AccountPasswordError} from './account-credentials.mjs';
const subject='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',email='person@example.invalid',token='synthetic-otp-session';
function fixture({emailResult=email,confirmed=true,updateStatus=200,failUpdate=false,logoutStatus=204,settings}={}){
 const calls=[];const credentials=createAccountCredentials({url:'https://auth.example.test',publishableKey:'sb_publishable_synthetic',verifySession:async t=>{assert.equal(t,token);calls.push({stage:'verify-session'});return {subject,active:true};},fetchImpl:async(url,options)=>{
  const path=new URL(url).pathname.replace('/auth/v1/','')+new URL(url).search,body=options.body?JSON.parse(options.body):null;calls.push({path,options,body});assert.equal(options.redirect,'error');assert.equal(options.headers.apikey,'sb_publishable_synthetic');
  if(path==='settings')return Response.json(settings??{mailer_autoconfirm:false,disable_signup:false,external:{email:true}});
  if(path==='otp')return new Response('{}');if(path==='verify')return Response.json({access_token:token,refresh_token:'never-return'});
  if(path==='user'&&options.method==='GET')return Response.json({id:subject,email:emailResult,email_confirmed_at:confirmed?'2026-10-23T00:00:00Z':null,user_metadata:{admin:true}});
  if(path==='user'&&options.method==='PUT'){if(failUpdate)throw Error('Connection lost during write');return new Response('{}',{status:updateStatus});}
  if(path.startsWith('logout'))return new Response(null,{status:path.includes('global')?logoutStatus:204});throw Error('Unexpected test route');
 }});return {calls,credentials};
}
test('email code setup and recovery use the publishable Auth API and preserve generic recovery responses',async()=>{
 const {credentials,calls}=fixture();await credentials.assertConfiguration();await credentials.sendCode(email,'setup');await credentials.sendCode(email,'recovery');assert.deepEqual(calls.filter(c=>c.path==='otp').map(c=>c.body),[{email,create_user:true},{email,create_user:false}]);
 await assert.rejects(fixture({settings:{mailer_autoconfirm:true,disable_signup:false,external:{email:true}}}).credentials.assertConfiguration(),/Confirmed-email/);
});
test('email ownership is verified before password change and all-session sign-out; no credential is returned',async()=>{
 const {credentials,calls}=fixture();const result=await credentials.setPassword(email,'12345678','Synthetic-long-password');assert.deepEqual(result,{subject,email});assert.deepEqual(calls.map(c=>c.stage??c.path),['verify','verify-session','user','user','logout?scope=global']);assert.deepEqual(calls.find(c=>c.options?.method==='PUT').body,{password:'Synthetic-long-password'});assert.equal(JSON.stringify(result).includes(token),false);
});
test('wrong or unconfirmed email cannot update a password, even when provider metadata claims an admin role',async()=>{
 for(const options of [{emailResult:'other@example.invalid'},{confirmed:false}]){const {credentials,calls}=fixture(options);await assert.rejects(credentials.setPassword(email,'12345678','Synthetic-long-password'),AccountCodeError);assert.equal(calls.some(c=>c.options?.method==='PUT'),false);assert.equal(calls.at(-1).path,'logout?scope=local');}
});
test('password write timeouts and failed global sign-out stay unconfirmed; rejected passwords stay distinguishable',async()=>{
 for(const options of [{failUpdate:true},{logoutStatus:503}]){const {credentials,calls}=fixture(options);await assert.rejects(credentials.setPassword(email,'12345678','Synthetic-long-password'),AccountUnconfirmedError);assert.equal(calls.at(-1).path,'logout?scope=local');}
 await assert.rejects(fixture({updateStatus:422}).credentials.setPassword(email,'12345678','Synthetic-long-password'),AccountPasswordError);
});
