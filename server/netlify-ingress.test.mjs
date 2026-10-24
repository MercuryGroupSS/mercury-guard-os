import test from 'node:test';
import assert from 'node:assert/strict';
import {createNetlifyIngress,NETLIFY_BODY_LIMIT} from './netlify-ingress.mjs';

const endpoint='https://guard.example.invalid',site='11111111-1111-4111-8111-111111111111';
const context={site:{id:site},deploy:{context:'production'}};
const settings={public_origin:endpoint,platform:{site_id:site,deployment_context:'production'},workers:{max_duration_ms:25000}};
function fixture({handle=async()=>Response.json({ok:true}),workers=async()=>({status:'completed',completed:true}),open,clock,ioTimeoutMs}={}){
 const calls={opens:0,api:0,workers:0,lastRequest:null,lastBudget:null};
 const ingress=createNetlifyIngress({clock,ioTimeoutMs,loadConfiguration:()=>({config:settings,materials:{}}),openRuntime:async()=>{calls.opens++;if(open)await open(calls.opens);return {handle:async r=>{calls.api++;calls.lastRequest=r;return handle(r);},runWorkersOnce:async budget=>{calls.workers++;calls.lastBudget=budget;return workers();}};}});
 return {calls,ingress};
}
const request=(path='/v1/me',options={})=>new Request(endpoint+path,options);

test('Netlify site and production context gate precedes runtime/credentials use',async()=>{
 const {ingress,calls}=fixture();
 for(const c of [undefined,{}, {site:{id:'another'},deploy:{context:'production'}},{site:{id:site},deploy:{context:'deploy-preview'}},{site:{id:site},deploy:{context:'branch-deploy'}}]){
  const r=await ingress.api(request('/v1/me',{headers:{'x-nf-site-id':site,'x-nf-context':'production'}}),c);assert.equal(r.status,503);
 }
 assert.equal(calls.opens,0);assert.equal(calls.api,0);
});

test('canonical origin and Host reject rewritten or cross-origin request authority',async()=>{
 const {ingress,calls}=fixture();
 for(const req of [new Request('https://other.example.invalid/v1/me'),request('/v1/me',{headers:{host:'other.example.invalid'}}),request('/v1/me',{headers:{origin:'https://other.example.invalid'}})])assert.equal((await ingress.api(req,context)).ok,false);
 assert.equal(calls.opens,0);
 const r=await ingress.api(request('/v1/me',{headers:{host:'GUARD.EXAMPLE.INVALID'}}),context);assert.equal(r.status,200);
});

test('forwarded and rewrite headers cannot retarget the normalized application request',async()=>{
 const {ingress,calls}=fixture();
 const r=await ingress.api(request('/v1/me?after=abc',{headers:{forwarded:'host=evil.invalid','x-forwarded-host':'evil.invalid','x-forwarded-proto':'http','x-original-url':'/v1/admin/actions','x-rewrite-url':'/v1/admin/actions'}}),context);
 assert.equal(r.status,200);assert.equal(calls.lastRequest.url,endpoint+'/v1/me?after=abc');
 for(const h of ['forwarded','x-forwarded-host','x-forwarded-proto','x-original-url','x-rewrite-url'])assert.equal(calls.lastRequest.headers.get(h),null);
});

test('photo chunk request preserves authorization, bytes and digest without an extra encoding layer',async()=>{
 const bytes=new Uint8Array(1024*1024).fill(137),digest='a'.repeat(64);
 const {ingress,calls}=fixture({handle:async r=>{assert.deepEqual(new Uint8Array(await r.arrayBuffer()),bytes);return Response.json({status:'chunk_retained'});}});
 const r=await ingress.api(request('/v1/evidence/11111111-1111-4111-8111-111111111111/chunks/0',{method:'POST',headers:{authorization:'Bearer opaque-fixture','content-type':'application/octet-stream','content-length':String(bytes.length),'x-mercury-chunk-sha256':digest},body:bytes}),context);
 assert.equal(r.status,200);assert.equal(calls.lastRequest.headers.get('authorization'),'Bearer opaque-fixture');assert.equal(calls.lastRequest.headers.get('x-mercury-chunk-sha256'),digest);
});

test('large declared or streamed requests are rejected before application work',async()=>{
 const {ingress,calls}=fixture();
 const declared=request('/v2/batches',{method:'POST',headers:{'content-length':String(NETLIFY_BODY_LIMIT+1)},body:'x'});
 assert.equal((await ingress.api(declared,context)).status,413);
 const streamed=request('/v2/batches',{method:'POST',body:new Uint8Array(NETLIFY_BODY_LIMIT+1)});
 assert.equal((await ingress.api(streamed,context)).status,413);assert.equal(calls.opens,0);
});

test('ambiguous/mismatching lengths and unsupported HTTP methods never reach application',async()=>{
 const {ingress,calls}=fixture();
 for(const length of ['1, 1','01','-1','9007199254740992','2']){
  assert.equal((await ingress.api(request('/v2/batches',{method:'POST',body:'x',headers:{'content-length':length}}),context)).status,400);
 }
 assert.equal((await ingress.api(request('/v1/me',{method:'OPTIONS'}),context)).status,405);assert.equal(calls.opens,0);
});

