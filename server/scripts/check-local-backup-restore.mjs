#!/usr/bin/env node
// A logical recovery drill, never a backup of the running local application.
import assert from 'node:assert/strict';
import {Client,Pool} from 'pg';
import {execFile} from 'node:child_process';
import {createHash,randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {mkdtempSync,chmodSync,readFileSync,readdirSync,writeFileSync,rmSync,openSync,closeSync,constants} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {isDeepStrictEqual} from 'node:util';
import {readPrivateBuildFile} from '../controlled-apk-input.mjs';
import {PostgresDeviceAssignments} from '../postgres-device-assignments.mjs';
import {PostgresShiftLifecycle} from '../postgres-shift-lifecycle.mjs';
import {PostgresShiftGrantIssuer} from '../postgres-shift-grant-issuer.mjs';
import {PostgresDurableIngest} from '../postgres-durable-ingest.mjs';
import {PostgresDashboardBindings,PostgresDashboardOutbox} from '../postgres-dashboard-delivery.mjs';
import {PostgresDashboardMedia} from '../postgres-dashboard-media.mjs';
import {PostgresDashboardInbox} from '../postgres-dashboard-inbox.mjs';
import {ReceiverMappingOwner} from '../receiver-mapping-owner.mjs';

process.umask(0o077);
const hash=value=>createHash('sha256').update(value).digest('hex'),run=randomUUID(),suffix=run.replaceAll('-','');
const container='supabase_db_mercury-guard-os-local',source='mercury_backup_source_'+suffix,target='mercury_backup_restore_'+suffix;
const maxArchive=8*1024*1024,started=performance.now(),resources=[],databases=[];
let temporary,metadata,admin,phase='preflight',containerId,checks,result,failure,cleanupFailure;
const identifier=value=>{assert.match(value,/^[a-z_][a-z0-9_]*$/);return '"'+value+'"';};
function record(){if(metadata)writeFileSync(metadata,JSON.stringify({version:1,run,container,container_id:containerId,host:'127.0.0.1',port:55322,source,target,phase,databases},null,2)+'\n',{mode:0o600,flag:'w'});}
function command(args,{input,binary=false}={}){
 return new Promise((resolve,reject)=>{
  let stdinFailure=false;
  const child=execFile('docker',args,{encoding:binary?null:'utf8',timeout:45000,maxBuffer:maxArchive},(error,stdout,stderr)=>{
   if(error||stdinFailure||Buffer.byteLength(stderr??'')){if(temporary)writeFileSync(join(temporary,'private-diagnostic.log'),Buffer.concat([Buffer.from(stdout??''),Buffer.from(stderr??'')]),{mode:0o600});reject(Error('Local PostgreSQL utility failed'));}
   else resolve(stdout);
  });
  // An early utility exit is reported by execFile's callback. Absorb the pipe
  // error so it cannot bypass the ownership-aware cleanup in finally.
  child.stdin.on('error',()=>{stdinFailure=true;});
  child.stdin.end(input);
 });
}
const connection=(base,name)=>{const u=new URL(base);u.pathname='/'+name;return u.toString();};
const pool=(url,role=false)=>{const p=new Pool({connectionString:url,max:2,connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:12000,...(role?{options:'-c role=service_role'}:{})});resources.push(p);return p;};
async function createDatabase(name){
 assert.match(name,/^mercury_backup_(?:source|restore)_[a-f0-9]{32}$/);
 assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount,0);
 const entry={name,attempted:true,confirmed:false,marked:false};databases.push(entry);record();
 await admin.query('CREATE DATABASE '+identifier(name));entry.confirmed=true;record();
 await admin.query('COMMENT ON DATABASE '+identifier(name)+" IS 'mercury-guard-backup-drill:"+run+"'");entry.marked=true;record();
}
async function snapshot(owner){
 const tables=(await owner.query(`SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('auth','mercury_guard','mercury_guard_receiver') OR (schemaname='public' AND tablename='guard_authorizations') ORDER BY schemaname,tablename`)).rows;
 const rows={};let records=0;
 for(const t of tables){const name=t.schemaname+'.'+t.tablename;rows[name]=(await owner.query('SELECT row_to_json(t)::text AS raw FROM '+identifier(t.schemaname)+'.'+identifier(t.tablename)+' t ORDER BY row_to_json(t)::text COLLATE "C"')).rows.map(r=>r.raw);records+=rows[name].length;}
 const schemas=(await owner.query("SELECT nspname,pg_get_userbyid(nspowner) owner,COALESCE(nspacl,acldefault('n',nspowner))::text[] AS nspacl FROM pg_namespace WHERE nspname IN ('auth','public','mercury_guard','mercury_guard_receiver') ORDER BY nspname")).rows;
 const relations=(await owner.query(`SELECT n.nspname,c.relname,c.relkind,pg_get_userbyid(c.relowner) owner,c.relrowsecurity,c.relforcerowsecurity,COALESCE(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))::text[] AS relacl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname IN ('auth','mercury_guard','mercury_guard_receiver') OR (n.nspname='public' AND c.relname='guard_authorizations')) AND c.relkind IN ('r','S') ORDER BY n.nspname,c.relname`)).rows;
 const columns=(await owner.query(`SELECT n.nspname,c.relname,a.attname,COALESCE(a.attacl,acldefault('c',c.relowner))::text[] AS attacl FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname IN ('auth','mercury_guard','mercury_guard_receiver') OR (n.nspname='public' AND c.relname='guard_authorizations')) AND a.attnum>0 AND NOT a.attisdropped ORDER BY n.nspname,c.relname,a.attnum`)).rows;
 const functions=(await owner.query("SELECT n.nspname,p.proname,pg_get_userbyid(p.proowner) owner,pg_get_function_identity_arguments(p.oid) args,COALESCE(p.proacl,acldefault('f',p.proowner))::text[] AS proacl,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('mercury_guard','mercury_guard_receiver') ORDER BY n.nspname,p.proname,args")).rows;
 // NULL ACL means PostgreSQL's object/owner-specific default, not no access.
 // Expand that default and sort entries; never discard a grantor or privilege.
 for(const rows of [schemas,relations,columns,functions])for(const row of rows)for(const name of ['nspacl','relacl','attacl','proacl'])if(Array.isArray(row[name]))row[name].sort();
 const constraints=(await owner.query("SELECT n.nspname,c.relname,k.conname,k.convalidated,pg_get_constraintdef(k.oid,true) definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('auth','mercury_guard','mercury_guard_receiver') OR (n.nspname='public' AND c.relname='guard_authorizations') ORDER BY n.nspname,c.relname,k.conname")).rows;
 const indexes=(await owner.query("SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname IN ('auth','mercury_guard','mercury_guard_receiver') OR (schemaname='public' AND tablename='guard_authorizations') ORDER BY schemaname,tablename,indexname")).rows;
 const sequences={};for(const r of relations.filter(r=>r.relkind==='S'))sequences[r.nspname+'.'+r.relname]=(await owner.query('SELECT last_value::text,is_called FROM '+identifier(r.nspname)+'.'+identifier(r.relname))).rows[0];
 return {rows,schemas,relations,columns,functions,constraints,indexes,sequences,table_count:tables.length,record_count:records};
}
async function seed(owner,service){
 const now=Date.now(),identity={subject:randomUUID(),guardId:'restore-guard',vendorId:'restore-company'},siteId='restore-site',deviceId='restore-phone';
 await owner.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[identity.subject,'restore-only@example.invalid']);
 const session={subject:identity.subject,sessionId:randomUUID(),active:true,expiresAt:Math.floor(now/1000)+3600};await owner.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)',[session.sessionId,identity.subject]);
 await owner.query("INSERT INTO mercury_guard.vendors VALUES($1,'company',true)",[identity.vendorId]);await owner.query('INSERT INTO mercury_guard.sites VALUES($1,true)',[siteId]);
 await owner.query('INSERT INTO mercury_guard.guards VALUES($1,$2,$3,true)',[identity.guardId,identity.subject,identity.vendorId]);await owner.query('INSERT INTO mercury_guard.guard_login VALUES($1,$2)',[identity.guardId,'restore-only@example.invalid']);
 const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),spki=keys.publicKey.export({format:'der',type:'spki'}).toString('base64url'),devices=new PostgresDeviceAssignments(service);
 await devices.enroll({deviceId,mode:'site',siteId,active:true,revoked:false,publicKeySpki:spki});const device=await devices.device(deviceId);
 const assignment={assignmentId:'restore-assignment',guardId:identity.guardId,vendorId:identity.vendorId,siteId,deviceId:device.deviceId,canStart:true,active:true,startsAt:now-1000,endsAt:now+3600000};await devices.assign(assignment);
 const start={action:'start',confirmed:true,request_id:randomUUID(),reason:''},shiftReceipt=await new PostgresShiftLifecycle(devices).transition({identity,session,assignment,deviceThumbprint:device.thumbprint,request:start,now});
 const issuer=new PostgresShiftGrantIssuer({devices,privateKey:generateKeyPairSync('rsa',{modulusLength:2048}).privateKey,keyId:'restore-synthetic',issuer:'mercury-local',audience:'mercury-local'});
 const issued=await issuer.issue({identity,session,assignment,device,now,sessionExpiresAt:now+600000,allowedActions:['incident','photo']}),claims=JSON.parse(Buffer.from(issued.payload,'base64url'));
 const bytes=Buffer.from(readFileSync(new URL('../fixtures/receiver-photo.base64',import.meta.url),'utf8').trim(),'base64');
 const events=[{event_id:randomUUID(),sequence:1,at:now,kind:'incident',data:{capture_grant_id:claims.grant_id,description:'Synthetic recovery drill — preserve exact history'}},{event_id:randomUUID(),sequence:2,at:now,kind:'photo_evidence',data:{capture_grant_id:claims.grant_id,evidence_id:randomUUID(),sha256:hash(bytes),bytes:bytes.length,width:192,height:108,capture:'camera_intent'}}];
 const context={session,subject:identity.subject,guardId:identity.guardId,vendorId:identity.vendorId,siteId,assignmentId:assignment.assignmentId,thumbprint:device.thumbprint,publicKeySpki:spki,revocationVersion:1,enrolled:true,revoked:false,audience:'mercury-local',allowedKinds:['incident','photo_evidence'],notBefore:Math.floor(now/1000)-1,expiresAt:Math.floor(now/1000)+600,receivedAtMs:now+1000,allowHistoricalSequence:true};
 const batch={batch_id:randomUUID(),schema_version:2,scope:{guard_id:identity.guardId,site_id:siteId,assignment_id:assignment.assignmentId,device_thumbprint:device.thumbprint,revocation_version:1},events},payload=Buffer.from(JSON.stringify(batch)).toString('base64url');
 const raw=JSON.stringify({version:2,algorithm:'SHA256withECDSA',audience:context.audience,device_thumbprint:device.thumbprint,public_key_spki:spki,payload,signature_der:sign('sha256',Buffer.from(`mercury-event-batch-v2\n${context.audience}\n${device.thumbprint}\n${payload}`),keys.privateKey).toString('base64url')});
 const store=new PostgresDurableIngest(devices),ingestReceipt=await store.ingest(raw,context,Math.floor(now/1000)),photo=await store.photoForGuard(identity.guardId,events[1].event_id);await store.retainPhoto(photo,bytes,now+1000,session);
 const mapping={assignmentId:assignment.assignmentId,guardId:identity.guardId,vendorId:identity.vendorId,siteId,dashboardShiftId:'restore-upstream',destination:'restore-private-inbox',revision:1,active:true};await new PostgresDashboardBindings(devices).approve(mapping);
 const approval={requestId:randomUUID(),mapping,operator:'Synthetic restore drill',reason:'Disposable backup and restore verification only'};await new ReceiverMappingOwner(owner).approve(approval);
 const inbox=new PostgresDashboardInbox(service),queue=new PostgresDashboardOutbox(devices),photoId=await queue.enqueue(photo,mapping),photoJob=await queue.claim(1000);assert.equal(photoJob.id,photoId);
 const photoValue=JSON.parse(photoJob.body),photoReceipt=await inbox.accept(photoValue,photoJob.body);await queue.accepted(photoJob,photoReceipt);const mediaReceipt=await inbox.acceptMedia(photoId,mapping.destination,bytes);
 const mediaQueue=new PostgresDashboardMedia(devices);let mediaLease=await mediaQueue.claim(1000);assert.ok(mediaLease);await mediaQueue.retry(mediaLease,2000);mediaLease=await mediaQueue.claim(4000);assert.ok(mediaLease);
 const incident=(await owner.query('SELECT body FROM mercury_guard.ingested_events WHERE id=$1',[events[0].event_id])).rows[0].body;const incidentId=await queue.enqueue(incident,mapping);let incidentLease=await queue.claim(1000);assert.equal(incidentLease.id,incidentId);await queue.retry(incidentLease,2000);incidentLease=await queue.claim(4000);assert.ok(incidentLease);
 return {now,identity,session,assignment,device,start,shiftReceipt,raw,context,ingestReceipt,bytes,photoValue,photoReceipt,photoId,mediaReceipt,mediaLease,incidentLease,mapping};
}
async function verifyRecovery(owner,service,f){
 const devices=new PostgresDeviceAssignments(service),store=new PostgresDurableIngest(devices),inbox=new PostgresDashboardInbox(service),queue=new PostgresDashboardOutbox(devices),media=new PostgresDashboardMedia(devices);
 assert.deepEqual(await store.ingest(f.raw,f.context,Math.floor(f.now/1000)),f.ingestReceipt);
 assert.deepEqual(await new PostgresShiftLifecycle(devices).transition({identity:f.identity,session:f.session,assignment:f.assignment,deviceThumbprint:f.device.thumbprint,request:f.start,now:f.now+1000}),f.shiftReceipt);
 assert.deepEqual(await inbox.accept(f.photoValue,JSON.stringify(f.photoValue)),f.photoReceipt);assert.deepEqual(await inbox.acceptMedia(f.photoId,f.mapping.destination,f.bytes),f.mediaReceipt);
 for(const sql of ["UPDATE mercury_guard.ingested_events SET body='{}'::jsonb",'DELETE FROM mercury_guard.ingest_receipts','DELETE FROM mercury_guard.ingested_media',"UPDATE mercury_guard_receiver.observations SET raw_body='changed'",'DELETE FROM mercury_guard_receiver.media','DELETE FROM mercury_guard_receiver.mapping_history'])await assert.rejects(service.query(sql),e=>e.code==='42501');
 for(const role of ['anon','authenticated']){const c=await owner.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE '+role);await assert.rejects(c.query('SELECT * FROM mercury_guard.ingested_events'),e=>e.code==='42501');await c.query('ROLLBACK');await c.query('BEGIN');await c.query('SET LOCAL ROLE '+role);await assert.rejects(c.query('SELECT * FROM mercury_guard_receiver.media'),e=>e.code==='42501');await c.query('ROLLBACK');}finally{c.release();}}
 await assert.rejects(service.query("INSERT INTO mercury_guard.vendors VALUES('invalid-restore-kind','invalid',true)"),e=>e.code==='23514');
 await assert.rejects(service.query('INSERT INTO mercury_guard.guards VALUES($1,$2,$3,true)',['invalid-restore-subject',randomUUID(),f.identity.vendorId]),e=>e.code==='23503');
 assert.equal(await queue.claim(4001),null);const delivery=await queue.claim(124001);assert.equal(delivery.id,f.incidentLease.id);assert.equal(delivery.body,f.incidentLease.body);assert.notEqual(delivery.lease,f.incidentLease.lease);
 const receipt=await inbox.accept(JSON.parse(delivery.body),delivery.body);await assert.rejects(queue.accepted(f.incidentLease,receipt));await queue.accepted(delivery,receipt);
 const mediaJob=await media.claim(124001);assert.equal(mediaJob.id,f.mediaLease.id);assert.deepEqual(mediaJob.bytes,f.bytes);assert.notEqual(mediaJob.lease,f.mediaLease.lease);await assert.rejects(media.accepted(f.mediaLease,f.mediaReceipt));await media.accepted(mediaJob,f.mediaReceipt);
 const n=(await owner.query("SELECT nextval('mercury_guard.ingested_events_cursor_seq')::text n")).rows[0].n;assert.equal(n,'3');
 return {immutable_receipts_replayed:true,source_receiver_jpeg_exact:true,expired_leases_reclaimed:true,stale_leases_denied:true,private_access_denied:true,append_only_denied:true,foreign_key_and_check_enforced:true,sequence_continued:true};
}
try{
 if(process.argv.length!==2)throw Error('No arguments accepted');
 const text=readPrivateBuildFile(new URL('../../supabase-start.log',import.meta.url).pathname,65536).toString('utf8'),line=text.split('\n').findLast(l=>l.startsWith('{')&&l.includes('DB_URL'));if(!line)throw Error('Local configuration missing');
 const local=JSON.parse(line),url=new URL(local.DB_URL);if(local.API_URL!=='http://127.0.0.1:55321'||url.protocol!=='postgresql:'||url.hostname!=='127.0.0.1'||url.port!=='55322'||url.pathname!=='/postgres'||url.search||url.hash||url.username!=='postgres')throw Error('Exact owned loopback database required');
 const inspection=(await command(['inspect','--format','{{.Id}}\n{{json .NetworkSettings.Ports}}',container])).trim().split('\n');containerId=inspection[0];assert.match(containerId,/^[a-f0-9]{64}$/);assert.deepEqual(JSON.parse(inspection[1]),{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'55322'}]});
 const dumpVersion=(await command(['exec','--user','postgres',container,'pg_dump','--version'])).trim(),restoreVersion=(await command(['exec','--user','postgres',container,'pg_restore','--version'])).trim();assert.match(dumpVersion,/^pg_dump \(PostgreSQL\) 17\.\d+$/);assert.equal(restoreVersion.replace('pg_restore','pg_dump'),dumpVersion);
 temporary=mkdtempSync(join(tmpdir(),'mercury-backup-drill-'+run+'-'));chmodSync(temporary,0o700);metadata=join(temporary,'OWNERSHIP.json');writeFileSync(metadata,'{}',{mode:0o600,flag:'wx'});record();
 admin=new Client({connectionString:local.DB_URL,connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:12000});await admin.connect();assert.equal(Math.floor(Number((await admin.query('SHOW server_version_num')).rows[0].server_version_num)/10000),17);
 phase='create_source';await createDatabase(source);const sourceOwner=pool(connection(local.DB_URL,source)),sourceService=pool(connection(local.DB_URL,source),true);
 await sourceOwner.query('CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),not_after timestamptz);');
 const migrations=readdirSync(new URL('../../supabase/migrations/',import.meta.url)).filter(x=>/^\d+.*\.sql$/.test(x)).sort(),migrationHash=createHash('sha256');
 for(const file of migrations){const bytes=readFileSync(new URL('../../supabase/migrations/'+file,import.meta.url));migrationHash.update(file+'\n').update(bytes);await sourceOwner.query(bytes.toString('utf8'));}
 phase='seed_synthetic';record();const fixture=await seed(sourceOwner,sourceService),before=await snapshot(sourceOwner);
 phase='dump_unique_source';record();const dumpAt=performance.now(),archive=await command(['exec','--user','postgres',container,'pg_dump','--username=postgres','--no-password','--format=custom','--no-owner','--dbname='+source],{binary:true});assert.ok(archive.length>0&&archive.length<=maxArchive);
 const dump=join(temporary,'synthetic-guard.dump');let fd;try{fd=openSync(dump,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);writeFileSync(fd,archive);}finally{if(fd!==undefined)closeSync(fd);}const dumpMs=performance.now()-dumpAt;
 phase='create_restore_target';await createDatabase(target);phase='restore_empty_target';record();const restoreAt=performance.now(),privateArchive=readPrivateBuildFile(dump,maxArchive);assert.equal(hash(privateArchive),hash(archive));
 await command(['exec','--interactive','--user','postgres',container,'pg_restore','--username=postgres','--no-password','--no-owner','--exit-on-error','--single-transaction','--dbname='+target],{input:privateArchive});const restoreMs=performance.now()-restoreAt;
 const targetOwner=pool(connection(local.DB_URL,target)),targetService=pool(connection(local.DB_URL,target),true),after=await snapshot(targetOwner);
 for(const facet of Object.keys(before)){phase='compare_'+facet;record();try{assert.deepEqual(after[facet],before[facet]);}catch(error){
  if(facet==='relations')error.comparison=before.relations.flatMap((row,i)=>{const restored=after.relations[i];if(isDeepStrictEqual(row,restored))return [];const fields=Object.keys(row).filter(k=>!isDeepStrictEqual(row[k],restored?.[k]));return [{object:row.nspname+'.'+row.relname,fields,original_acl:row.relacl,restored_acl:restored?.relacl}];}).slice(0,5);
  throw error;
 }}
 phase='resume_original_scope';record();checks=await verifyRecovery(targetOwner,targetService,fixture);
 result={status:'passed',scope:'synthetic_local_guard_logical_recovery',auth:'synthetic_dependency_tables_only',external_key_backup:false,utility:dumpVersion,migration_count:migrations.length,migration_sha256:migrationHash.digest('hex'),script_sha256:hash(readFileSync(new URL(import.meta.url))),tables_compared:before.table_count,records_compared:before.record_count,archive_bytes:archive.length,archive_sha256:hash(archive),exact_rows_bytes_constraints_rls_grants:true,...checks,dump_ms:Math.round(dumpMs),restore_ms:Math.round(restoreMs)};
}catch(error){failure={phase,error_code:typeof error.code==='string'?error.code:'verification_failed',...(error.comparison?{comparison:error.comparison}:{})};}
finally{
 phase='cleanup';try{record();}catch{cleanupFailure=true;}
 for(const resource of resources.reverse())try{await resource.end();}catch{cleanupFailure=true;}
 if(admin){for(const db of databases.slice().reverse())try{
  const r=(await admin.query('SELECT pg_get_userbyid(datdba) owner,shobj_description(oid,\'pg_database\') marker FROM pg_database WHERE datname=$1',[db.name])).rows[0];
  if(r){if(!db.confirmed||r.owner!=='postgres'||(db.marked&&r.marker!=='mercury-guard-backup-drill:'+run))throw Error('Unconfirmed database ownership');await admin.query('DROP DATABASE '+identifier(db.name));}
  assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[db.name])).rowCount,0);db.cleanup_absent=true;record();
 }catch{cleanupFailure=true;}try{await admin.end();}catch{cleanupFailure=true;}}
 if(!cleanupFailure&&temporary){rmSync(temporary,{recursive:true,force:true});temporary=null;}else if(temporary)try{record();}catch{}
}
if(failure||cleanupFailure){console.error(JSON.stringify({status:'failed',...failure,cleanup:cleanupFailure?'unconfirmed':'confirmed',...(temporary?{private_recovery_metadata:metadata}:{})}));process.exitCode=1;}
else console.log(JSON.stringify({...result,cleanup:'confirmed',databases_removed:databases.filter(db=>db.cleanup_absent).length,private_archive_removed:true,elapsed_ms:Math.round(performance.now()-started),production_backup_complete:false}));
