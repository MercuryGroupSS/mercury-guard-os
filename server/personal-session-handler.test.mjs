import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,sign,randomUUID} from 'node:crypto';
import {createPersonalSessionHandler,personalLoginMessage,personalRefreshMessage} from './personal-session.mjs';
function fixture(){
 const key=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey,pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),spki=pair.publicKey.export({type:'spki',format:'der'}),subject=randomUUID(),sessionId=randomUUID(),thumb=createHash('sha256').update(spki).digest('hex'),now=1700000000000;
 let active=true,guardActive=true,ambiguous=false,device={deviceId:'phone',mode:'personal',guardId:'guard',active:true,revoked:false,thumbprint:thumb,publicKeySpki:spki.toString('base64url'),revocationVersion:0},provider=0,renew=0,afterPassword=()=>{},afterRefresh=()=>{},providerUnavailable=false;
 const principal={subject,sessionId,active:true,expiresAt:now/1000+3600};
 const directory={consumeLoginAttempt:async()=>true,loginAccount:async()=>guardActive?{subject,email:'guard@example.invalid'}:null,loadGuardsForSubject:async()=>ambiguous?[]:[{guardId:'guard',authSubject:subject,vendorId:'company',active:guardActive}],loadVendor:async()=>({vendorId:'company',kind:'company',active:true})};
 const challenge={audience:'test',request_id:randomUUID(),challenge:'x'.repeat(43),expires_at:now+60000};
 const devices={device:async()=>device,challenge:async()=>challenge,consumePersonalChallenge:async()=>{}};
 const h=createPersonalSessionHandler({directory,devices,pool:{query:async()=>({rows:[{active}]})},grantIssuer:{key,keyId:'test',issuer:'test',audience:'test'},origin:'https://guard.test',now:()=>now,verifySession:async token=>token==='access'?principal:null,passwordSession:async()=>{provider++;afterPassword();return {access_token:'access',refresh_token:'original-private-fixture'};},refreshSession:async()=>{renew++;if(providerUnavailable)throw Error('Unavailable');afterRefresh();return {access_token:'access',refresh_token:'rotated-private-fixture'};}});
 const call=async(path,body,extras={})=>{const r=await h(new Request('https://guard.test/v1/session/personal/'+path,{method:'POST',headers:{'content-type':'application/json',...extras.headers},body:JSON.stringify(body)}));return {status:r.status,data:await r.json()};};
 const loginBody=()=>{const issued_at_ms=now,request_id=randomUUID();return {guard_id:'guard',password:'private-fixture',device_id:'phone',proof:{issued_at_ms,request_id,thumbprint:thumb,signature_der:sign('sha256',Buffer.from(personalLoginMessage('test','guard','phone',issued_at_ms,request_id,thumb)),pair.privateKey).toString('base64url')}};};
 return {call,loginBody,device:()=>device,principal,counts:()=>({provider,renew}),set:fn=>fn({setActive:v=>active=v,setGuard:v=>guardActive=v,setAmbiguous:v=>ambiguous=v,afterPassword:fn=>afterPassword=fn,afterRefresh:fn=>afterRefresh=fn,unavailable:()=>providerUnavailable=true}),async login(){const r=await call('login',loginBody());assert.equal(r.status,200);return r.data;},async body(credentials){const c=await call('challenge',{permit:credentials.permit});assert.equal(c.status,200);return {permit:credentials.permit,refresh_token:credentials.refresh_token,proof:{request_id:challenge.request_id,challenge:challenge.challenge,signature_der:sign('sha256',Buffer.from(personalRefreshMessage('test',challenge.request_id,challenge.challenge,thumb,credentials.permit,credentials.refresh_token)),pair.privateKey).toString('base64url')}};}};
}
test('only current personal guard plus installation proof can obtain a return credential',async()=>{
 for(const mutate of [f=>f.device().mode='site',f=>f.device().guardId='other',f=>f.device().revoked=true,f=>f.set(s=>s.setAmbiguous(true))]){const f=fixture();mutate(f);const r=await f.call('login',f.loginBody());assert.equal(r.status,401);assert.equal('refresh_token'in r.data,false);}
 const f=fixture(),body=f.loginBody();body.proof.signature_der='bad';assert.equal((await f.call('login',body)).status,401);assert.equal(f.counts().provider,0);
});
test('personal login rechecks provider session, account and approval after password exchange',async()=>{
 for(const race of [f=>f.device().revocationVersion++,f=>f.device().mode='site',f=>f.set(s=>s.setActive(false)),f=>f.set(s=>s.setGuard(false))]){const f=fixture();f.set(s=>s.afterPassword(()=>race(f)));assert.equal((await f.call('login',f.loginBody())).status,401);}
});
test('refresh credential is bound to its signed generation before Auth is contacted',async()=>{
 const f=fixture(),credentials=await f.login(),body=await f.body(credentials);body.refresh_token='other-session-private-fixture';assert.equal((await f.call('refresh',body)).status,401);assert.equal(f.counts().renew,0);
 f.set(s=>s.setActive(false));assert.equal((await f.call('challenge',{permit:credentials.permit})).status,401);
});
test('refresh rechecks individual, device and exact session after asynchronous provider work',async()=>{
 for(const race of [f=>f.device().revoked=true,f=>f.device().revocationVersion++,f=>f.set(s=>s.setActive(false)),f=>f.principal.sessionId=randomUUID()]){const f=fixture(),credentials=await f.login(),body=await f.body(credentials);f.set(s=>s.afterRefresh(()=>race(f)));assert.equal((await f.call('refresh',body)).status,401);}
});
test('transient provider failure is unavailable, distinct from a revoked saved credential',async()=>{
 const f=fixture(),body=await f.body(await f.login());f.set(s=>s.unavailable());assert.equal((await f.call('refresh',body)).status,503);
});
test('caller flags, stale proofs, query parameters and bearer confusion never select personal identity',async()=>{
 const f=fixture();assert.equal((await f.call('login',{...f.loginBody(),biometric_verified:true})).status,400);
 const stale=f.loginBody();stale.proof.issued_at_ms-=60001;assert.equal((await f.call('login',stale)).status,400);
 assert.equal((await f.call('login?mode=personal',f.loginBody())).status,400);
 assert.equal((await f.call('login',f.loginBody(),{headers:{authorization:'Bearer private-fixture'}})).status,400);
 assert.equal(f.counts().provider,0);
});
