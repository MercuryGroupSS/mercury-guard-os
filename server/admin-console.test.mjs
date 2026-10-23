import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {adminConsoleResponse} from './admin-console-handler.mjs';
import {buildPayload,PendingChange,AdminClient,valuesForRow,readReportJpeg,ReportPhotoPreview,reportPresentation,maxReportPhotoBytes} from './admin-console/model.mjs';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const session={access_token:'synthetic-access',expires_at:1000},member={subject:'individual-admin',role:'guard_os_admin',expires_at:1000};
test('operator escalation review binds the original ID and preserves guard-visible response',()=>{
 const id='AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',payload=buildPayload('escalation.acknowledge',valuesForRow('escalations',{escalation_id:id}));assert.deepEqual(payload,{escalation_id:id.toLowerCase()});
 const pending=new PendingChange({owner:'operator',action:'escalation.acknowledge',payload,reason:'I have received your request and am reviewing it.',requestId:'unchanged-request'}),original=pending.body;payload.escalation_id='other';assert.equal(pending.body,original);assert.equal(pending.request('operator').payload.escalation_id,id.toLowerCase());assert.throws(()=>pending.request('another-operator'));
 assert.throws(()=>buildPayload('escalation.acknowledge',{escalationId:'arbitrary-guard-id'}));
});
test('console serves only approved static assets with no framing, script injection or credential directory access',async()=>{
 const req=(path,method='GET')=>new Request('http://127.0.0.1:1234'+path,{method});
 for(const path of ['/admin/','/admin/console.css','/admin/console.mjs','/admin/model.mjs']){const r=adminConsoleResponse(req(path));assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.match(r.headers.get('content-security-policy'),/script-src 'self'/);assert.doesNotMatch(r.headers.get('content-security-policy'),/unsafe-inline|unsafe-eval/);assert.ok((await r.text()).length>100);}
 for(const path of ['/admin/.env','/admin/../supabase-start.log','/admin/%2e%2e%2fsupabase-start.log','/admin/index.html','/admin/?token=secret'])assert.equal(adminConsoleResponse(req(path)).status,404);
 assert.equal(adminConsoleResponse(req('/admin/','POST')).status,405);assert.equal(adminConsoleResponse(req('/admin')).headers.get('location'),'/admin/');assert.equal(await adminConsoleResponse(req('/admin/','HEAD')).text(),'');
 assert.match(adminConsoleResponse(req('/admin/')).headers.get('content-security-policy'),/img-src 'self' blob:;/);
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
test('optional patrol rounds preserve legacy omission, reject ambiguous authority and stay immutable through audited review',()=>{
 const values={opsShiftId:'ops-1',guardId:'guard-1',vendorId:'company-1',siteId:'site-1',authSubject:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',revision:'3',active:'true',routeEnabled:'on',routeId:'route-1',routeRevision:'2',checkpoints:'entrance | Main entrance\nperimeter | Perimeter'};
 assert.equal('rounds' in buildPayload('ops_binding.approve',values).patrolRoute,false);assert.equal('rounds' in buildPayload('ops_binding.approve',{...values,rounds:' \n '}).patrolRoute,false);
 const payload=buildPayload('ops_binding.approve',{...values,rounds:'opening | Opening patrol\nclosing | Closing patrol'});assert.deepEqual(payload.patrolRoute.rounds,[{id:'opening',label:'Opening patrol'},{id:'closing',label:'Closing patrol'}]);const review=new PendingChange({owner:'admin',action:'ops_binding.approve',reason:'Approved two explicit patrol rounds',payload,requestId:'round-request'});payload.patrolRoute.rounds[0].id='edited-after-review';const request=review.request('admin');assert.equal(request.payload.patrolRoute.rounds[0].id,'opening');request.payload.patrolRoute.rounds.pop();assert.equal(review.request('admin').payload.patrolRoute.rounds.length,2);assert.equal(valuesForRow('ops_bindings',{body:request.payload,revision:3}).patrolRoute.rounds[0].id,'opening');
 for(const rounds of ['opening','| Missing ID','a | First\na | Second','a | First\nb | first','a | ','bad/id | Bad',Array.from({length:101},(_,index)=>'round-'+index+' | Round '+index).join('\n')])assert.throws(()=>buildPayload('ops_binding.approve',{...values,rounds}));
 const noRoute=buildPayload('ops_binding.approve',{...values,routeEnabled:undefined,rounds:'unapproved | Must not attach'});assert.equal('patrolRoute' in noRoute,false);
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
test('explicit sign-out clears local credentials immediately and posts only the captured bearer to the fixed same-origin endpoint',async()=>{
 let release;const calls=[],client=new AdminClient({now:()=>1000,fetchImpl:async(path,options)=>{calls.push({path,options});if(path.endsWith('/login'))return json(session);if(path.endsWith('/me'))return json(member);return new Promise(resolve=>{release=resolve;});}});await client.login('a@example.test','password');const generation=client.generation,confirmation=client.logout();assert.equal(client.session,null);assert.equal(client.generation,generation+1);
 const {path,options}=calls.at(-1);assert.equal(path,'/v1/session/logout');assert.equal(options.method,'POST');assert.deepEqual(options.headers,{authorization:'Bearer synthetic-access'});assert.equal(options.body,undefined);assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.equal(options.mode,'same-origin');assert.equal(path.includes('synthetic-access'),false);release(json({status:'signed_out'}));assert.equal(await confirmation,'signed_out');assert.equal(client.session,null);
});
test('explicit sign-out distinguishes unavailable sessions from unconfirmed provider outcomes without restoring local credentials',async()=>{
 for(const [reply,expected]of [[()=>json({status:'signed_out'}),'signed_out'],[()=>json({},401),'session_unavailable'],[()=>json({},503),'unconfirmed'],[()=>Promise.reject(Error('offline')),'unconfirmed'],[()=>new Response('not json'),'unconfirmed'],[()=>json({status:'other'}),'unconfirmed'],[()=>json({status:'signed_out',extra:true}),'unconfirmed']]){
  const client=new AdminClient({now:()=>1000,fetchImpl:async path=>path.endsWith('/login')?json(session):path.endsWith('/me')?json(member):reply()});await client.login('a@example.test','password');assert.equal(await client.logout(),expected);assert.equal(client.session,null);
 }
 let calls=0;const empty=new AdminClient({fetchImpl:async()=>{calls++;throw Error('Unexpected request');}});assert.equal(await empty.logout(),'session_unavailable');assert.equal(calls,0);
});
test('late sign-out completion cannot clear or publish an outcome over a newer sign-in or local navigation',async()=>{
 for(const status of [200,401,503]){
  let release;const client=new AdminClient({now:()=>1000,fetchImpl:async path=>path.endsWith('/login')?json(session):path.endsWith('/me')?json(member):new Promise(resolve=>{release=resolve;})});await client.login('a@example.test','password');const confirmation=client.logout();await client.login('b@example.test','password');const current=client.session;release(json({status:'signed_out'},status));assert.equal(await confirmation,null);assert.equal(client.session,current);
 }
 let release;const client=new AdminClient({now:()=>1000,fetchImpl:async path=>path.endsWith('/login')?json(session):path.endsWith('/me')?json(member):new Promise(resolve=>{release=resolve;})});await client.login('a@example.test','password');const confirmation=client.logout();client.clear();release(json({status:'signed_out'}));assert.equal(await confirmation,null);assert.equal(client.session,null);
});
const jpeg=new Uint8Array([255,216,255,224,0,2,255,217]),photo={state:'stored',path:'/v1/admin/media/'+'a'.repeat(64),sha256:createHash('sha256').update(jpeg).digest('hex'),bytes:jpeg.length};
const imageResponse=(bytes=jpeg,headers={})=>new Response(bytes,{headers:{'content-type':'image/jpeg','content-length':String(bytes.length),...headers}});
test('private evidence fetch sends credentials only to its exact protected same-origin path and verifies bytes and fingerprint',async()=>{
 const calls=[],client=new AdminClient({now:()=>1000,fetchImpl:async(path,options)=>{calls.push({path,options});return path.endsWith('/login')?json(session):path.endsWith('/me')?json(member):imageResponse();}});await client.login('a@example.test','password');
 const blob=await client.media(photo);assert.equal(blob.type,'image/jpeg');assert.equal(blob.size,jpeg.length);assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),jpeg);const call=calls.at(-1);assert.equal(call.path,photo.path);assert.equal(call.options.headers.authorization,'Bearer synthetic-access');assert.equal(call.options.credentials,'omit');assert.equal(call.options.cache,'no-store');assert.equal(call.options.redirect,'error');assert.equal(call.options.mode,'same-origin');assert.equal(call.path.includes('synthetic-access'),false);
 for(const invalid of [{...photo,path:'https://external.test/'+photo.path},{...photo,path:photo.path+'?token=secret'},{...photo,path:photo.path+'#fragment'},{...photo,state:'pending'},{...photo,bytes:maxReportPhotoBytes+1},{...photo,sha256:'bad'}])await assert.rejects(client.media(invalid),/reference/);
 assert.equal(calls.length,3);
});
test('private evidence rejects wrong type, length, truncated data, non-JPEG contents and mismatched hash before displaying',async()=>{
 await assert.rejects(readReportJpeg(imageResponse(jpeg,{'content-type':'text/html'}),photo),/validation/);
 await assert.rejects(readReportJpeg(imageResponse(jpeg,{'content-length':'999'}),photo),/validation/);
 await assert.rejects(readReportJpeg(imageResponse(jpeg.slice(0,6),{'content-length':String(photo.bytes)}),photo),/incomplete/);
 await assert.rejects(readReportJpeg(imageResponse(),{...photo,sha256:'b'.repeat(64)}),/fingerprint/);
 const other=new Uint8Array(jpeg);other[0]=0;await assert.rejects(readReportJpeg(imageResponse(other),{...photo,sha256:createHash('sha256').update(other).digest('hex')}),/not a JPEG/);
 let cancelled=false;const body=new ReadableStream({start(controller){controller.enqueue(jpeg);controller.enqueue(new Uint8Array([1]));},cancel(){cancelled=true;}});await assert.rejects(readReportJpeg(new Response(body,{headers:{'content-type':'image/jpeg'}}),photo),/exceeded/);assert.equal(cancelled,true);
});
test('photo authorization revocation and expiry clear the session, while stale photo responses cannot cross sign-ins',async()=>{
 let lost=0,now=1000,release,started;const waiting=new Promise(resolve=>{started=resolve;});let denied=false;
 const client=new AdminClient({now:()=>now,onSessionLost:()=>lost++,fetchImpl:async path=>{if(path.endsWith('/login'))return json(session);if(path.endsWith('/me'))return json(member);if(denied)return json({},403);started();return new Promise(resolve=>{release=resolve;});}});await client.login('a@example.test','password');const pending=client.media(photo);await waiting;client.clear();release(imageResponse());await assert.rejects(pending,/Session changed/);assert.equal(client.session,null);
 await client.login('a@example.test','password');denied=true;await assert.rejects(client.media(photo),e=>e.status===403);assert.equal(client.session,null);assert.equal(lost,1);
 denied=false;await client.login('a@example.test','password');const expiring=client.media(photo);now=1000000;release(imageResponse());await assert.rejects(expiring,e=>e.status===401);assert.equal(client.session,null);assert.equal(lost,2);
});
test('changing reports, closing the view and signing out revoke object URLs and prevent late photo requests from restoring images',async()=>{
 const requests=[],created=[],revoked=[],client={media:(_media,{signal})=>new Promise((resolve,reject)=>{requests.push({resolve,reject,signal});})};const preview=new ReportPhotoPreview({client,createObjectURL:blob=>{created.push(blob);return 'blob:private-'+created.length;},revokeObjectURL:url=>revoked.push(url)});
 const first=preview.load(photo),second=preview.load(photo);assert.equal(requests[0].signal.aborted,true);requests[1].resolve(new Blob([jpeg]));assert.equal(await second,'blob:private-1');requests[0].resolve(new Blob([jpeg]));assert.equal(await first,null);assert.equal(created.length,1);
 preview.clear();assert.deepEqual(revoked,['blob:private-1']);assert.equal(preview.url,null);
 const abandoned=preview.load(photo);preview.clear();assert.equal(requests[2].signal.aborted,true);requests[2].resolve(new Blob([jpeg]));assert.equal(await abandoned,null);assert.equal(created.length,1);
 const revokedRequest=preview.load(photo);preview.clear();requests[3].reject(Error('No longer authorized'));assert.equal(await revokedRequest,null);assert.equal(preview.url,null);
});
test('a late photo denial from an older session cannot revoke the administrator who has since signed in',async()=>{
 let release,lost=0;const client=new AdminClient({now:()=>1000,onSessionLost:()=>lost++,fetchImpl:async path=>path.endsWith('/login')?json(session):path.endsWith('/me')?json(member):new Promise(resolve=>{release=resolve;})});await client.login('a@example.test','password');const old=client.media(photo);await client.login('b@example.test','password');const current=client.session;release(json({},403));await assert.rejects(old,e=>e.status===403);assert.equal(client.session,current);assert.equal(lost,0);
});
test('report presentation preserves literal incident text and distinguishes delivered metadata, pending photos and local biometric evidence',()=>{
 const incident=reportPresentation({observation:{kind:'incident',data:{description:'<script>alert(1)</script>\nTest only'}},media:{state:'not_applicable'}});assert.equal(incident.title,'Incident report');assert.equal(incident.summary,'<script>alert(1)</script>\nTest only');assert.equal(incident.photoLabel,'No photo attached');
 const checkin=reportPresentation({observation:{kind:'check_in',data:{slot:2,policy_revision:1,biometric:{at:1000},location:{at:1001,latitude:45,longitude:-73,accuracy_m:12},evidence_id:'evidence-1'}},media:{state:'pending'}});assert.equal(checkin.photoLabel,'Photo pending');assert.ok(checkin.rows.some(([title,value])=>title==='Local biometric'&&/identity comes from the signed-in guard account/.test(value)));assert.ok(checkin.rows.some(([title,value])=>title==='GPS uncertainty'&&value==='12 metres'));
 assert.equal(reportPresentation({observation:{kind:'photo_evidence',data:{}},media:{state:'stored'}}).photoLabel,'Private photo stored');
 for(const [kind,title]of [['patrol_checkpoint','Patrol checkpoint'],['shift_start','Shift started'],['shift_end','Shift ended'],['dispatch_ack','Message acknowledged'],['check_in_delivery_missing','Check-in delivery overdue']])assert.equal(reportPresentation({observation:{kind,data:{}}}).title,title);
});
test('received patrol details preserve the recorded round ID and explicitly label legacy single passes',()=>{
 const report={observation:{kind:'patrol_checkpoint',data:{route_id:'route',route_revision:2,checkpoint_id:'entrance',round_id:'closing'}}},view=reportPresentation(report);assert.match(view.summary,/Round closing/);assert.ok(view.rows.some(([title,value])=>title==='Patrol round'&&value==='closing'));
 delete report.observation.data.round_id;const legacy=reportPresentation(report);assert.doesNotMatch(legacy.summary,/Round/);assert.ok(legacy.rows.some(([title,value])=>title==='Patrol round'&&value==='Single pass (no declared round)'));
});
