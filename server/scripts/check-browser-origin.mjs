// Synthetic loopback-only browser regression. No environment, database, Auth
// provider, mail transport or live account is loaded by this fixture.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createNetlifyIngress} from '../netlify-ingress.mjs';
import {accountPageResponse} from '../account-page-handler.mjs';
import {adminConsoleResponse} from '../admin-console-handler.mjs';
import {privatePageHeaders} from '../private-page-headers.mjs';

const site='22222222-2222-4222-8222-222222222222',subject='11111111-1111-4111-8111-111111111111';
const email='browser-fixture@example.invalid',password='Synthetic browser passphrase 45',token='synthetic-browser-only-not-auth';
const context={site:{id:site},deploy:{context:'production'}};
const stages=new Set(['inherited_baseline','explicit_baseline','account_code','account_password','admin_login','admin_action','admin_resolve','admin_logout','complete']);
const page='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mercury One · Synthetic browser-origin regression</title><script type="module" src="/__browser/driver.mjs"></script></head><body><main><h1>Browser-origin regression</h1><p>Loopback fixture only. No email, real account, database or provider is contacted.</p><button id="run" type="button">Run browser-origin regression</button><pre id="result" role="status">Not run</pre></main></body></html>';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...privatePageHeaders,'content-type':'application/json'}});
const exact=(body,keys)=>body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).sort().join()===keys.sort().join();
export async function startBrowserOriginFixture(){
 let origin,closed=false,runtimeCalls=0,apiRuntimeCalls=0,opens=0,originalAction=null,result=null,resolveResult;
 const events=[],inflight=new Set(),completed=new Promise(resolve=>{resolveResult=resolve;});
 const runtime={async handle(request){
  runtimeCalls++;const path=new URL(request.url).pathname;if(path.startsWith('/v1/'))apiRuntimeCalls++;
  if(path==='/account/'||path.startsWith('/account/'))return accountPageResponse(request);
  if(path==='/admin/'||path.startsWith('/admin/'))return adminConsoleResponse(request);
  if(path==='/v1/admin/me'){
   assert.equal(request.method,'GET');assert.equal(request.headers.get('authorization'),'Bearer '+token);
   return json({subject,role:'guard_os_admin',expires_at:Math.floor(Date.now()/1000)+300});
  }
  assert.equal(request.method,'POST');
  if(path==='/v1/session/logout'){
   assert.equal(request.headers.get('authorization'),'Bearer '+token);assert.equal((await request.arrayBuffer()).byteLength,0);
   return json({status:'signed_out'});
  }
  assert.equal(request.headers.get('content-type')?.split(';')[0],'application/json');
  const body=await request.json();
  if(path==='/v1/account/code'){
   assert.ok(exact(body,['email','intent']));assert.equal(body.email,email);assert.equal(body.intent,'setup');
   return json({status:'check_email',code_length:8,expires_in_seconds:600},202);
  }
  if(path==='/v1/account/password'){
   assert.ok(exact(body,['email','code','password']));assert.equal(body.email,email);assert.equal(body.code,'12345678');assert.equal(body.password,password);
   return json({status:'password_set',account_id:subject,email,sign_in_required:true});
  }
  if(path==='/v1/admin/login'){
   assert.ok(exact(body,['email','password']));assert.equal(body.email,email);assert.equal(body.password,password);
   return json({access_token:token,expires_at:Math.floor(Date.now()/1000)+300});
  }
  if(path==='/v1/admin/actions'||path==='/v1/admin/resolve'){
   assert.equal(request.headers.get('authorization'),'Bearer '+token);assert.ok(exact(body,['request_id','action','reason','payload']));
   assert.equal(body.request_id,'33333333-3333-4333-8333-333333333333');assert.equal(body.action,'guard.status');
   assert.equal(body.reason,'Synthetic browser-origin regression only');assert.deepEqual(body.payload,{guard_id:'synthetic-browser-guard',active:true});
   if(path.endsWith('/actions'))originalAction=JSON.stringify(body);else assert.equal(JSON.stringify(body),originalAction);
   return json({request_id:body.request_id,action:body.action,status:'applied'});
  }
  return json({error:'not_found'},404);
 }};
 const ingress=createNetlifyIngress({loadConfiguration:()=>({config:{public_origin:origin,platform:{site_id:site,deployment_context:'production'}},materials:{}}),openRuntime:async()=>{opens++;return runtime;}});
 const baseline=i=>events[i]?{origin:events[i].origin===origin?'canonical':events[i].origin,status:events[i].status,referer_absent:events[i].referer_absent,runtime_delta:events[i].runtime_delta}:null;
 const safeSummary=()=>({version:1,test:'browser_origin',status:result?.status??'pending',...(result?.stage?{stage:result.stage}:{}),actual_browser_origin_serialization:result?.status==='passed'?'verified':'not_verified',inherited_no_referrer:baseline(0),explicit_no_referrer:baseline(1),baseline_failure_reproduced:events.slice(0,2).some(e=>e.origin==='null'&&e.status===403&&e.runtime_delta===0),corrected_canonical_posts:events.slice(2).filter(e=>e.method==='POST'&&e.origin===origin&&e.status>=200&&e.status<300).length,corrected_same_origin_referer:events.slice(2).filter(e=>e.method==='POST').length===6&&events.slice(2).filter(e=>e.method==='POST').every(e=>e.same_origin_referer),strict_null_and_foreign_pre_runtime:true,provider_calls:0,real_accounts:0,mail_sent:0,external_application_fetches:0,ios_device:'not_tested'});
 function finish(report){
  if(result)return safeSummary();
  try{
   assert.ok(exact(report,['status','stage'])&&['passed','failed'].includes(report.status)&&stages.has(report.stage));
   if(report.status!=='passed'){result={status:'failed',stage:report.stage};resolveResult(safeSummary());return safeSummary();}
   assert.equal(report.stage,'complete');
   // Chromium preserves its initiator Origin here; WebKit applies the referrer
   // policy to Origin. Preserve the actual observation without forging headers.
   for(const event of events.slice(0,2)){
    assert.equal(event.method,'POST');assert.equal(event.path,'/v1/account/code');assert.equal(event.referer_absent,true);
    assert.ok(event.origin===origin||event.origin==='null');assert.equal(event.status,event.origin==='null'?403:202);assert.equal(event.runtime_delta,event.origin==='null'?0:1);
   }
   assert.equal(events.length,9);
   assert.deepEqual(events.slice(2).map(({method,path,origin:sentOrigin,status,runtime_delta})=>[method,path,sentOrigin===origin?'canonical':sentOrigin,status,runtime_delta]),[
    ['POST','/v1/account/code','canonical',202,1],['POST','/v1/account/password','canonical',200,1],
    ['POST','/v1/admin/login','canonical',200,1],['GET','/v1/admin/me',null,200,1],['POST','/v1/admin/actions','canonical',200,1],
    ['POST','/v1/admin/resolve','canonical',200,1],['POST','/v1/session/logout','canonical',200,1]
   ]);assert.equal(apiRuntimeCalls,7+events.slice(0,2).filter(e=>e.status===202).length);assert.equal(opens,1);
   assert.ok(events.slice(2).filter(e=>e.method==='POST').every(e=>e.same_origin_referer));
   result={status:'passed',stage:'complete'};
  }catch{result={status:'failed',stage:'server_assertions'};}
  resolveResult(safeSummary());return safeSummary();
 }
 async function dispatch(req){
  if(closed)return json({error:'fixture_closed'},503);
  if(req.headers.host!==new URL(origin).host)return json({error:'fixture_host_denied'},421);
  if(!req.url?.startsWith('/')||req.url.startsWith('//'))return json({error:'fixture_path_denied'},404);
  const url=new URL(req.url,origin);
  if(url.pathname==='/__browser/'&&req.method==='GET'&&['','?autorun=1'].includes(url.search))return new Response(page,{headers:{...privatePageHeaders,'content-type':'text/html; charset=utf-8'}});
  if(url.pathname==='/__browser/driver.mjs'&&req.method==='GET'&&!url.search)return new Response(readFileSync(new URL('./check-browser-origin-page.mjs',import.meta.url)),{headers:{...privatePageHeaders,'content-type':'text/javascript; charset=utf-8'}});
  if(url.pathname==='/__browser/state'&&req.method==='GET'&&!url.search)return json(safeSummary());
  if(url.pathname==='/__browser/complete'&&req.method==='POST'&&!url.search){
   if(req.headers.origin!==origin||req.headers['content-type']!=='application/json')return json({error:'fixture_request_denied'},403);
   const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>256)return json({error:'fixture_request_denied'},413);chunks.push(chunk);}
   try{return json(finish(JSON.parse(Buffer.concat(chunks).toString('utf8'))));}catch{return json({error:'fixture_request_denied'},400);}
  }
  if(!['GET','HEAD','POST'].includes(req.method)||url.search||!['/account/model.mjs','/admin/model.mjs','/v1/account/code','/v1/account/password','/v1/admin/login','/v1/admin/me','/v1/admin/actions','/v1/admin/resolve','/v1/session/logout'].includes(url.pathname))return json({error:'fixture_not_found'},404);
  const request=new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Readable.toWeb(req),duplex:'half'})}),before=runtimeCalls;
  const response=await ingress.api(request,context);
  if(url.pathname.startsWith('/v1/')){
   const referer=request.headers.get('referer');let sameOrigin=false;try{sameOrigin=referer!==null&&new URL(referer).origin===origin;}catch{}
   events.push({method:req.method,path:url.pathname,origin:request.headers.get('origin'),status:response.status,runtime_delta:runtimeCalls-before,referer_absent:referer===null,same_origin_referer:sameOrigin});
  }
  req.resume();return response;
 }
 const server=createServer((req,res)=>{
  const operation=(async()=>{try{const response=await dispatch(req);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500,{'content-type':'application/json','cache-control':'no-store'});res.end('{"error":"synthetic_fixture_failed"}');}})();inflight.add(operation);void operation.finally(()=>inflight.delete(operation));
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});origin='http://127.0.0.1:'+server.address().port;
 try{
  // Separate explicit server-boundary probes; no request reaches the synthetic
  // runtime. The engine's real baseline is separately observed above.
  for(const sentOrigin of ['null','https://foreign.example.invalid']){
   const denied=await ingress.api(new Request(origin+'/v1/account/code',{method:'POST',headers:{origin:sentOrigin,'content-type':'application/json'},body:'{}'}),context);
   assert.equal(denied.status,403);assert.deepEqual(await denied.json(),{error:'origin_denied'});assert.equal(opens,0);assert.equal(runtimeCalls,0);
  }
 }catch(error){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));throw error;}
 return {origin,url:origin+'/__browser/',result:completed,snapshot:safeSummary,async close(){if(closed)return;closed=true;const done=new Promise(resolve=>server.close(resolve));server.closeAllConnections();await done;await Promise.allSettled([...inflight]);}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const mode=process.argv[2];if(!['--serve','--check'].includes(mode)||process.argv.length!==3)throw Error('Use --serve or --check; fixture is loopback-only.');
 const fixture=await startBrowserOriginFixture();
 if(mode==='--check'){await fixture.close();console.log(JSON.stringify({status:'passed',strict_null_and_foreign_pre_runtime:true,browser_execution:false,provider_calls:0}));}
 else{
  const timer=setTimeout(()=>void stop(),600000);let closing=false;
  async function stop(){if(closing)return;closing=true;clearTimeout(timer);await fixture.close();}
  process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
  console.log(JSON.stringify({status:'ready',url:fixture.url,pid:process.pid,loopback_only:true,provider_calls:0}));
 }
}
