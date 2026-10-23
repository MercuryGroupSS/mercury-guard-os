import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSessionLogoutHandler} from './session-logout-handler.mjs';
import {createSupabaseSessionVerifier} from './supabase-session.mjs';
const now=100,session={subject:'individual-account',active:true,expiresAt:200},token='verified-token';
const request=(options={})=>new Request('https://mercury.test'+(options.path??'/v1/session/logout'),{method:options.method??'POST',headers:{...(options.token===null?{}:{authorization:'Bearer '+(options.token??token)}),...(options.headers??{})},...(options.body===undefined?{}:{body:options.body})});
test('self-session logout verifies first, uses only the trusted provider and confirms only provider204',async()=>{
 const calls=[],handler=createSessionLogoutHandler({url:'https://trusted-auth.test',publishableKey:'sb_publishable_test',now:()=>now,verifySession:async value=>{calls.push('verify');assert.equal(value,token);return session;},fetchImpl:async(url,options)=>{calls.push('logout');assert.equal(url,'https://trusted-auth.test/auth/v1/logout?scope=local');assert.equal(options.method,'POST');assert.equal(options.body,undefined);assert.equal(options.headers.apikey,'sb_publishable_test');assert.equal(options.headers.authorization,'Bearer '+token);assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.ok(options.signal instanceof AbortSignal);return new Response(null,{status:204});}});
 const response=await handler(request());assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:'signed_out'});assert.deepEqual(calls,['verify','logout']);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
});
test('logout rejects query/body/method/path changes and arbitrary credentials before provider forwarding',async()=>{
 let verifies=0,forwards=0;const handler=createSessionLogoutHandler({url:'https://trusted-auth.test',publishableKey:'public',now:()=>now,verifySession:async value=>{verifies++;return value===token?session:null;},fetchImpl:async()=>{forwards++;return new Response(null,{status:204});}});
 for(const options of [{path:'/v1/session/logout?url=https://elsewhere.test'},{path:'/v1/session/logout?access_token=secret'},{body:'{}'},{body:' '},{headers:{'content-length':'1'}}])assert.equal((await handler(request(options))).status,400);
 assert.equal(verifies,0);assert.equal((await handler(request({method:'GET'}))).status,405);assert.equal((await handler(request({path:'/different'}))).status,404);
 for(const options of [{token:null},{token:'unverified'},{token:'x'.repeat(16385)},{headers:{authorization:'Basic secret'}},{headers:{authorization:'Bearer value extra'}}])assert.equal((await handler(request(options))).status,401);
 assert.equal(forwards,0);
});
test('invalid, inactive, expired and unavailable verification never trigger provider logout',async()=>{
 let value=null,forwarded=0,unavailable=false;const handler=createSessionLogoutHandler({url:'https://trusted-auth.test',publishableKey:'public',now:()=>now,verifySession:async()=>{if(unavailable)throw Error('Private failure');return value;},fetchImpl:async()=>{forwarded++;return new Response(null,{status:204});}});
 for(const candidate of [null,{...session,active:false},{...session,expiresAt:now},{...session,expiresAt:'200'},{...session,subject:''}]){value=candidate;assert.equal((await handler(request())).status,401);}
 unavailable=true;const response=await handler(request());assert.equal(response.status,503);assert.equal((await response.json()).error,'sign_out_unavailable');assert.equal(forwarded,0);
});
test('provider timeout, redirects and non204 responses never produce false sign-out confirmation',async()=>{
 let status=500,fail=false;const handler=createSessionLogoutHandler({url:'https://trusted-auth.test',publishableKey:'public',now:()=>now,verifySession:async()=>session,fetchImpl:async()=>{if(fail)throw new DOMException('Timeout','TimeoutError');return new Response(null,{status});}});
 for(const candidate of [200,202,301,400,429,500,503]){status=candidate;const response=await handler(request());assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'sign_out_unavailable'});}
 for(const candidate of [401,403]){status=candidate;assert.equal((await handler(request())).status,401);}
 fail=true;assert.equal((await handler(request())).status,503);
});
test('trusted logout configuration accepts only HTTPS or the explicit local Auth fixture',()=>{
 const options={url:'https://trusted-auth.test',publishableKey:'public',verifySession:async()=>null};
 for(const url of ['http://trusted-auth.test','http://127.0.0.1:55321','https://user:secret@trusted-auth.test','https://trusted-auth.test/path','https://trusted-auth.test?next=elsewhere','https://trusted-auth.test#fragment'])assert.throws(()=>createSessionLogoutHandler({...options,url}));
 for(const publishableKey of ['',null,'sb_secret_private','value with spaces'])assert.throws(()=>createSessionLogoutHandler({...options,publishableKey}));
 assert.doesNotThrow(()=>createSessionLogoutHandler({...options,url:'http://127.0.0.1:55321',allowLocal:true}));assert.throws(()=>createSessionLogoutHandler({...options,url:'http://localhost:55321',allowLocal:true}));
});
test('strict verifier does not forward malformed or revoked Auth credentials to logout',async()=>{
 const subject='11111111-1111-1111-1111-111111111111',sessionId='22222222-2222-2222-2222-222222222222',jwt='e30.'+Buffer.from(JSON.stringify({sub:subject,exp:200,session_id:sessionId})).toString('base64url')+'.signature';let active=false,logoutCalls=0,userCalls=0;
 const fetchImpl=async url=>{if(url.endsWith('/user')){userCalls++;return Response.json({id:subject});}logoutCalls++;return new Response(null,{status:204});},verifySession=createSupabaseSessionVerifier({url:'https://trusted-auth.test',publishableKey:'public',fetchImpl,now:()=>now,loadSession:async(s,id)=>{assert.equal(s,subject);assert.equal(id,sessionId);return active;}}),handler=createSessionLogoutHandler({url:'https://trusted-auth.test',publishableKey:'public',verifySession,fetchImpl,now:()=>now});
 assert.equal((await handler(request({token:'arbitrary-secret'}))).status,401);assert.equal(userCalls,0);assert.equal((await handler(request({token:jwt}))).status,401);assert.equal(logoutCalls,0);active=true;assert.equal((await handler(request({token:jwt}))).status,200);assert.equal(logoutCalls,1);
});
