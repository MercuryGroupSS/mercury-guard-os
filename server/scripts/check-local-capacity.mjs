import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash,generateKeyPairSync,randomUUID,sign,verify} from 'node:crypto';
import {availableParallelism} from 'node:os';
import {performance} from 'node:perf_hooks';
import {Client,Pool} from 'pg';
import {PostgresDeviceAssignments} from '../postgres-device-assignments.mjs';
import {PostgresShiftLifecycle} from '../postgres-shift-lifecycle.mjs';
import {PostgresShiftGrantIssuer} from '../postgres-shift-grant-issuer.mjs';
import {PostgresDurableIngest} from '../postgres-durable-ingest.mjs';
import {PostgresGuardDirectory} from '../postgres-guard-directory.mjs';
import {createPostgresAuthSessionReader} from '../postgres-auth-session.mjs';
import {createAssignmentHandler} from '../assignment-handler.mjs';
import {createGrantIngestHandler} from '../grant-ingest-handler.mjs';
import {readPrivateBuildFile} from '../controlled-apk-input.mjs';

// Intentionally finite: no endpoint, credential, concurrency or duration overrides.
if(process.argv.length!==2){
 if(process.argv.length===3&&process.argv[2]==='--help'){
  console.log('Usage: node server/scripts/check-local-capacity.mjs\nOwned loopback55322 only; disposable DB; fixed1/4/8 workers x24 operations; JSON on stdout.');
  process.exit(0);
 }
 throw Error('No capacity overrides supported; see --help');
}
const root=new URL('../../',import.meta.url),migrations=new URL('supabase/migrations/',root);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceFiles=()=>[...readdirSync(new URL('server/',root)).filter(f=>f.endsWith('.mjs')).map(f=>'server/'+f),
 'server/scripts/check-local-capacity.mjs',...readdirSync(migrations).filter(f=>/^\d+.*\.sql$/.test(f)).map(f=>'supabase/migrations/'+f)].sort();
function fingerprint(){return sha(sourceFiles().map(p=>p+'\0'+sha(readFileSync(new URL(p,root)))).join('\n'));}
const round=n=>Math.round(n*1000)/1000;
function timing(samples,elapsed){
 assert.ok(samples.length>0&&samples.every(n=>Number.isFinite(n)&&n>=0)&&elapsed>0);
 const sorted=[...samples].sort((a,b)=>a-b),percentile=p=>sorted[Math.max(0,Math.ceil(p*sorted.length)-1)];
 return {completed:samples.length,elapsed_ms:round(elapsed),operations_per_second:round(samples.length*1000/elapsed),
  latency_ms:{min:round(sorted[0]),p50:round(percentile(.5)),p95:round(percentile(.95)),max:round(sorted.at(-1))}};
}
const settings={connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:12000};
const report={schema_version:1,status:'running',started_at:new Date().toISOString(),
 measurement:'in_process_handlers_with_real_postgres_and_synthetic_session_registry',
 environment:{node:process.version,platform:process.platform,arch:process.arch,logical_cpus:availableParallelism()},
 limits:{pool_max:4,workers:[1,4,8],operations_per_measured_stage:24,deadline_ms:120000,statement_timeout_ms:10000,query_timeout_ms:12000},
 authority:{auth_provider:'none; exact synthetic opaque tokens only',current_sessions:'production PostgreSQL session reader in disposable auth.sessions',
  grant:'production assignment handler, ECDSA enrollment proof, RSA2048 signed grant and current authority',
  ingest:'production signed batch handler, ECDSA P256, original grant/scope and transactional authority checks'},
 stages:[],cleanup:{database_removed:false}};
