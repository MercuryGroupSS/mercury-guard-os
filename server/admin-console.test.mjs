import {test} from 'node:test';
import assert from 'node:assert/strict';
import {adminConsoleResponse} from './admin-console-handler.mjs';
import {buildPayload,PendingChange,AdminClient,valuesForRow} from './admin-console/model.mjs';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const session={access_token:'synthetic-access',expires_at:1000},member={subject:'individual-admin',role:'guard_os_admin',expires_at:1000};
test('console serves only approved static assets with no framing, script injection or credential directory access',async()=>{
 const req=(path,method='GET')=>new Request('http://127.0.0.1:1234'+path,{method});
 for(const path of ['/admin/','/admin/console.css','/admin/console.mjs','/admin/model.mjs']){const r=adminConsoleResponse(req(path));assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.match(r.headers.get('content-security-policy'),/script-src 'self'/);assert.doesNotMatch(r.headers.get('content-security-policy'),/unsafe-inline|unsafe-eval/);assert.ok((await r.text()).length>100);}
 for(const path of ['/admin/.env','/admin/../supabase-start.log','/admin/%2e%2e%2fsupabase-start.log','/admin/index.html','/admin/?token=secret'])assert.equal(adminConsoleResponse(req(path)).status,404);
 assert.equal(adminConsoleResponse(req('/admin/','POST')).status,405);assert.equal(adminConsoleResponse(req('/admin')).headers.get('location'),'/admin/');assert.equal(await adminConsoleResponse(req('/admin/','HEAD')).text(),'');
});
test('operator forms preserve individual account identity, explicit device scope and message time',()=>{
 const g=buildPayload('guard.link',{guardId:'guard-1',vendorId:'company-1',authSubject:'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',email:'Person@Example.test',active:'true'});assert.equal(g.authSubject,'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');assert.equal(g.email,'person@example.test');assert.equal(g.vendorId,'company-1');
 const enrollment={deviceId:'site-phone',mode:'site',siteId:'site-1',publicKeySpki:'A'.repeat(123)};assert.deepEqual(buildPayload('device.enroll',enrollment),{...enrollment,active:true,revoked:false});assert.throws(()=>buildPayload('device.enroll',{...enrollment,guardId:'guard-1'}),/only/);
 assert.throws(()=>buildPayload('device.enroll',{...enrollment,publicKeySpki:'-----BEGIN PRIVATE KEY-----'}),/public enrollment/);
 const v={assignmentId:'assignment-1',guardId:'guard-1',vendorId:'company-1',siteId:'site-1',messageId:'msg-1',version:'2',state:'active',title:'Routine check',body:'Synthetic test only'};const result=buildPayload('dispatch.publish',v,1000);assert.equal(result.message.issued_at,1000);assert.equal(result.message.due_at,null);assert.equal(result.scope.vendorId,'company-1');assert.throws(()=>buildPayload('dispatch.publish',{...v,state:'retracted'},1000),/Clear/);assert.throws(()=>buildPayload('dispatch.publish',{...v,due:'1970-01-01T00:00:00Z'},1000),/future/);
});
test('assignment policy forms reject ambiguous checkpoint IDs and inconsistent evidence windows',()=>{
 const v={opsShiftId:'ops-1',guardId:'guard-1',vendorId:'company-1',siteId:'site-1',authSubject:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',revision:'3',active:'true',routeEnabled:'on',routeId:'route-1',routeRevision:'2',checkpoints:'entrance | Main entrance\nperimeter | Perimeter',policyEnabled:'on',policyRevision:'4',interval:'15',window:'120',evidenceAge:'30',accuracy:'50'};
 const p=buildPayload('ops_binding.approve',v);assert.deepEqual(p.patrolRoute.checkpoints.map(c=>c.id),['entrance','perimeter']);assert.equal(p.checkInPolicy.interval_ms,900000);assert.equal(p.checkInPolicy.max_evidence_age_ms,30000);
 for(const checkpoints of ['entrance','x | Entrance\nx | Duplicate','| Label'])assert.throws(()=>buildPayload('ops_binding.approve',{...v,checkpoints}));
 assert.throws(()=>buildPayload('ops_binding.approve',{...v,evidenceAge:'121'}),/freshness/);assert.throws(()=>buildPayload('ops_binding.approve',{...v,interval:'1'}),/window/);
 assert.equal(valuesForRow('ops_bindings',{body:p,revision:3}).revision,4);
});
test('unconfirmed changes retry the identical request body and remain bound to the preparing administrator',()=>{
 const payload={vendorId:'company-1',kind:'company',active:true},change=new PendingChange({owner:'admin-1',action:'vendor.create',reason:' Supplier approved ',payload,requestId:'request-1'});payload.active=false;
 const sent=change.request('admin-1');assert.equal(sent.payload.active,true);assert.equal(sent.reason,'Supplier approved');sent.payload.active=false;assert.equal(change.request('admin-1').payload.active,true);assert.throws(()=>change.request('admin-2'),/administrator/);assert.throws(()=>change.confirm({request_id:'other',action:'vendor.create',status:'applied'}),/receipt/);assert.equal(change.confirm({request_id:'request-1',action:'vendor.create',status:'applied'}).status,'applied');
});
test('console checks active administrator membership before keeping an access token, and clears it on revocation',async()=>{
 const calls=[];let lost=0,revoked=false;const client=new AdminClient({now:()=>1000,onSessionLost:()=>lost++,fetchImpl:async(path,options)=>{calls.push({path,options});if(path.endsWith('/login'))return json(session);if(path.endsWith('/me'))return json(member);return json({},revoked?403:200);}});
 await client.login('ADMIN@example.test','synthetic-password');assert.equal(client.session.subject,member.subject);assert.equal(calls.length,2);assert.equal(calls[0].options.headers.authorization,undefined);assert.equal(calls[1].options.headers.authorization,'Bearer synthetic-access');assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.cache,'no-store');
 revoked=true;await assert.rejects(client.request('/v1/admin/catalog?kind=vendors'),e=>e.status===403);assert.equal(client.session,null);assert.equal(lost,1);await assert.rejects(client.request('https://untrusted.test/'),e=>e.status===401);assert.equal(calls.length,3);
});
test('session expiry and overlapping sign-in cannot publish stale credentials or old responses',async()=>{
 let now=1000,release,started;const waiting=new Promise(resolve=>{started=resolve;});
 const client=new AdminClient({now:()=>now,fetchImpl:async path=>{if(path.endsWith('/login'))return json(session);if(path.endsWith('/me'))return json(member);started();return new Promise(resolve=>{release=resolve;});}});await client.login('a@example.test','password');const pending=client.request('/v1/admin/catalog?kind=vendors');await waiting;client.clear();release(json({kind:'vendors',items:[],next_cursor:null}));await assert.rejects(pending,/Session changed/);
 await client.login('a@example.test','password');now=1000000;await assert.rejects(client.request('/v1/admin/catalog?kind=vendors'),e=>e.status===401);assert.equal(client.session,null);
 let resolveLogin;const racing=new AdminClient({now:()=>1000,fetchImpl:async path=>path.endsWith('/login')?new Promise(resolve=>{resolveLogin=resolve;}):json(member)});const login=racing.login('a@example.test','password');racing.clear();resolveLogin(json(session));await assert.rejects(login,/cancelled/);assert.equal(racing.session,null);
});
test('interrupted writes stay distinguishable from rejected writes and untrusted URLs never receive credentials',async()=>{
 const client=new AdminClient({now:()=>1000,fetchImpl:async path=>path.endsWith('/login')?json(session):path.endsWith('/me')?json(member):Promise.reject(Error('offline'))});await client.login('a@example.test','password');await assert.rejects(client.request('/v1/admin/actions',{method:'POST',body:{}}),e=>e.status===0&&/same request/.test(e.message));await assert.rejects(client.request('https://untrusted.test/'),/Invalid administration path/);
 const denied=new AdminClient({now:()=>1000,fetchImpl:async path=>path.endsWith('/login')?json(session):json({},403)});await assert.rejects(denied.login('a@example.test','password'),e=>e.status===403);assert.equal(denied.session,null);
});
test('default browser transport preserves the global fetch receiver',async()=>{
 const original=globalThis.fetch;try{globalThis.fetch=function(path){assert.equal(this,globalThis);return Promise.resolve(json(path.endsWith('/login')?session:member));};const client=new AdminClient({now:()=>1000});await client.login('a@example.test','password');assert.equal(client.session.subject,member.subject);}finally{globalThis.fetch=original;}
});
