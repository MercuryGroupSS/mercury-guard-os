import test from 'node:test';import assert from 'node:assert/strict';
import {request as httpsRequest} from 'node:https';
import {randomUUID} from 'node:crypto';
import {configuredFixture} from './fixtures/configured-service.mjs';
import {loadConfiguredMaterials} from './configured-service-config.mjs';
import {createConfiguredApplication,createConfiguredService} from './configured-service.mjs';
import {assertConfiguredDatabase,openConfiguredDatabase} from './configured-database.mjs';
import {openConfiguredRuntime} from './configured-runtime.mjs';
const fixture=configuredFixture({port:55449});test.after(()=>fixture.close());const materials=loadConfiguredMaterials(fixture.config);
function applicationFixture(){
 const subject=randomUUID(),id=randomUUID(),other=randomUUID(),sessions=new Set([id,other]);let enabled=true,calls=0;
 const jwt=session=>['header',Buffer.from(JSON.stringify({sub:subject,session_id:session,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'signature'].join('.');
 const fetchImpl=async(url,options)=>{calls++;assert.ok(url.startsWith(fixture.config.auth.origin+'/auth/v1/'));assert.equal(options.redirect,'error');assert.equal(options.headers.apikey,fixture.config.auth.publishable_key);
  if(url.endsWith('/settings'))return Response.json({mailer_autoconfirm:false,external:{email:true},disable_signup:false});
  const token=options.headers.authorization?.slice(7),claim=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
  if(url.endsWith('/logout?scope=local')){sessions.delete(claim.session_id);return new Response(null,{status:204});}
  if(url.endsWith('/user'))return Response.json({id:subject});throw Error('Unexpected trusted Auth route');
 };
 const pool={query:async(sql,args)=>{assert.ok(sql.includes('auth.sessions'));return {rows:[{active:args[1]===subject&&sessions.has(args[0])}]};}},directory={loadGuardsForSubject:async s=>s===subject?[{guardId:'synthetic-guard',authSubject:subject,vendorId:'synthetic-company',active:enabled}]:[],loadVendor:async()=>({vendorId:'synthetic-company',kind:'company',active:true})};
 const config=fixture.config,devices={audience:config.issuer.audience},grantIssuer={issuer:config.issuer.issuer,audience:config.issuer.audience,keyId:config.issuer.key_id};
 const args={config,pool,directory,devices,grantIssuer,store:{},dispatch:{},shiftLifecycle:{},admin:{},escalations:{audience:config.issuer.audience,receive(){},status(){}},locationConsents:{audience:config.issuer.audience,challenge(){},receive(){},status(){}},fetchImpl};
 return {application:createConfiguredApplication(args),args,subject,id,other,sessions,jwt,disable:()=>{enabled=false;},calls:()=>calls};
}
test('configured application preserves exact Auth session and individual scope; local logout leaves another session',async()=>{
 const a=applicationFixture(),call=(path,token=a.jwt(a.id),method='GET')=>a.application.handle(new Request(fixture.config.public_origin+path,{method,headers:{authorization:'Bearer '+token}}));
 await a.application.assertConfiguration();assert.equal((await call('/v1/me')).status,200);
 const body=await (await call('/v1/me')).json();assert.equal(body.guard_id,'synthetic-guard');assert.equal(body.auth_subject,a.subject);
 const altered=a.jwt(a.id).split('.');altered[1]=Buffer.from(JSON.stringify({sub:randomUUID(),session_id:a.id,exp:Math.floor(Date.now()/1000)+1000})).toString('base64url');assert.equal((await call('/v1/me',altered.join('.'))).status,401);
 a.sessions.delete(a.id);assert.equal((await call('/v1/me')).status,401);a.sessions.add(a.id);
 const logout=await call('/v1/session/logout',a.jwt(a.id),'POST');assert.deepEqual(await logout.json(),{status:'signed_out'});assert.equal((await call('/v1/me')).status,401);assert.equal((await call('/v1/me',a.jwt(a.other))).status,200);
 a.disable();assert.equal((await call('/v1/me',a.jwt(a.other))).status,403);
});
test('configured application has no unconfigured/legacy fallback and rejects foreign origin and mixed issuer',async()=>{
 const a=applicationFixture();assert.equal((await a.application.handle(new Request('https://other.invalid/v1/me'))).status,421);
 assert.equal((await a.application.handle(new Request(fixture.config.public_origin+'/account/',{headers:{origin:'https://other.invalid'}}))).status,403);
 assert.equal((await a.application.handle(new Request(fixture.config.public_origin+'/v1/batches'))).status,404);
 for(const key of ['admin','escalations','locationConsents','dispatch','pool'])assert.throws(()=>createConfiguredApplication({...a.args,[key]:null}),/Complete configured/);
 assert.throws(()=>createConfiguredApplication({...a.args,devices:{audience:'wrong-deployment'}}),/Complete configured/);
 for(const key of ['escalations','locationConsents'])assert.throws(()=>createConfiguredApplication({...a.args,[key]:{...a.args[key],audience:'mercury-local'}}),/Complete configured/);
 assert.throws(()=>createConfiguredApplication({...a.args,grantIssuer:{...a.args.grantIssuer,issuer:'wrong-deployment'}}),/Complete configured/);
 assert.equal(a.calls(),0);
});
test('configured database requires exact immutable owner binding and verified configured TLS, closing failures',async()=>{
 const expected={deployment_id:fixture.config.deployment_id,auth_origin:fixture.config.auth.origin,public_origin:fixture.config.public_origin,issuer:fixture.config.issuer.issuer,audience:fixture.config.issuer.audience,issuer_key_id:fixture.config.issuer.key_id,issuer_spki_sha256:materials.issuerSha256};
 let actual={...expected},ended=0,options;
 const pool={on(){},end:async()=>{ended++;},query:async sql=>({rows:[sql.includes('current_user')?{role:'service_role',sessions:true,marker_read_only:true,consent_order:true}:sql.includes('unnest')?{missing:false}:actual]})};
 await assertConfiguredDatabase(pool,expected);for(const k of Object.keys(expected)){actual={...expected,[k]:'different'};await assert.rejects(assertConfiguredDatabase(pool,expected),/database identity/);}actual={...expected};
 const c=structuredClone(fixture.config);c.mode='configured';c.auth.origin='https://auth.example.invalid';c.database.url='postgresql://user:secret@db.example.invalid:5432/guard';actual={...expected,auth_origin:c.auth.origin};
 await openConfiguredDatabase(c,materials,{poolFactory:o=>{options=o;return pool;}});assert.deepEqual(options.ssl,{rejectUnauthorized:true});assert.equal(options.options,'-c role=service_role');assert.equal(ended,0);
 actual.public_origin='https://wrong.invalid';await assert.rejects(openConfiguredDatabase(c,materials,{poolFactory:()=>pool}),/no fallback/);assert.equal(ended,1);
});
function tls(path,{headers={},trusted=true}={}){
 return new Promise((resolve,reject)=>{const req=httpsRequest({hostname:'127.0.0.1',servername:'localhost',port:fixture.config.listen.port,path,headers:{host:new URL(fixture.config.public_origin).host,...headers},...(trusted?{ca:materials.certificate}:{})},res=>{const parts=[];res.on('data',p=>parts.push(p));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(parts).toString()}));});req.on('error',reject);req.end();});
}
test('direct TLS checks the supplied certificate and exact host, ignores no proxy authority, drains active work',async()=>{
 let entered,release;const began=new Promise(r=>{entered=r;}),wait=new Promise(r=>{release=r;});let checks=0;
 const service=createConfiguredService({config:fixture.config,materials,preflight:async()=>{checks++;},application:{assertConfiguration:async()=>{},handle:async req=>{if(new URL(req.url).pathname==='/slow'){entered();await wait;}return Response.json({status:'complete'});}}});
 try{
  assert.equal((await service.check()).status,'configuration_verified');assert.equal(checks,1);await assert.rejects(tls('/account/'));await service.start();
  assert.equal((await tls('/account/')).status,200);await assert.rejects(tls('/account/',{trusted:false}));
  for(const headers of [{host:'attacker.invalid'},{'x-forwarded-host':new URL(fixture.config.public_origin).host},{forwarded:'proto=https;host=attacker.invalid'}])assert.equal((await tls('/account/',{headers})).status,421);
  const inFlight=tls('/slow');await began;let stopped=false;const stop=service.stop().then(()=>{stopped=true;});await new Promise(r=>setImmediate(r));assert.equal(stopped,false);release();assert.equal((await inFlight).status,200);await stop;await assert.rejects(tls('/account/'));await assert.rejects(service.start(),/stopped/);
 }finally{release();await service.stop();}
});
test('failed preflight never opens the TLS listener',async()=>{
 const service=createConfiguredService({config:fixture.config,materials,application:{assertConfiguration:async()=>{},handle:async()=>Response.json({})},preflight:async()=>{throw Error('marker mismatch');}});
 await assert.rejects(service.start(),/marker mismatch/);await assert.rejects(tls('/account/'));await service.stop();
});
test('stop during startup preflight cannot open a listener after the stop request',async()=>{
 let entered,release;const began=new Promise(r=>{entered=r;}),wait=new Promise(r=>{release=r;});
 const service=createConfiguredService({config:fixture.config,materials,application:{assertConfiguration:async()=>{},handle:async()=>Response.json({})},preflight:async()=>{entered();await wait;}});
 const starting=service.start();await began;const stopped=service.stop();release();await assert.rejects(starting,/stopped/);await stopped;await assert.rejects(tls('/account/'));
});
test('runtime close during Auth preflight cannot start workers, timers or reopen resources',async()=>{
 let entered,release;const began=new Promise(r=>{entered=r;}),wait=new Promise(r=>{release=r;});let closed=0,scheduled=0;
 const row={deployment_id:fixture.config.deployment_id,auth_origin:fixture.config.auth.origin,public_origin:fixture.config.public_origin,issuer:fixture.config.issuer.issuer,audience:fixture.config.issuer.audience,issuer_key_id:fixture.config.issuer.key_id,issuer_spki_sha256:materials.issuerSha256};
 const pool={on(){},connect(){throw Error('Workers must not start');},end:async()=>{closed++;},query:async sql=>{if(sql.includes('current_user'))return {rows:[{role:'service_role',sessions:true,marker_read_only:true,consent_order:true}]};if(sql.includes('unnest'))return {rows:[{missing:false}]};if(sql.includes('deployment_identity'))return {rows:[row]};throw Error('Unexpected worker query');}};
 const runtime=await openConfiguredRuntime(fixture.config,materials,{poolFactory:()=>pool,schedule:()=>{scheduled++;throw Error('Workers must not start');},fetchImpl:async()=>{entered();await wait;return Response.json({mailer_autoconfirm:false,external:{email:true},disable_signup:false});}});
 const starting=runtime.start();await began;const closing=runtime.close();await assert.rejects(runtime.start(),/closed/);release();await assert.rejects(starting,/startup failed/);await closing;assert.equal(closed,1);assert.equal(scheduled,0);assert.equal(runtime.status().started,false);await assert.rejects(runtime.start(),/closed/);await assert.rejects(tls('/account/'));
});