let owner,fixture,pool,ownerRole,created=false,createAttempted=false,marked=false,stage='configuration',stopped=false;
const runId=randomUUID(),name='mercury_capacity_'+runId.replaceAll('-',''),marker='mercury-capacity-baseline:'+runId,deadline=performance.now()+report.limits.deadline_ms;
const interrupt=()=>{stopped=true;},check=()=>{if(stopped||performance.now()>deadline)throw Error('Capacity run stopped or deadline exceeded');};
process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
const timer=setTimeout(interrupt,report.limits.deadline_ms);timer.unref();
async function wave(count,workers,task){
 const results=Array(count);
 // Await every lane even after failure, before cleanup can close its pool.
 const lanes=await Promise.allSettled(Array.from({length:workers},async(_,lane)=>{
  for(let i=lane;i<count;i+=workers){check();results[i]=await task(i,lane);}
 }));
 const error=lanes.find(r=>r.status==='rejected');if(error)throw error.reason;
 return results;
}
try{
 const local=JSON.parse(readPrivateBuildFile(fileURLToPath(new URL('supabase-start.log',root)),512*1024).toString('utf8').split('\n').findLast(l=>l.startsWith('{')&&l.includes('API_URL'))),url=new URL(local.DB_URL);
 if(local.API_URL!=='http://127.0.0.1:55321'||!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.port!=='55322'||url.pathname!=='/postgres'||url.search||url.hash)throw Error('Owned local Supabase only');
 report.source_sha256=fingerprint();
 const files=readdirSync(migrations).filter(f=>/^\d+.*\.sql$/.test(f)).sort();
 report.migrations=files.map(file=>({file,sha256:sha(readFileSync(new URL(file,migrations)))}));
 stage='disposable_database_setup';
 owner=new Client({connectionString:local.DB_URL,...settings});await owner.connect();
 ownerRole=(await owner.query('SELECT current_user AS owner')).rows[0].owner;
 createAttempted=true;await owner.query('CREATE DATABASE '+name);created=true;
 await owner.query("COMMENT ON DATABASE "+name+" IS '"+marker+"'");marked=true;url.pathname='/'+name;
 fixture=new Client({connectionString:url.toString(),...settings});await fixture.connect();
 assert.equal((await fixture.query('SELECT current_database() AS name')).rows[0].name,name);
 report.environment.postgres=(await fixture.query("SELECT current_setting('server_version') AS version")).rows[0].version;
 await fixture.query('CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),not_after timestamptz);');
 for(const file of files){check();await fixture.query(readFileSync(new URL(file,migrations),'utf8'));}
 pool=new Pool({connectionString:url.toString(),max:4,options:'-c role=service_role',...settings});
 pool.on('error',()=>{stopped=true;});
 // No external Auth request is made: this registry is deliberately NOT a JWT verifier.
 const sessions=new Map(),loadSession=createPostgresAuthSessionReader(pool);
 const verifySession=async token=>{const s=sessions.get(token);return s&&s.expiresAt*1000>Date.now()&&await loadSession(s.subject,s.sessionId)?{...s}:null;};
 const audience='mercury-capacity-local',devices=new PostgresDeviceAssignments(pool,audience),shifts=new PostgresShiftLifecycle(devices),store=new PostgresDurableIngest(devices);
 const rsa=generateKeyPairSync('rsa',{modulusLength:2048}),issuer=new PostgresShiftGrantIssuer({devices,privateKey:rsa.privateKey,keyId:'capacity-only',issuer:audience,audience});
 const directory=new PostgresGuardDirectory({client:pool}),grantHandler=createAssignmentHandler({verifySession,directory,devices,grantIssuer:issuer,store,shiftLifecycle:shifts}),ingestHandler=createGrantIngestHandler({verifySession,directory,devices,grantIssuer:issuer,store,shiftLifecycle:shifts});
 const scopes=[],issued=[],accepted=[],base=Date.now(),vendor='capacity-company',site='capacity-site';
 await fixture.query("INSERT INTO mercury_guard.vendors VALUES($1,'company',true);",[vendor]);
 await fixture.query('INSERT INTO mercury_guard.sites VALUES($1,true)',[site]);
 for(let i=0;i<8;i++){
  check();const identity={subject:randomUUID(),guardId:'capacity-individual-'+i,vendorId:vendor},sessionId=randomUUID(),token=randomUUID();
  await fixture.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[identity.subject,'capacity-'+i+'@example.invalid']);
  await fixture.query('INSERT INTO auth.sessions(id,user_id,not_after) VALUES($1,$2,to_timestamp($3/1000.0))',[sessionId,identity.subject,base+600000]);
  await fixture.query('INSERT INTO mercury_guard.guards VALUES($1,$2,$3,true)',[identity.guardId,identity.subject,vendor]);
  const ec=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),spki=ec.publicKey.export({type:'spki',format:'der'}).toString('base64url'),deviceId='capacity-phone-'+i;
  await devices.enroll({deviceId,mode:'site',siteId:site,active:true,revoked:false,publicKeySpki:spki});
  const device=await devices.device(deviceId),assignment={assignmentId:'capacity-shift-'+i,guardId:identity.guardId,vendorId:vendor,siteId:site,deviceId,startsAt:base-1000,endsAt:base+600000,active:true,canStart:true};
  await devices.assign(assignment);await shifts.transition({identity,assignment,deviceThumbprint:device.thumbprint,request:{action:'start',confirmed:true,request_id:randomUUID(),reason:''},now:base});
  sessions.set(token,{subject:identity.subject,sessionId,active:true,expiresAt:Math.floor((base+600000)/1000)});
  scopes.push({identity,sessionId,token,ec,spki,device,assignment,sequence:0});
 }
 const request=(path,token,raw)=>new Request('https://capacity.invalid'+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:raw});
 async function proofBody(s,assignmentId=s.assignment.assignmentId){
  const c=await devices.challenge(s.identity,s.device.deviceId);
  const signature=sign('sha256',Buffer.from(`mercury-enrollment-proof-v1\n${audience}\n${c.request_id}\n${c.challenge}\n${s.device.thumbprint}`),s.ec.privateKey).toString('base64url');
  return JSON.stringify({assignment_id:assignmentId,proof:{version:1,algorithm:'SHA256withECDSA',audience,request_id:c.request_id,challenge:c.challenge,device_thumbprint:s.device.thumbprint,public_key_spki:s.spki,signature_der:signature}});
 }
 async function invoke(handler,path,s,raw,expected=200){
  const at=performance.now(),response=await handler(request(path,s.token,raw)),body=await response.json(),elapsed=performance.now()-at;
  assert.equal(response.status,expected);return {body,elapsed};
 }
 function keepGrant(s,response){
  assert.equal(verify('sha256',Buffer.from(`mercury-shift-grant-v1.${response.key_id}.${response.payload}`),rsa.publicKey,Buffer.from(response.signature,'base64url')),true);
  const claims=JSON.parse(Buffer.from(response.payload,'base64url'));assert.equal(claims.guard_id,s.identity.guardId);assert.equal(claims.assignment_id,s.assignment.assignmentId);assert.equal(claims.device_thumbprint,s.device.thumbprint);assert.equal(claims.audience,audience);assert.ok(!claims.actions.includes('location'));
  s.claims=claims;issued.push({id:claims.grant_id,payload:response.payload});
 }
 function batch(s){
  const value={batch_id:randomUUID(),schema_version:2,scope:{guard_id:s.identity.guardId,site_id:site,assignment_id:s.assignment.assignmentId,device_thumbprint:s.device.thumbprint,revocation_version:s.device.revocationVersion},events:[{event_id:randomUUID(),sequence:++s.sequence,at:Date.now(),kind:'incident',data:{description:'Synthetic bounded capacity observation',capture_grant_id:s.claims.grant_id}}]};
  const payload=Buffer.from(JSON.stringify(value)).toString('base64url'),raw=JSON.stringify({version:2,algorithm:'SHA256withECDSA',audience,device_thumbprint:s.device.thumbprint,public_key_spki:s.spki,payload,signature_der:sign('sha256',Buffer.from(`mercury-event-batch-v2\n${audience}\n${s.device.thumbprint}\n${payload}`),s.ec.privateKey).toString('base64url')});
  return {raw,value,s};
 }
 function keepBatch(b,receipt){assert.deepEqual(receipt,{batch_id:b.value.batch_id,event_ids:b.value.events.map(e=>e.event_id),status:'accepted_local_only'});accepted.push({...b,receipt});}
 stage='warmup';
 for(const s of scopes){const g=await invoke(grantHandler,'/v1/shift-grant',s,await proofBody(s));keepGrant(s,g.body);const b=batch(s),r=await invoke(ingestHandler,'/v2/batches',s,b.raw);keepBatch(b,r.body);}
 report.warmup={grants:8,incident_batches:8,excluded_from_measurement:true};
 // Fill all four physical pool connections before measuring; retain the normal cap.
 const warmClients=await Promise.allSettled(Array.from({length:4},()=>pool.connect()));
 for(const c of warmClients)if(c.status==='fulfilled')c.value.release();
 const warmFailure=warmClients.find(c=>c.status==='rejected');if(warmFailure)throw warmFailure.reason;
 for(const workers of [1,4,8]){
  stage='grant_'+workers;const latencies=[],start=performance.now();
  await wave(24,workers,async(_,lane)=>{const s=scopes[lane],raw=await proofBody(s),r=await invoke(grantHandler,'/v1/shift-grant',s,raw);latencies.push(r.elapsed);keepGrant(s,r.body);});
  report.stages.push({operation:'shift_grant_handler',workers,...timing(latencies,performance.now()-start),latency_excludes:'challenge generation, device proof signing, RSA result verification',throughput_includes:'challenge generation, device proof signing, handler, RSA result verification'});
 }
 for(const workers of [1,4,8]){
  stage='ingest_'+workers;const latencies=[],start=performance.now();
  await wave(24,workers,async(_,lane)=>{const s=scopes[lane],b=batch(s),r=await invoke(ingestHandler,'/v2/batches',s,b.raw);latencies.push(r.elapsed);keepBatch(b,r.body);});
  report.stages.push({operation:'signed_incident_handler',workers,...timing(latencies,performance.now()-start),latency_excludes:'ECDSA batch construction/signing, receipt assertion',throughput_includes:'ECDSA batch construction/signing, handler, receipt assertion'});
 }
 stage='mixed_retry_and_denial_wave';
 const original=accepted[0],mix=await wave(24,8,async i=>{
  if(i<8){const b=batch(scopes[i]),r=await invoke(ingestHandler,'/v2/batches',b.s,b.raw);keepBatch(b,r.body);return 'new_commit';}
  if(i<16){const r=await invoke(ingestHandler,'/v2/batches',original.s,original.raw);assert.deepEqual(r.body,original.receipt);return 'same_receipt';}
  if(i<20){const changed=JSON.parse(original.raw),value=JSON.parse(Buffer.from(changed.payload,'base64url'));value.events[0].data.description='Unsigned altered payload';changed.payload=Buffer.from(JSON.stringify(value)).toString('base64url');await invoke(ingestHandler,'/v2/batches',original.s,JSON.stringify(changed),400);return 'altered_signature_denied';}
  await invoke(ingestHandler,'/v2/batches',scopes[1],original.raw,400);return 'other_individual_denied';
 });
 assert.deepEqual(Object.fromEntries(['new_commit','same_receipt','altered_signature_denied','other_individual_denied'].map(k=>[k,mix.filter(v=>v===k).length])),{new_commit:8,same_receipt:8,altered_signature_denied:4,other_individual_denied:4});
 report.mixed_wave={workers:8,new_commits:8,exact_retries:8,altered_signature_denials:4,cross_individual_denials:4};
 const history=async()=>sha(JSON.stringify((await fixture.query('SELECT device,id,digest,body FROM mercury_guard.ingest_receipts ORDER BY device,id')).rows));
 const before=await history();
 stage='revoked_session_denial';
 const oldProof=await proofBody(scopes[0]);await fixture.query('DELETE FROM auth.sessions WHERE id=$1',[scopes[0].sessionId]);
 await wave(8,4,async i=>{if(i%2)await invoke(grantHandler,'/v1/shift-grant',scopes[0],oldProof,401);else await invoke(ingestHandler,'/v2/batches',scopes[0],original.raw,401);});
 stage='revoked_device_denial';
 await devices.revoke(scopes[1].device.deviceId);
 const deviceOriginal=accepted.find(b=>b.s===scopes[1]);await wave(4,4,()=>invoke(ingestHandler,'/v2/batches',scopes[1],deviceOriginal.raw,400));
 assert.equal(await history(),before);
 stage='independent_session_still_works';
 const independent=batch(scopes[2]),r=await invoke(ingestHandler,'/v2/batches',scopes[2],independent.raw);keepBatch(independent,r.body);
 report.revocation={deleted_session_grant_denials:4,deleted_session_batch_denials:4,revoked_device_batch_denials:4,existing_receipts_unchanged:true,independent_session_new_commit:1};
 stage='exact_persistence_and_privileges';
 const grants=(await fixture.query('SELECT id,payload FROM mercury_guard.capture_grants')).rows,events=(await fixture.query('SELECT device,id,body FROM mercury_guard.ingested_events')).rows,receipts=(await fixture.query('SELECT device,id,body FROM mercury_guard.ingest_receipts')).rows;
 assert.equal(grants.length,80);assert.equal(events.length,89);assert.equal(receipts.length,89);assert.equal(issued.length,80);assert.equal(accepted.length,89);
 const gm=new Map(grants.map(g=>[g.id,g.payload])),em=new Map(events.map(e=>[e.device+e.id,e.body])),rm=new Map(receipts.map(e=>[e.device+e.id,e.body]));
 for(const g of issued)assert.equal(gm.get(g.id),g.payload);
 for(const b of accepted){assert.deepEqual(rm.get(b.s.device.thumbprint+b.value.batch_id),b.receipt);assert.deepEqual(em.get(b.s.device.thumbprint+b.value.events[0].event_id),{scope:b.value.scope,event:b.value.events[0],vendor_id:vendor});}
 await assert.rejects(pool.query('DELETE FROM mercury_guard.ingest_receipts WHERE false'),/permission denied/);
 await assert.rejects(pool.query("UPDATE mercury_guard.ingested_events SET digest=repeat('0',64) WHERE false"),/permission denied/);
 assert.equal((await fixture.query('SELECT count(*) AS n FROM mercury_guard.login_attempts')).rows[0].n,'0');
 assert.equal((await fixture.query('SELECT count(*) AS n FROM mercury_guard.shift_sessions WHERE clocked_out IS NULL')).rows[0].n,'8');
 check();
 assert.equal(fingerprint(),report.source_sha256);
 report.persistence={grants:80,events:89,receipts:89,all_original_payloads_and_receipts_match:true,service_update_delete_denied:true,unclosed_original_shifts:8,child_login_limiter_rows:0};
 report.status='passed';
}catch(error){
 report.status='failed';report.failure={stage,code:typeof error?.code==='string'&&/^[A-Z0-9_]{1,40}$/.test(error.code)?error.code:'CHECK_FAILED'};
}finally{
 clearTimeout(timer);process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);
 // Never terminate arbitrary sessions or use DROP ... FORCE. Only this owned name.
 for(const close of [()=>pool?.end(),()=>fixture?.end()])try{await close();}catch{report.status='failed';report.cleanup.connections_closed=false;}
 if(createAttempted)try{
  const db=(await owner.query("SELECT pg_get_userbyid(datdba) AS owner,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=$1",[name])).rows[0];
  if(db){
   // An uncertain CREATE is never adopted, even if a database now has our name.
   if(!created||!marked||db.owner!==ownerRole||db.marker!==marker)throw Error('Database ownership not confirmed');
   await owner.query('DROP DATABASE '+name);
  }
  assert.equal((await owner.query('SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname=$1) AS present',[name])).rows[0].present,false);report.cleanup.database_removed=true;
 }catch{report.status='failed';report.cleanup.database_removed=false;}
 else report.cleanup.database_removed=true;
 if(!report.cleanup.database_removed){
  const recovery='capacity-recovery-'+runId+'.json';
  try{writeFileSync(new URL('.local-backend/'+recovery,root),JSON.stringify({run_id:runId,database:name,expected_owner:ownerRole??null,expected_marker:marker,create_confirmed:created,marker_confirmed:marked,automatic_cleanup_confirmed:false},null,2)+'\n',{flag:'wx',mode:0o600});report.cleanup.private_recovery_record='.local-backend/'+recovery;}catch{report.cleanup.private_recovery_record='could_not_write';}
 }
 try{await owner?.end();}catch{report.status='failed';}
 report.finished_at=new Date().toISOString();
 console.log(JSON.stringify(report,null,2));
 if(report.status!=='passed')process.exitCode=1;
}
