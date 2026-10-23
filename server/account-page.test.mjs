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
