import assert from 'node:assert/strict';
import {Client,Pool} from 'pg';
import {readFileSync,readdirSync,writeFileSync,unlinkSync,mkdirSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {request as httpsRequest} from 'node:https';
import {configuredFixture} from '../fixtures/configured-service.mjs';
import {loadConfiguredMaterials,configuredDeploymentIdentity} from '../configured-service-config.mjs';
import {assertConfiguredDeploymentIdentity} from '../configured-database.mjs';
import {openConfiguredRuntime} from '../configured-runtime.mjs';
import {PostgresDashboardInbox} from '../postgres-dashboard-inbox.mjs';
import {ReceiverMappingOwner} from '../receiver-mapping-owner.mjs';
import {receiverMappingLock} from '../dashboard-receiver-input.mjs';
import {projectDashboardObservation} from '../dashboard-delivery.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),settings={connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:12000};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(label,fn){const deadline=Date.now()+10000;while(Date.now()<deadline){if(await fn())return;await pause(20);}throw Error(label);}

// No real Auth provider is called. Actual HTTPS, runtime composition, private
// PostgreSQL transactions, deployment checks and current session rows are used.
export async function verifyPostgresConfiguredReceiver(connectionString,owner){
 const url=new URL(connectionString);if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost'].includes(url.hostname)||url.port!=='55322'||url.search||url.hash)throw Error('Owned disposable loopback PostgreSQL required');
 const run=randomUUID(),name='mercury_receiver_verify_'+run.replaceAll('-',''),marker='mercury-configured-receiver:'+run;
 const record=new URL('../../.local-backend/configured-receiver-verify-'+run+'.json',import.meta.url);
 let attempted=false,created=false,marked=false,fixture,ownerRole,absent=false;
 const save=()=>writeFileSync(record,JSON.stringify({run,database:name,owner:ownerRole??null,marker,create_attempted:attempted,create_confirmed:created,marker_confirmed:marked,cleanup_absent:absent})+'\n',{mode:0o600});
 mkdirSync(new URL('../../.local-backend/',import.meta.url),{recursive:true,mode:0o700});
 writeFileSync(record,'{}',{mode:0o600,flag:'wx'});
 try{
  ownerRole=(await owner.query('SELECT current_user AS role')).rows[0].role;attempted=true;save();await owner.query('CREATE DATABASE '+name);created=true;save();
  await owner.query("COMMENT ON DATABASE "+name+" IS '"+marker+"'");marked=true;save();url.pathname='/'+name;
  fixture=new Client({connectionString:url.toString(),...settings});await fixture.connect();
  await fixture.query('CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),not_after timestamptz);');
  for(const file of readdirSync(new URL('../../supabase/migrations/',import.meta.url)).filter(f=>/^\d+.*\.sql$/.test(f)).sort())await fixture.query(readFileSync(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
  await verifyFixture(url.toString(),fixture,run);
 }finally{
  await fixture?.end();
  if(attempted){
   const db=(await owner.query("SELECT pg_get_userbyid(datdba) AS owner,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=$1",[name])).rows[0];
   if(db){if(!created||!marked||db.owner!==ownerRole||db.marker!==marker)throw Error('Receiver test database cleanup ownership unconfirmed; private record retained');await owner.query('DROP DATABASE '+name);}
   assert.equal((await owner.query('SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname=$1) AS present',[name])).rows[0].present,false);
  }
  absent=true;save();unlinkSync(record);console.log('PASS: exact configured receiver verification database and ownership record removed');
 }
}
async function verifyFixture(connectionString,owner,run){
 const f=configuredFixture({port:55452}),config=f.config,materials=loadConfiguredMaterials(config),identity=configuredDeploymentIdentity(config,materials);
 config.database.url=connectionString;
 const dedicated='synthetic-configured-receiver-'+run,receiverFile=f.save('receiver.json',JSON.stringify({version:1,destination:'verified-inbox',token:dedicated}));
 const ownerPool=new Pool({connectionString,max:2,...settings}),servicePool=new Pool({connectionString,max:2,options:'-c role=service_role',...settings}),applicationName='receiver-acceptance-'+run;
 let runtime,slowRequest,heldLock=false;
 const adminSubject=randomUUID(),guardSubject=randomUUID(),adminSession=randomUUID(),otherSession=randomUUID(),guardSession=randomUUID(),exp=Math.floor(Date.now()/1000)+3600;
 const jwt=(sub,id)=>['synthetic',Buffer.from(JSON.stringify({sub,session_id:id,exp})).toString('base64url'),'signature'].join('.');
 const adminToken=jwt(adminSubject,adminSession),otherToken=jwt(adminSubject,otherSession),guardToken=jwt(guardSubject,guardSession),known=new Map([[adminToken,adminSubject],[otherToken,adminSubject],[guardToken,guardSubject]]);
 const provider=async(url,options)=>{assert.ok(url.startsWith(config.auth.origin+'/auth/v1/'));assert.equal(options.redirect,'error');if(url.endsWith('/settings'))return Response.json({mailer_autoconfirm:false,external:{email:true},disable_signup:false});if(url.endsWith('/user')){const subject=known.get(options.headers.authorization?.slice(7));return subject?Response.json({id:subject}):new Response(null,{status:401});}throw Error('Unexpected synthetic Auth request');};
 const schedule=()=>({unref(){}}),cancel=()=>{},poolFactory=options=>new Pool({...options,application_name:applicationName});
 function call(path,{token=dedicated,body,contentType='application/json',headers={},method}={}){
  return new Promise((resolve,reject)=>{const req=httpsRequest({hostname:'127.0.0.1',servername:'localhost',port:config.listen.port,path,method:method??(body===undefined?'GET':'POST'),ca:materials.certificate,headers:{host:new URL(config.public_origin).host,...(token?{authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'content-type':contentType}),...headers}},res=>{const chunks=[];let size=0;res.on('data',b=>{size+=b.length;if(size>262144)req.destroy(Error('Bounded receiver response required'));else chunks.push(b);});res.on('end',()=>{const bytes=Buffer.concat(chunks);let data;try{data=JSON.parse(bytes);}catch{data=null;}resolve({status:res.statusCode,headers:res.headers,data,bytes});});});req.setTimeout(15000,()=>req.destroy(Error('Receiver TLS test timeout')));req.on('error',reject);req.end(body);});
 }
 const mapping={assignmentId:'receiver-assignment',guardId:'receiver-guard',vendorId:'receiver-company',siteId:'receiver-site',dashboardShiftId:'receiver-upstream',destination:'verified-inbox',revision:1,active:true},route='/v1/mercury-one/observations';
 const project=(kind,data)=>projectDashboardObservation({vendor_id:mapping.vendorId,scope:{assignment_id:mapping.assignmentId,guard_id:mapping.guardId,site_id:mapping.siteId,device_thumbprint:'c'.repeat(64)},event:{event_id:randomUUID(),kind,at:Date.now(),data}},mapping);
 const ownerMapping=new ReceiverMappingOwner(ownerPool),approve=async value=>ownerMapping.approve({requestId:randomUUID(),mapping:value,operator:'Synthetic receiver owner',reason:'Disposable configured HTTPS acceptance only'});
 const markerOn=()=>owner.query('UPDATE mercury_guard.deployment_identity SET issuer_key_id=$1',[identity.issuer_key_id]),markerOff=()=>owner.query("UPDATE mercury_guard.deployment_identity SET issuer_key_id='withdrawn-receiver-fixture'");
 const count=table=>owner.query('SELECT count(*) AS n FROM mercury_guard_receiver.'+table).then(r=>Number(r.rows[0].n));
 try{
  await owner.query('INSERT INTO mercury_guard.deployment_identity(deployment_id,auth_origin,public_origin,issuer,audience,issuer_key_id,issuer_spki_sha256,approved_by,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[...Object.values(identity),'Synthetic receiver owner','Disposable configured receiver only']);
  await owner.query('INSERT INTO auth.users(id,email) VALUES($1,$2),($3,$4)',[adminSubject,'receiver-admin@example.invalid',guardSubject,'receiver-guard@example.invalid']);
  for(const [id,subject] of [[adminSession,adminSubject],[otherSession,adminSubject],[guardSession,guardSubject]])await owner.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)',[id,subject]);
  await owner.query('INSERT INTO mercury_guard.admin_accounts(auth_subject,email,active) VALUES($1,$2,true)',[adminSubject,'receiver-admin@example.invalid']);
  runtime=await openConfiguredRuntime(config,materials,{fetchImpl:provider,poolFactory,schedule,cancel});await runtime.start();assert.equal((await call(route,{body:'{}'})).status,404);await runtime.close();runtime=null;
  config.dashboard_receiver={configuration_path:receiverFile};runtime=await openConfiguredRuntime(config,materials,{fetchImpl:provider,poolFactory,schedule,cancel});assert.equal((await runtime.check()).status,'configuration_verified');await runtime.start();
  for(const token of [null,'wrong-private-token',adminToken,guardToken,config.auth.server_key,config.auth.publishable_key])assert.equal((await call(route,{token,body:'{}'})).status,401);
  assert.equal((await call(route,{body:'{}',headers:{host:'foreign.invalid'}})).status,421);assert.equal((await call(route,{body:'{}',headers:{'x-forwarded-host':new URL(config.public_origin).host}})).status,421);assert.equal((await call(route,{body:'{}',headers:{origin:'https://foreign.invalid'}})).status,403);
  const incident=project('incident',{description:'Synthetic configured HTTPS report'}),raw=JSON.stringify(incident);
  assert.equal((await call(route,{body:raw})).status,403);assert.equal(await count('observations'),0);await approve(mapping);
  const accepted=await call(route,{body:raw});assert.equal(accepted.status,200);assert.equal(accepted.data.status,'stored_in_integration_inbox');assert.equal(accepted.data.payload_sha256,hash(raw));
  const retries=await Promise.all([call(route,{body:raw}),call(route,{body:raw})]);for(const r of retries){assert.equal(r.status,200);assert.deepEqual(r.data,accepted.data);}assert.equal(await count('observations'),1);
  const changed=structuredClone(incident);changed.observation.data.description='Changed immutable body';assert.equal((await call(route,{body:JSON.stringify(changed)})).status,400);
  // A trusted commit callback runs on the actual transaction client. Changing
  // the marker after SQL INSERT but before its final check must roll back rows.
  let calls=0;const rolling=new PostgresDashboardInbox(servicePool,{authorizeCommit:async client=>{assert.notEqual(client,servicePool);if(++calls===2)await markerOff();await assertConfiguredDeploymentIdentity(client,identity);}});
  const rolled=project('incident',{description:'This receiver insert must roll back'});await assert.rejects(rolling.accept(rolled,JSON.stringify(rolled)));assert.equal(calls,2);assert.equal(await count('observations'),1);await markerOn();
  const bytes=Buffer.from(readFileSync(new URL('../fixtures/receiver-photo.base64',import.meta.url),'utf8').trim(),'base64'),photo=project('photo_evidence',{evidence_id:randomUUID(),sha256:hash(bytes),bytes:bytes.length,width:192,height:108,capture:'camera_intent'}),photoRaw=JSON.stringify(photo),mediaPath='/v1/mercury-one/media/'+photo.delivery_id;
  assert.equal((await call(route,{body:photoRaw})).status,200);
  const catalog=()=>call('/v1/admin/catalog?kind=received_reports',{token:adminToken});let page=(await catalog()).data;assert.equal(page.items.find(i=>i.delivery_id===photo.delivery_id).media.state,'pending');
  calls=0;await assert.rejects(rolling.acceptMedia(photo.delivery_id,mapping.destination,bytes));assert.equal(calls,2);assert.equal(await count('media'),0);await markerOn();
  assert.equal((await call(mediaPath)).status,405);assert.equal((await call(mediaPath,{token:guardToken,body:bytes,contentType:'image/jpeg'})).status,401);
  assert.equal((await call(mediaPath,{body:Buffer.from(bytes).fill(0,20,30),contentType:'image/jpeg'})).status,400);assert.equal(await count('media'),0);
  // Hold the existing mapping lock until the HTTPS request is demonstrably in
  // metadata lookup. After it commits, keep the body incomplete, change the
  // deployment, then complete bytes: the committing upload must be rejected.
  await owner.query('SELECT pg_advisory_lock($1::bigint)',[receiverMappingLock(mapping)]);heldLock=true;
  const slowResult=new Promise((resolve,reject)=>{slowRequest=httpsRequest({hostname:'127.0.0.1',servername:'localhost',port:config.listen.port,path:mediaPath,method:'POST',ca:materials.certificate,headers:{host:new URL(config.public_origin).host,authorization:'Bearer '+dedicated,'content-type':'image/jpeg','content-length':bytes.length}},res=>{let raw='';res.on('data',b=>raw+=b);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(raw)}));});slowRequest.setTimeout(15000,()=>slowRequest.destroy(Error('Slow media test timed out')));slowRequest.on('error',reject);slowRequest.write(bytes.subarray(0,8));});
  // Attach immediately so setup failures cannot leave an unhandled rejection.
  void slowResult.catch(()=>{});
  await until('Receiver metadata did not wait for owned mapping lock',async()=>Number((await owner.query("SELECT count(*) AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[applicationName])).rows[0].n)>0);
  await owner.query('SELECT pg_advisory_unlock($1::bigint)',[receiverMappingLock(mapping)]);heldLock=false;
  await until('Receiver metadata transaction did not complete',async()=>Number((await owner.query("SELECT count(*) AS n FROM pg_stat_activity WHERE application_name=$1 AND state<>'idle'",[applicationName])).rows[0].n)===0);
  await markerOff();slowRequest.end(bytes.subarray(8));const denied=await slowResult;assert.equal(denied.status,400);assert.equal(denied.body.error,'media_rejected');assert.equal(await count('media'),0);assert.equal((await call(route,{body:raw})).status,503);await markerOn();
  const media=await call(mediaPath,{body:bytes,contentType:'image/jpeg'});assert.equal(media.status,200);assert.equal(media.data.status,'media_stored_in_integration_inbox');assert.equal(media.data.sha256,hash(bytes));assert.equal(await count('media'),1);
  assert.deepEqual((await call(mediaPath,{body:bytes,contentType:'image/jpeg'})).data,media.data);
  page=(await catalog()).data;assert.equal(page.items.length,2);assert.equal(page.items.find(i=>i.delivery_id===photo.delivery_id).media.state,'stored');
  const privatePath='/v1/admin/media/'+photo.delivery_id,image=await call(privatePath,{token:adminToken});assert.equal(image.status,200);assert.equal(image.headers['content-type'],'image/jpeg');assert.equal(image.headers['cache-control'],'no-store');assert.deepEqual(image.bytes,bytes);
  assert.equal((await call(privatePath,{token:null})).status,401);assert.equal((await call(privatePath,{token:guardToken})).status,403);assert.equal((await call(privatePath)).status,401);
  calls=0;await assert.rejects(rolling.acceptMedia(photo.delivery_id,mapping.destination,bytes));assert.equal(calls,2);await markerOn();assert.equal(await count('media'),1);assert.deepEqual((await call(privatePath,{token:adminToken})).bytes,bytes);
  await approve({...mapping,revision:2,active:false});assert.equal((await call(route,{body:raw})).status,403);assert.equal((await call(mediaPath,{body:bytes,contentType:'image/jpeg'})).status,403);assert.deepEqual((await call(privatePath,{token:adminToken})).bytes,bytes);
  await owner.query('DELETE FROM auth.sessions WHERE id=$1',[adminSession]);assert.equal((await catalog()).status,401);assert.equal((await call(privatePath,{token:adminToken})).status,401);assert.equal((await call(privatePath,{token:otherToken})).status,200);
  await owner.query('UPDATE mercury_guard.admin_accounts SET active=false WHERE auth_subject=$1',[adminSubject]);assert.equal((await call(privatePath,{token:otherToken})).status,403);
  assert.equal(await count('observations'),2);assert.equal(await count('media'),1);
  await runtime.close();await runtime.close();assert.equal(runtime.status().started,false);await assert.rejects(call(route,{body:raw}));await assert.rejects(runtime.start(),/closed/);
  console.log('PASS: explicit configured receiver HTTPS, independent token/mapping, exact metadata/media retries, same-transaction marker rollback and slow-upload denial, current-session/admin Reports/private JPEG, historical audit and shutdown (synthetic Auth provider)');
 }finally{
  slowRequest?.destroy();if(heldLock)await owner.query('SELECT pg_advisory_unlock($1::bigint)',[receiverMappingLock(mapping)]);
  await runtime?.close();await servicePool.end();await ownerPool.end();f.close();
 }
}
