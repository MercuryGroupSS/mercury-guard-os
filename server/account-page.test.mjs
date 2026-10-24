import {test} from 'node:test';import assert from 'node:assert/strict';import {accountPageResponse} from './account-page-handler.mjs';import {accountRequest,validatePassword} from './account-page/model.mjs';
test('account pages serve only public assets and deny framing, inline scripts, queries and private paths',async()=>{
 for(const path of ['/account/','/account/portal.mjs','/account/model.mjs','/account/portal.css','/account/base.css']){const r=accountPageResponse(new Request('https://guard.test'+path));assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.doesNotMatch(await r.text(),/sb_secret_|SERVICE_ROLE_KEY/);}
 for(const path of ['/account/.env','/account/../supabase-start.log','/account/?token=secret','/account/index.html'])assert.equal(accountPageResponse(new Request('https://guard.test'+path)).status,404);
});
test('account browser validation preserves passphrases and unknown write outcomes never retry automatically',async()=>{
 assert.doesNotThrow(()=>validatePassword('12345678','A long passphrase','A long passphrase'));for(const v of [['123456','A long passphrase','A long passphrase'],['12345678','short','short'],['12345678','A long passphrase','different']])assert.throws(()=>validatePassword(...v));
 let calls=0;await assert.rejects(accountRequest('/v1/account/password',{email:'person@example.invalid',code:'12345678',password:'A long passphrase'},{fetchImpl:async(path,options)=>{calls++;assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');throw Error('offline');}}),/could not be confirmed/);assert.equal(calls,1);
 await assert.rejects(accountRequest('https://untrusted.test',{}),/Invalid account request/);
});
test('account POSTs preserve browser origin under the private page no-referrer default without cookies or redirects',async()=>{
 assert.equal(accountPageResponse(new Request('https://guard.test/account/')).headers.get('referrer-policy'),'no-referrer');
 const requests=[
  ['/v1/account/code',{email:'person@example.invalid',intent:'setup'},{status:'check_email',code_length:8,expires_in_seconds:600}],
  ['/v1/account/password',{email:'person@example.invalid',code:'12345678',password:'A long passphrase'},{status:'password_set',account_id:'synthetic-account',email:'person@example.invalid',sign_in_required:true}]
 ];
 for(const [path,body,result]of requests){
  let calls=0;
  assert.deepEqual(await accountRequest(path,body,{fetchImpl:async(target,options)=>{
   calls++;assert.equal(target,path);assert.equal(options.method,'POST');assert.equal(options.referrerPolicy,'same-origin');assert.equal(options.mode,'same-origin');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.deepEqual(options.headers,{'content-type':'application/json'});assert.equal(options.body,JSON.stringify(body));assert.ok(options.signal instanceof AbortSignal);
   return Response.json(result,{status:path.endsWith('/code')?202:200});
  }}),result);assert.equal(calls,1);
 }
});
test('origin verification rejection asks to refresh the page without blaming account details or retrying writes',async()=>{
 const message='The service could not verify this page. Refresh it and try again.';
 for(const path of ['/v1/account/code','/v1/account/password'])for(const [error,status]of [['origin_denied',403],['origin_unavailable',421]]){
  let calls=0;
  await assert.rejects(accountRequest(path,{email:'person@example.invalid'},{fetchImpl:async()=>{calls++;return Response.json({error},{status});}}),e=>e.message===message);
  assert.equal(calls,1);
 }
});
