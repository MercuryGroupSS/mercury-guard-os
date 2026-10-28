// Provider-free, real Chromium regression checks. Run with Node 24:
// node server/scripts/test-portal-browser.mjs
// Set CHROME_BIN when Chrome/Chromium is not installed at a standard path.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {accountPageResponse} from '../account-page-handler.mjs';
import {adminConsoleResponse} from '../admin-console-handler.mjs';

const chrome=process.env.CHROME_BIN||[
 '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 '/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome'
].find(existsSync);
assert.ok(chrome,'Install Chrome/Chromium or set CHROME_BIN to run the browser regression checks.');
const profile=await mkdtemp(join(tmpdir(),'mercury-portal-browser-'));
let browser,browserExit,server,origin,sessionId,sequence=0,buffer='',photoBytes,photoGate=null;
const pending=new Map(),requests=[],codePlans=[];
const gate=()=>{let release;const promise=new Promise(resolve=>release=resolve);return {promise,release};};
const codeResult={status:'check_email',code_length:8,expires_in_seconds:600};
const photoPath='/v1/admin/media/'+'a'.repeat(64);
const report=(deliveryId,description,stored=false)=>({
 delivery_id:deliveryId,guard_id:'synthetic-guard',vendor_id:'synthetic-vendor',site_id:'synthetic-site',assignment_id:'synthetic-assignment',
 received_at:1000,destination:'synthetic-inbox',dashboard_shift_id:'synthetic-shift',mapping_revision:1,
 observation:{event_id:'synthetic-event-'+deliveryId,device_thumbprint:'synthetic-device',kind:'incident',occurred_at_ms:1000,data:{description}},
 media:stored?{state:'stored',path:photoPath,bytes:photoBytes.length,sha256:createHash('sha256').update(photoBytes).digest('hex')}:{state:'not_applicable'}
});
const sendJson=(response,data,status=200)=>{response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(data));};
async function serve(request,response){
 const url=new URL(request.url,origin),chunks=[];
 for await(const chunk of request)chunks.push(chunk);
 if(url.pathname.startsWith('/v1/'))requests.push({url,headers:request.headers,body:Buffer.concat(chunks).toString()});
 if(url.pathname==='/v1/account/code'){
  const plan=codePlans.shift()??{};await plan.gate?.promise;sendJson(response,plan.result??codeResult,plan.status??202);return;
 }
 if(url.pathname==='/v1/account/password'){sendJson(response,{status:'password_set',email:'synthetic-guard@example.invalid',account_id:'synthetic-account-id',sign_in_required:true});return;}
 const expires=Math.floor(Date.now()/1000)+600;
 if(url.pathname==='/v1/admin/login'){sendJson(response,{access_token:'synthetic-browser-token',expires_at:expires});return;}
 if(url.pathname==='/v1/admin/me'){sendJson(response,{subject:'synthetic-administrator',role:'guard_os_admin',expires_at:expires});return;}
 if(url.pathname==='/v1/admin/catalog'){
  const kind=url.searchParams.get('kind'),second=url.searchParams.has('after');
  sendJson(response,{kind,items:kind==='received_reports'?(second?[report('delivery-3','Third synthetic report')]:[report('delivery-1','First synthetic report',true),report('delivery-2','Second synthetic report')]):[],next_cursor:kind==='received_reports'&&!second?'synthetic-page-2':null});return;
 }
 if(url.pathname===photoPath){await photoGate?.promise;response.writeHead(200,{'content-type':'image/jpeg','content-length':photoBytes.length});response.end(photoBytes);return;}
 if(url.pathname==='/v1/session/logout'){sendJson(response,{status:'signed_out'});return;}
 const result=(url.pathname.startsWith('/account')?accountPageResponse:adminConsoleResponse)(new Request(url));
 response.writeHead(result.status,Object.fromEntries(result.headers));response.end(Buffer.from(await result.arrayBuffer()));
}
function command(method,params={},target=sessionId){
 const id=++sequence;
 return new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{pending.delete(id);reject(Error('Chrome command timed out: '+method));},10000);
  pending.set(id,{resolve,reject,timeout});browser.stdio[3].write(JSON.stringify({id,method,params,...(target?{sessionId:target}:{})})+'\0');
 });
}
async function evaluate(expression){
 const result=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
 assert.ok(!result.exceptionDetails,result.exceptionDetails?.text+' '+result.result?.description);return result.result.value;
}
async function until(expression,message){
 const end=Date.now()+5000;
 while(Date.now()<end){if(await evaluate(expression))return;await delay(20);}
 assert.fail(message+'; browser state: '+await evaluate('JSON.stringify({notice:document.getElementById("notice")?.textContent,active:document.activeElement?.id})'));
}
async function waitForRequest(path,count){
 const end=Date.now()+5000;while(Date.now()<end){if(requests.filter(r=>r.url.pathname===path).length>=count)return;await delay(20);}assert.fail('Missing synthetic request '+path);
}
async function click(selector){await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);}
async function fill(id,value){await evaluate(`document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(value)}`);}
async function navigate(path,module){
 await command('Page.navigate',{url:origin+path});
 await until(`location.pathname===${JSON.stringify(path)}&&document.readyState==='complete'`,'Page did not finish loading');
 await evaluate(`import(${JSON.stringify(origin+module)})`);
}
async function submitCode(email='synthetic-guard@example.invalid'){
 await fill('email',email);await evaluate('document.getElementById("code-form").requestSubmit()');
}
async function clearReportCheck(){
 assert.equal(await evaluate('document.getElementById("report-image").hasAttribute("src")'),false);
 assert.equal(await evaluate('document.getElementById("report-image").hidden'),true);
 assert.equal(await evaluate('document.getElementById("report-attribution").childElementCount'),0);
 assert.equal(await evaluate('document.querySelectorAll(".report-card[aria-pressed=true]").length'),0);
}
try{
 server=createServer((request,response)=>{serve(request,response).catch(error=>{response.writeHead(500);response.end();process.stderr.write(error.stack+'\n');});});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;
 browser=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-pipe','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe']});
 browserExit=new Promise(resolve=>{browser.once('exit',resolve);browser.once('error',resolve);});
 browser.stdio[4].on('data',chunk=>{
  buffer+=chunk.toString();let end;
  while((end=buffer.indexOf('\0'))!==-1){const message=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);const request=pending.get(message.id);if(!request)continue;pending.delete(message.id);clearTimeout(request.timeout);if(message.error)request.reject(Error(JSON.stringify(message.error)));else request.resolve(message.result);}
 });
 browser.on('error',error=>{for(const request of pending.values())request.reject(error);});
 const {targetId}=await command('Target.createTarget',{url:'about:blank'},null);
 ({sessionId}=await command('Target.attachToTarget',{targetId,flatten:true},null));
 await command('Page.enable');await command('Runtime.enable');
 // A same-origin cookie must never be sent by account or admin fetches.
 await command('Network.enable');await command('Network.setCookie',{name:'synthetic-cookie',value:'must-be-omitted',url:origin});
 await navigate('/account/','/account/portal.mjs');

 // Failure enables retry; only a successful, current request focuses the code.
 codePlans.push({status:503,result:{error:'account_service_unavailable'}});
 await submitCode();await until('!document.getElementById("send-code").disabled','Failed request stayed locked');
 assert.equal(await evaluate('document.getElementById("password-form").hidden'),true);
 assert.notEqual(await evaluate('document.activeElement.id'),'code');
 assert.match(await evaluate('document.getElementById("notice").textContent'),/unavailable/);
 await submitCode();await until('document.activeElement.id==="code"&&!document.getElementById("code").disabled','Successful retry did not focus the enabled code input');
 await fill('code','12345678');await fill('password','Synthetic passphrase only');await fill('confirm-password','Synthetic passphrase only');
 await evaluate('document.getElementById("password-form").requestSubmit()');await until('!document.getElementById("complete").hidden','Completion was not shown');
 assert.match(await evaluate('document.getElementById("complete").textContent'),/Android phone[\s\S]*Mercury Guard app[\s\S]*must approve and link[\s\S]*separate owner approval/);
 assert.equal(await evaluate('document.querySelector("#complete a").getAttribute("href")'),'/admin/');
 assert.equal(await evaluate('document.querySelector("#complete a").classList.contains("link-button")'),false);
 for(const id of ['code','password','confirm-password'])assert.equal(await evaluate(`document.getElementById(${JSON.stringify(id)}).value`),'');
 console.log('PASS account failure, retry focus, private-field clearing and guard/admin next steps');

 // pagehide resets generation even while a response is in flight. An older
 // completion must neither focus code nor unlock the newer request.
 await click('#start-over');
 const stale=gate(),current=gate();codePlans.push({gate:stale},{gate:current});
 await submitCode('old@example.invalid');await waitForRequest('/v1/account/code',3);
 await evaluate('window.dispatchEvent(new Event("pagehide"))');
 await submitCode('current@example.invalid');await waitForRequest('/v1/account/code',4);
 stale.release();await delay(100);
 assert.equal(await evaluate('document.getElementById("send-code").disabled'),true);
 assert.equal(await evaluate('document.getElementById("password-form").hidden'),true);
 assert.notEqual(await evaluate('document.activeElement.id'),'code');
 current.release();await until('document.activeElement.id==="code"','Current request did not receive focus');
 assert.equal(await evaluate('document.getElementById("target-email").textContent'),'current@example.invalid');
 const staleFailure=gate();codePlans.push({gate:staleFailure,status:503,result:{error:'account_service_unavailable'}});
 await click('#change-email');await submitCode('old-failure@example.invalid');await waitForRequest('/v1/account/code',5);
 await evaluate('window.dispatchEvent(new Event("pagehide"))');await submitCode('latest@example.invalid');
 await until('document.activeElement.id==="code"','Latest request did not receive focus');
 staleFailure.release();await delay(100);
 assert.equal(await evaluate('document.activeElement.id'),'code');
 assert.equal(await evaluate('document.getElementById("notice").dataset.error'),'false');
 assert.equal(await evaluate('document.getElementById("target-email").textContent'),'latest@example.invalid');
 console.log('PASS account stale success/failure fencing and newer-request lock');

 await navigate('/admin/','/admin/console.mjs');
 photoBytes=Buffer.from(await evaluate('(()=>{const canvas=document.createElement("canvas");canvas.width=1;canvas.height=1;return canvas.toDataURL("image/jpeg").split(",")[1]})()'),'base64');
 await fill('email','synthetic-admin@example.invalid');await fill('password','Synthetic administrator passphrase');await evaluate('document.getElementById("login-form").requestSubmit()');
 await until('!document.getElementById("workspace").hidden&&!document.getElementById("refresh").disabled','Synthetic admin did not sign in');
 await click('[data-kind="received_reports"]');await until('document.querySelectorAll(".report-card").length===2','Report cards did not load');
 await click('[data-delivery-id="delivery-1"]');await click('#load-photo');
 await until('document.getElementById("report-image").complete&&document.getElementById("report-image").naturalWidth===1','Synthetic private JPEG did not display');
 const loadedPhoto=await evaluate('document.getElementById("report-image").src');
 await evaluate('document.getElementById("close-report").focus()');await click('#close-report');
 assert.equal(await evaluate('document.activeElement.dataset.deliveryId'),'delivery-1');await clearReportCheck();
 assert.equal(await evaluate(`fetch(${JSON.stringify(loadedPhoto)}).then(()=>false,()=>true)`),true,'Closed photo object URL was not revoked');
 await click('[data-delivery-id="delivery-2"]');await click('#close-report');
 assert.equal(await evaluate('document.activeElement.dataset.deliveryId'),'delivery-2');await clearReportCheck();
 // A filter removing that delivery has no matching card to receive focus.
 await click('[data-delivery-id="delivery-1"]');await fill('filter','Second');await evaluate('document.getElementById("filter").dispatchEvent(new Event("input"))');
 await click('#close-report');assert.equal(await evaluate('document.activeElement.id'),'records-title');await clearReportCheck();
 assert.equal(await evaluate('document.querySelector(".report-card").dataset.deliveryId'),'delivery-2');
 console.log('PASS report close restores delivery card or Records heading and clears loaded evidence');

 // Pending private evidence must not repopulate a cleared view after close,
 // filtering, pagination, navigation or sign-out, even if the server finishes.
 await fill('filter','');await evaluate('document.getElementById("filter").dispatchEvent(new Event("input"))');
 for(const transition of ['close','filter','page','navigation','sign-out']){
  if(transition==='page'||transition==='navigation'||transition==='sign-out'){
   await click('[data-kind="received_reports"]');await until('document.querySelector("[data-delivery-id=delivery-1]")&&!document.getElementById("refresh").disabled','First report page did not reload');
  }
  photoGate=gate();const expected=requests.filter(r=>r.url.pathname===photoPath).length+1;
  await click('[data-delivery-id="delivery-1"]');await click('#load-photo');await waitForRequest(photoPath,expected);
  if(transition==='close'){await click('#close-report');assert.equal(await evaluate('document.activeElement.dataset.deliveryId'),'delivery-1');}
  if(transition==='filter'){await fill('filter','Second');await evaluate('document.getElementById("filter").dispatchEvent(new Event("input"))');}
  if(transition==='page'){await click('#next');await until('document.querySelector("[data-delivery-id=delivery-3]")','Second page did not load');}
  if(transition==='navigation'){await click('[data-kind="vendors"]');await until('document.getElementById("records-title").textContent==="Directory"','Directory did not load');}
  if(transition==='sign-out'){await click('#sign-out');await until('!document.getElementById("sign-in").hidden','Sign-out did not clear workspace');}
  photoGate.release();photoGate=null;await delay(100);await clearReportCheck();
  if(transition==='filter'){await fill('filter','');await evaluate('document.getElementById("filter").dispatchEvent(new Event("input"))');}
  if(transition==='page'){await click('[data-delivery-id="delivery-3"]');await click('#previous');await until('document.querySelector("[data-delivery-id=delivery-1]")&&!document.getElementById("refresh").disabled','Previous report page did not reload');await clearReportCheck();}
 }
 console.log('PASS pending evidence cleared across close/filter/page/navigation/sign-out');

 const accountRequests=requests.filter(r=>r.url.pathname.startsWith('/v1/account/'));
 assert.equal(accountRequests.filter(r=>r.url.pathname.endsWith('/password')).length,1);
 for(const request of requests){assert.equal(request.headers.cookie,undefined);if(request.url.pathname.startsWith('/v1/account/')||['/v1/admin/login','/v1/session/logout'].includes(request.url.pathname))assert.equal(request.headers.origin,origin);if(request.url.pathname.startsWith('/v1/admin/')&&!request.url.pathname.endsWith('/login'))assert.equal(request.headers.authorization,'Bearer synthetic-browser-token');}
 assert.ok(requests.every(r=>r.url.origin===origin));
 console.log('PASS real same-origin fetches omit cookies and preserve synthetic admin session scope');
}finally{
 for(const plan of codePlans)plan.gate?.release();photoGate?.release();
 if(browser){await command('Browser.close',{},null).catch(()=>{});await Promise.race([browserExit,delay(3000,undefined,{ref:false}).then(()=>browser.kill('SIGKILL'))]);await browserExit;}
 for(const request of pending.values()){clearTimeout(request.timeout);request.reject(Error('Browser test finished'));}
 server?.closeAllConnections();await new Promise(resolve=>server?server.close(resolve):resolve());
 await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