test('one bounded private media range retains exact status/framing/hash and bytes',async()=>{
 const bytes=new Uint8Array(1024*1024).fill(18),etag='"'+('b'.repeat(64))+'"';
 const {ingress,calls}=fixture({handle:async r=>{assert.equal(r.headers.get('range'),'bytes=0-1048575');return new Response(bytes,{status:206,headers:{'content-type':'image/jpeg','content-range':'bytes 0-1048575/20971520','content-length':String(bytes.length),etag}});}});
 const r=await ingress.api(request('/v1/admin/media/11111111-1111-4111-8111-111111111111',{headers:{range:'bytes=0-1048575',authorization:'Bearer admin-fixture'}}),context);
 assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),'bytes 0-1048575/20971520');assert.equal(r.headers.get('etag'),etag);assert.equal(r.headers.get('content-length'),String(bytes.length));assert.equal(r.headers.get('cache-control'),'no-store');assert.deepEqual(new Uint8Array(await r.arrayBuffer()),bytes);assert.equal(calls.api,1);
});

test('whole oversized response and dishonest framing fail without leaking partial bytes',async()=>{
 for(const response of [new Response(new Uint8Array(NETLIFY_BODY_LIMIT+1)),new Response('hidden',{headers:{'content-length':String(NETLIFY_BODY_LIMIT+1)}}),new Response('hidden',{status:206,headers:{'content-length':'1'}})]){
  const {ingress}=fixture({handle:async()=>response});const r=await ingress.api(request(),context);assert.equal(r.status,502);assert.doesNotMatch(await r.text(),/hidden/);
 }
});

test('concurrent invocations share runtime initialization, rejected startup retries and errors stay generic',async()=>{
 const {ingress,calls}=fixture({open:async n=>{if(n===1)throw Error('secret-db-password');}});
 const first=await ingress.api(request(),context);assert.equal(first.status,503);assert.doesNotMatch(await first.text(),/secret/);
 const results=await Promise.all([ingress.api(request(),context),ingress.api(request(),context),ingress.api(request(),context)]);
 assert.ok(results.every(r=>r.status===200));assert.equal(calls.opens,2);assert.equal(calls.api,3);
 const bad=createNetlifyIngress({loadConfiguration:()=>{throw Error('private-issuer-key');},openRuntime:()=>{throw Error('unreachable');}});
 const result=await bad.api(request(),context);assert.equal(result.status,503);assert.doesNotMatch(await result.text(),/private/);
});

test('scheduled work is bound to trusted platform context and cold-start time reduces pass budget',async()=>{
 let now=100;
 const {ingress,calls}=fixture({clock:()=>now,open:async()=>{now+=6000;}});
 assert.equal((await ingress.scheduled(request(),{site:{id:site},deploy:{context:'deploy-preview'}})).status,503);assert.equal(calls.opens,0);
 assert.equal((await ingress.scheduled(request(),context)).status,200);assert.equal(calls.lastBudget.maxDurationMs,19000);assert.equal(calls.workers,1);
});

test('scheduled overlap is an explicit skip; failed/incomplete work is not reported as success',async()=>{
 for(const result of [{status:'busy',completed:false},{status:'incomplete',completed:false},{status:'timed_out',completed:false}]){
  const {ingress}=fixture({workers:async()=>result});const r=await ingress.scheduled(request(),context);assert.equal(r.status,result.status==='busy'?200:503);assert.deepEqual(await r.json(),result);
 }
 let now=0;const {ingress,calls}=fixture({clock:()=>now,open:async()=>{now=25001;}});
 assert.equal((await ingress.scheduled(request(),context)).status,503);assert.equal(calls.workers,0);
});

test('stalled reads, request abort and stalled cancellation stay bounded before runtime admission',async()=>{
 const stalled=()=>new ReadableStream({pull:()=>new Promise(()=>{}),cancel:()=>new Promise(()=>{})});
 const {ingress,calls}=fixture({ioTimeoutMs:20});
 const timed=await ingress.api(request('/v2/batches',{method:'POST',body:stalled(),duplex:'half'}),context);assert.equal(timed.status,408);assert.equal(calls.opens,0);
 const signal=new AbortController();const pending=ingress.api(request('/v2/batches',{method:'POST',body:stalled(),duplex:'half',signal:signal.signal}),context);signal.abort();assert.equal((await pending).status,408);assert.equal(calls.opens,0);
 const oversized=request('/v2/batches',{method:'POST',body:stalled(),duplex:'half',headers:{'content-length':String(NETLIFY_BODY_LIMIT+1)}});assert.equal((await ingress.api(oversized,context)).status,413);
 const reply=fixture({ioTimeoutMs:20,handle:async()=>new Response(stalled())});assert.equal((await reply.ingress.api(request(),context)).status,502);
});
