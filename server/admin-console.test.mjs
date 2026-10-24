import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {adminConsoleResponse} from './admin-console-handler.mjs';
import {locationPolicy as validateLocationPolicy} from './location-policy.mjs';
import {buildPayload,buildReviewedPayload,PendingChange,AdminClient,valuesForRow,readReportJpeg,ReportPhotoPreview,reportPresentation,locationReportPresentation,maxReportPhotoBytes,reportPhotoRangeBytes} from './admin-console/model.mjs';
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
const locationApproval={opsShiftId:'synthetic-ops',guardId:'synthetic-guard',vendorId:'synthetic-company',siteId:'synthetic-site',authSubject:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',revision:'4',active:'true',locationPolicyEnabled:'on',locationRevision:'3',locationNoticeRevision:'2',locationNotice:'  Synthetic review only — café.\nCollection stops when this authorized shift or lease ends.  ',locationInterval:'12000',locationDistance:'0',locationFreshness:'20000',locationAccuracy:'25.5',locationLease:'60000'};
test('GPS checkpoint approval requires explicit exact location notice and is retained in reasoned immutable review',async()=>{
 const values={...locationApproval,routeEnabled:'on',routeId:'synthetic-route',routeRevision:'5',checkpoints:'entrance | Entrance',routeGpsRequired:'true'};
 await assert.rejects(buildReviewedPayload('ops_binding.approve',{...values,locationPolicyEnabled:undefined}),/complete approved location policy/);
 const payload=await buildReviewedPayload('ops_binding.approve',values);assert.equal(payload.patrolRoute.gps_required,true);const change=new PendingChange({owner:'operator',action:'ops_binding.approve',payload,reason:'This exact notice covers user-triggered checkpoint fixes',requestId:'gps-request'});delete payload.patrolRoute.gps_required;assert.equal(change.request('operator').payload.patrolRoute.gps_required,true);
 const legacy=await buildReviewedPayload('ops_binding.approve',{...values,routeGpsRequired:''});assert.equal(Object.hasOwn(legacy.patrolRoute,'gps_required'),false);await assert.rejects(buildReviewedPayload('ops_binding.approve',{...values,routeGpsRequired:'false'}));
});
test('location approval is absent by default and hashes the exact reviewed notice before immutable audited retry',async()=>{
 const omitted=await buildReviewedPayload('ops_binding.approve',{...locationApproval,locationPolicyEnabled:undefined});assert.equal('locationPolicy'in omitted,false);
 await assert.rejects(buildReviewedPayload('ops_binding.approve',{...locationApproval,locationInterval:''}),/interval/);assert.throws(()=>buildPayload('ops_binding.approve',locationApproval),/fingerprint/);
 const values={...locationApproval},preparing=buildReviewedPayload('ops_binding.approve',values);values.locationNotice='Changed after review started';values.locationLease='900000';const payload=await preparing,policy=payload.locationPolicy,notice=locationApproval.locationNotice.trim();
 assert.equal(policy.notice_text,notice);assert.equal(policy.notice_sha256,createHash('sha256').update(notice,'utf8').digest('hex'));assert.equal(policy.max_capture_lease_ms,60000);assert.equal(policy.geofence,null);assert.equal(policy.min_distance_m,0);assert.equal(policy.max_accuracy_m,25.5);
 assert.deepEqual(validateLocationPolicy(policy),policy);
 const change=new PendingChange({owner:'operator',action:'ops_binding.approve',reason:'Approved the synthetic notice and explicit collection bounds',payload,requestId:'same-location-request'}),original=change.body;payload.locationPolicy.notice_text='mutated';payload.locationPolicy.sample_interval_ms=1000;
 assert.equal(change.body,original);assert.equal(change.request('operator').payload.locationPolicy.notice_text,notice);assert.equal(change.request('operator').payload.locationPolicy.sample_interval_ms,12000);assert.throws(()=>change.request('other-operator'));
 const saved=valuesForRow('ops_bindings',{body:change.request('operator').payload,revision:4});assert.equal(saved.revision,5);assert.deepEqual(saved.locationPolicy,JSON.parse(original).payload.locationPolicy);
});
test('explicit location policy bounds, valid Unicode and optional circle geometry fail closed without invented values',async()=>{
 for(const change of [{locationRevision:''},{locationNoticeRevision:'0'},{locationNotice:' \n '},{locationNotice:'bad\tcontrol'},{locationNotice:'bad\rline'},{locationNotice:'bad\ud800'},{locationNotice:'x'.repeat(2001)},{locationInterval:'999'},{locationInterval:'3600001'},{locationDistance:''},{locationDistance:'-1'},{locationDistance:'Infinity'},{locationFreshness:'300001'},{locationAccuracy:'0'},{locationAccuracy:'1001'},{locationLease:'900001'},{locationLease:'1.5'}])await assert.rejects(buildReviewedPayload('ops_binding.approve',{...locationApproval,...change}));
 const circle={...locationApproval,locationCircleEnabled:'on',locationFenceId:'synthetic-circle',locationFenceRevision:'2',locationLatitude:'0',locationLongitude:'0',locationRadius:'100.25'},policy=(await buildReviewedPayload('ops_binding.approve',circle)).locationPolicy;
 assert.deepEqual(policy.geofence,{type:'circle',id:'synthetic-circle',revision:2,latitude:0,longitude:0,radius_m:100.25});
 assert.deepEqual(validateLocationPolicy(policy),policy);
 for(const change of [{locationFenceId:''},{locationFenceRevision:'0'},{locationLatitude:''},{locationLatitude:'90.01'},{locationLongitude:'-180.01'},{locationRadius:''},{locationRadius:'0'},{locationRadius:'100001'}])await assert.rejects(buildReviewedPayload('ops_binding.approve',{...circle,...change}));
 assert.equal((await buildReviewedPayload('ops_binding.approve',{...circle,locationCircleEnabled:undefined})).locationPolicy.geofence,null);
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
function rangedPhoto(size=reportPhotoRangeBytes*2+13){const bytes=new Uint8Array(size);bytes.set([255,216,255,224]);bytes.set([255,217],size-2);return {bytes,media:{...photo,bytes:size,sha256:createHash('sha256').update(bytes).digest('hex')}};}
function rangeResponse(bytes,media,range,{status=206,headers={},body}={}){const match=/^bytes=(\d+)-(\d+)$/.exec(range);assert.ok(match);const start=Number(match[1]),end=Number(match[2]);return new Response(body??bytes.slice(start,end+1),{status,headers:{'content-type':'image/jpeg','content-length':String(end-start+1),'content-range':`bytes ${start}-${end}/${media.bytes}`,etag:'"'+media.sha256+'"',...headers}});}
test('large private photos use sequential bounded ranges on the exact protected path and verify the complete original image',async()=>{
 const {bytes,media}=rangedPhoto(),calls=[];let active=0;
 const client=new AdminClient({now:()=>1000,fetchImpl:async(path,options)=>{if(path.endsWith('/login'))return json(session);if(path.endsWith('/me'))return json(member);assert.equal(active++,0);calls.push({path,options});await Promise.resolve();active--;return rangeResponse(bytes,media,options.headers.range);}});await client.login('a@example.test','password');
 const blob=await client.media(media);assert.equal(blob.type,'image/jpeg');assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),bytes);assert.equal(calls.length,3);
 assert.deepEqual(calls.map(call=>call.options.headers.range),['bytes=0-1048575','bytes=1048576-2097151','bytes=2097152-2097164']);
 for(const {path,options}of calls){assert.equal(path,photo.path);assert.deepEqual(Object.keys(options.headers).sort(),['authorization','range']);assert.equal(options.headers.authorization,'Bearer synthetic-access');assert.equal(options.mode,'same-origin');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.equal(options.method,'GET');}
 const boundary=rangedPhoto(reportPhotoRangeBytes),smallCalls=[];const small=new AdminClient({now:()=>1000,fetchImpl:async(path,options)=>path.endsWith('/login')?json(session):path.endsWith('/me')?json(member):(smallCalls.push(options),imageResponse(boundary.bytes))});await small.login('a@example.test','password');assert.equal((await small.media(boundary.media)).size,reportPhotoRangeBytes);assert.equal(smallCalls.length,1);assert.equal(smallCalls[0].headers.range,undefined);
 const maximum=rangedPhoto(maxReportPhotoBytes),ranges=[];const capped=new AdminClient({now:()=>1000,fetchImpl:async(path,options)=>path.endsWith('/login')?json(session):path.endsWith('/me')?json(member):(ranges.push(options.headers.range),rangeResponse(maximum.bytes,maximum.media,options.headers.range))});await capped.login('a@example.test','password');const complete=await capped.media(maximum.media);assert.equal(complete.size,maxReportPhotoBytes);assert.equal(createHash('sha256').update(new Uint8Array(await complete.arrayBuffer())).digest('hex'),maximum.media.sha256);assert.deepEqual(ranges,Array.from({length:20},(_,i)=>`bytes=${i*reportPhotoRangeBytes}-${(i+1)*reportPhotoRangeBytes-1}`));
});
test('range loading rejects changed identity, boundaries, framing and missing partial support without a raw fallback',async()=>{
 const {bytes,media}=rangedPhoto();
 for(const change of [{status:200},{headers:{'content-range':'bytes 1-1048576/'+media.bytes}},{headers:{'content-range':'bytes 0-1048575/*'}},{headers:{'content-range':'bytes 0-1048575/'+(media.bytes+1)}},{headers:{'content-length':String(reportPhotoRangeBytes+1)}},{headers:{'content-length':''}},{headers:{etag:'"'+'b'.repeat(64)+'"'}},{headers:{etag:'W/"'+media.sha256+'"'}},{headers:{etag:''}},{headers:{'content-type':'application/octet-stream'}}]){
  let requests=0;const client=new AdminClient({now:()=>1000,fetchImpl:async(path,options)=>path.endsWith('/login')?json(session):path.endsWith('/me')?json(member):(requests++,rangeResponse(bytes,media,options.headers.range,change))});await client.login('a@example.test','password');await assert.rejects(client.media(media),/range failed validation/);assert.equal(requests,1);assert.ok(client.session);
 }
});
test('a ranged request keeps the originally validated report reference even if its caller replaces the source fields',async()=>{
 const original=rangedPhoto(),provided={...original.media},paths=[];const client=new AdminClient({now:()=>1000,fetchImpl:async(path,options)=>{if(path.endsWith('/login'))return json(session);if(path.endsWith('/me'))return json(member);paths.push(path);if(paths.length===1)Object.assign(provided,{path:'/v1/admin/actions?token=untrusted',sha256:'f'.repeat(64),bytes:4,state:'pending'});return rangeResponse(original.bytes,original.media,options.headers.range);}});await client.login('a@example.test','password');assert.equal((await client.media(provided)).size,original.media.bytes);assert.deepEqual(paths,[photo.path,photo.path,photo.path]);
});
test('ranged transfers reject short, trailing, interrupted and altered original bytes before creating an image',async()=>{
 const {bytes,media}=rangedPhoto();
 for(const kind of ['short','trailing','interrupted','altered']){
  let requests=0,cancelled=false;const client=new AdminClient({now:()=>1000,fetchImpl:async(path,options)=>{if(path.endsWith('/login'))return json(session);if(path.endsWith('/me'))return json(member);requests++;let body;
   if(requests===1){if(kind==='short')body=bytes.slice(0,reportPhotoRangeBytes-1);if(kind==='trailing')body=new ReadableStream({start(c){c.enqueue(bytes.slice(0,reportPhotoRangeBytes));c.enqueue(new Uint8Array([1]));},cancel(){cancelled=true;}});if(kind==='interrupted')body=new ReadableStream({start(c){c.error(Error('private transfer diagnostic'));}});if(kind==='altered'){body=bytes.slice(0,reportPhotoRangeBytes);body[10]=1;}}
   return rangeResponse(bytes,media,options.headers.range,{body});}});await client.login('a@example.test','password');await assert.rejects(client.media(media),kind==='short'?/incomplete/:kind==='trailing'?/exceeded/:kind==='interrupted'?/interrupted/:/fingerprint/);assert.equal(requests,kind==='altered'?3:1);if(kind==='trailing')assert.equal(cancelled,true);
 }
});
test('revocation, expiry, cancellation and a changed sign-in stop later ranges while stale denials preserve a newer session',async()=>{
 const {bytes,media}=rangedPhoto();
 for(const failure of ['denied','expired','cancelled','signed_out']){
  let now=1000,requests=0,lost=0;const controller=new AbortController();let client;client=new AdminClient({now:()=>now,onSessionLost:()=>lost++,fetchImpl:async(path,options)=>{if(path.endsWith('/login'))return json(session);if(path.endsWith('/me'))return json(member);requests++;
   if(requests===2&&failure==='denied')return json({},403);
   const response=rangeResponse(bytes,media,options.headers.range);if(requests===1){if(failure==='expired')now=1000000;if(failure==='cancelled')controller.abort();if(failure==='signed_out')client.clear();}return response;
  }});await client.login('a@example.test','password');await assert.rejects(client.media(media,{signal:controller.signal}),failure==='denied'?e=>e.status===403:failure==='expired'?e=>e.status===401:failure==='signed_out'?/Session changed/:/interrupted/);assert.equal(requests,failure==='denied'?2:1);assert.equal(lost,['denied','expired'].includes(failure)?1:0);if(failure!=='cancelled')assert.equal(client.session,null);
 }
 let release,requests=0,lost=0;const client=new AdminClient({now:()=>1000,onSessionLost:()=>lost++,fetchImpl:async(path,options)=>path.endsWith('/login')?json(session):path.endsWith('/me')?json(member):(++requests===1?rangeResponse(bytes,media,options.headers.range):new Promise(resolve=>{release=resolve;}))});await client.login('a@example.test','password');const old=client.media(media);while(!release)await new Promise(resolve=>setImmediate(resolve));await client.login('b@example.test','password');const current=client.session;release(json({},403));await assert.rejects(old,e=>e.status===403);assert.equal(requests,2);assert.equal(client.session,current);assert.equal(lost,0);
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
const locationSample={capture_grant_id:'33333333-3333-4333-8333-333333333333',consent_id:'11111111-1111-4111-8111-111111111111',policy_revision:3,policy_sha256:'a'.repeat(64),fix_at_ms:1730000000000,latitude:0,longitude:0,accuracy_m:12,mock:false,server_validation:{version:1,status:'validated_device_observation',policy_revision:3,policy_sha256:'a'.repeat(64),consent_id:'11111111-1111-4111-8111-111111111111',notice_sha256:'b'.repeat(64),geofence:{state:'inside',fence_id:'synthetic-circle',fence_revision:2,distance_m:15}}};
test('received checkpoints distinguish legacy manual history from validated GPS and never imply physical presence',()=>{
 const data={route_id:'route',route_revision:5,checkpoint_id:'entrance',round_id:'closing'},manual=reportPresentation({observation:{kind:'patrol_checkpoint',data}});assert.match(manual.summary,/Manual checkpoint/);assert.equal(Object.fromEntries(manual.rows)['Checkpoint method'],'Manual checkpoint');
 const {capture_grant_id,...location}=structuredClone(locationSample);location.requested_at_ms=location.fix_at_ms-1000;location.notice_revision=2;location.notice_sha256=location.server_validation.notice_sha256;location.server_validation.notice_revision=2;
 const gps=reportPresentation({observation:{kind:'patrol_checkpoint',data:{...data,location}}}),rows=Object.fromEntries(gps.rows);assert.match(gps.summary,/GPS device observation/);assert.equal(rows['Original notice revision'],2);assert.equal(rows['Original notice fingerprint'],'b'.repeat(64));assert.match(rows.Meaning,/does not prove physical presence/);assert.equal('Original capture grant'in rows,false);
 location.notice_revision=3;const invalid=reportPresentation({observation:{kind:'patrol_checkpoint',data:{...data,location}}}),bad=Object.fromEntries(invalid.rows);assert.match(invalid.summary,/GPS validation unavailable/);assert.equal(bad['Server assessment'],'Validation unavailable');assert.equal('Configured geofence ID'in bad,false);
});
test('typed received location preserves original consent, policy and sample attribution and labels only the server assessment',()=>{
 const names={inside:'Inside configured circle',outside:'Outside configured circle',uncertain:'Uncertain relative to configured circle',not_configured:'Geofence not configured'};
 for(const [state,name]of Object.entries(names)){
  const sample=structuredClone(locationSample);sample.server_validation.geofence=state==='not_configured'?{state,fence_id:null,fence_revision:null,distance_m:null}:{...sample.server_validation.geofence,state};
  const view=reportPresentation({observation:{kind:'location',data:sample},media:{state:'not_applicable'}}),rows=Object.fromEntries(view.rows);
  assert.equal(view.title,'Location observation');assert.equal(rows['Server assessment'],name);assert.equal(rows['Original capture grant'],sample.capture_grant_id);assert.equal(rows['Original consent ID'],sample.consent_id);assert.equal(rows['Original policy revision'],3);assert.equal(rows['Original policy fingerprint'],sample.policy_sha256);assert.equal(rows['Original notice fingerprint'],sample.server_validation.notice_sha256);assert.equal(rows.Latitude,0);assert.equal(rows.Longitude,0);assert.match(rows.Meaning,/does not prove physical presence or trigger a geofence alert/);assert.equal(view.photoLabel,'No photo attached');
  assert.equal('Configured geofence ID'in rows,state!=='not_configured');
 }
});
test('missing or mismatched location validation cannot turn malformed observations into a server inside/outside assertion',()=>{
 const changed=[];for(const patch of [{server_validation:undefined},{mock:true},{latitude:'0'},{accuracy_m:0},{fix_at_ms:NaN},{policy_revision:'3'}])changed.push({...structuredClone(locationSample),...patch});
 for(const patch of [{policy_sha256:'c'.repeat(64)},{consent_id:'another-consent'},{notice_sha256:'not-a-hash'},{status:'device_asserted'},{geofence:{state:'not_configured',fence_id:'invented',fence_revision:null,distance_m:null}},{geofence:{state:'inside',fence_id:'fence',fence_revision:1,distance_m:'15'}},{geofence:{state:'<script>alert(1)</script>',fence_id:'fence',fence_revision:1,distance_m:15}}]){const sample=structuredClone(locationSample);Object.assign(sample.server_validation,patch);changed.push(sample);}
 for(const sample of changed){const view=locationReportPresentation(sample),rows=Object.fromEntries(view.rows);assert.equal(view.validated,false);assert.equal(rows['Server assessment'],'Validation unavailable');assert.equal(rows['Original notice fingerprint'],'Unavailable');assert.equal('Configured geofence ID'in rows,false);}
});
