import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {configuredFixture} from './fixtures/configured-service.mjs';
import {configuredDeploymentIdentity,loadConfiguredMaterials} from './configured-service-config.mjs';
import {readNetlifyEnvironment} from './netlify-config.mjs';
import {openConfiguredRuntime} from './configured-runtime.mjs';
import {openNetlifyRuntime} from './netlify-runtime.mjs';
import {createOpsShiftReader} from './ops-shift-reader.mjs';
import {createOpsRefreshWorker} from './ops-refresh-worker.mjs';
import {LocalGuardDirectory} from './local-guard-directory.mjs';
import {LocalDeviceAssignments} from './local-device-assignments.mjs';
import {OpsAssignmentSync} from './ops-assignment-sync.mjs';

const source={id:'synthetic-night-shift',scheduled_start:'2026-10-23T22:00:00Z',scheduled_end:'2026-10-24T10:00:00Z',updated_at:'2026-10-24T04:05:00Z',status:'clocked_in'};
const binding={opsShiftId:source.id,guardId:'synthetic-guard',vendorId:'synthetic-company',siteId:'synthetic-site',authSubject:randomUUID(),revision:1,active:true};
const origin='https://ops.example.invalid',serverKey='sb_secret_synthetic-ops';
const issuerKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
async function unusedPort(){
 const server=createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;
}
function database(config,materials){
 const identity=configuredDeploymentIdentity(config,materials),queries=[];
 const query=async(input,values)=>{
  const sql=typeof input==='string'?input:input.text,args=typeof input==='string'?values:input.values;queries.push({sql,args});
  if(sql.includes('has_column_privilege'))return {rows:[{role:'service_role',sessions:true,marker_read_only:true,consent_order:true}]};
  if(sql==='SELECT current_user AS role')return {rows:[{role:'service_role'}]};
  if(sql.includes('unnest'))return {rows:[{missing:false}]};
  if(sql.includes('deployment_identity'))return {rows:[identity]};
  if(sql.includes('pg_try_advisory_lock'))return {rows:[{acquired:true}]};
  if(sql.includes('pg_advisory_unlock'))return {rows:[{released:true}]};
  if(sql==='SELECT body FROM mercury_guard.ops_bindings ORDER BY source_id LIMIT 1001')return {rows:[{body:binding}]};
  if(sql.includes('FROM mercury_guard.guards WHERE auth_subject'))return {rows:[{guard_id:binding.guardId,auth_subject:binding.authSubject,vendor_id:binding.vendorId,active:true}]};
  if(sql.includes('FROM mercury_guard.vendors'))return {rows:[{vendor_id:binding.vendorId,kind:'company',active:true}]};
  return {rows:[],rowCount:/^(INSERT|UPDATE|DELETE)/.test(sql)?1:0};
 };
 const pool={on(){},query,connect:async()=>({query,release(){}}),end:async()=>{}};
 return {poolFactory:()=>pool,queries};
}
function provider(config,{historyError=false}={}){
 const requests=[];
 return {requests,fetchImpl:async(input,options)=>{
  const url=new URL(input);
  if(url.origin===config.auth.origin){assert.equal(url.pathname,'/auth/v1/settings');return Response.json({mailer_autoconfirm:false,external:{email:true},disable_signup:false});}
  assert.equal(url.origin,origin);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers.apikey,serverKey);assert.equal(options.headers['accept-profile'],'public');assert.equal(url.searchParams.get('id'),'in.("'+source.id+'")');assert.equal(url.searchParams.get('select'),'id,scheduled_start,scheduled_end,status,updated_at');requests.push(url.pathname);
  if(url.pathname==='/rest/v1/shifts')return Response.json([]);
  assert.equal(url.pathname,'/rest/v1/shift_history');return historyError?new Response(null,{status:503}):Response.json([source]);
 }};
}
async function waitForOps(runtime){
 for(let attempt=0;attempt<100;attempt++){const status=runtime.status().ops;if(status&&status.at!==null&&!status.inflight)return status;await nextTurn();}
 assert.fail('Synthetic configured Ops pass did not finish');
}
for(const mode of ['configured','netlify'])for(const flag of [undefined,false,true])test(mode+' runtime honors '+String(flag)+' history flag through actual Ops worker composition',async()=>{
 let fixture,runtime,config,materials;
 const extra=flag===undefined?{}:{history_fallback:flag};
 if(mode==='configured'){
  fixture=configuredFixture({port:await unusedPort()});config={...fixture.config,ops_refresh:{origin,server_key:serverKey,interval_ms:1000,...extra}};materials=loadConfiguredMaterials(config);
 }else{
  const value={version:1,deployment_id:randomUUID(),public_origin:'https://guard.example.invalid',platform:{site_id:randomUUID(),deployment_context:'production'},auth:{origin:'https://auth.example.invalid',publishable_key:'sb_publishable_synthetic'},database:{connection_mode:'session'},issuer:{issuer:'synthetic-history',audience:'synthetic-history',key_id:'synthetic-history'},workers:{batch_size:5,max_duration_ms:20000},ops_refresh:{origin,...extra},dashboard_delivery:false,dashboard_receiver:false};
  const env={MERCURY_GUARD_NETLIFY_CONFIG:JSON.stringify(value),MERCURY_GUARD_DATABASE_URL:'postgresql://synthetic:synthetic@db.example.invalid:5432/guard',MERCURY_GUARD_AUTH_SERVER_KEY:'sb_secret_synthetic-auth',MERCURY_GUARD_OPS_SERVER_KEY:serverKey,MERCURY_GUARD_ISSUER_PRIVATE_KEY:issuerKey};
  ({config,materials}=readNetlifyEnvironment({get:name=>env[name]}));
 }
 const db=database(config,materials),http=provider(config);
 try{
  if(mode==='configured'){
   runtime=await openConfiguredRuntime(config,materials,{poolFactory:db.poolFactory,fetchImpl:http.fetchImpl,schedule:()=>({unref(){}}),cancel(){}});await runtime.start();await waitForOps(runtime);
  }else{runtime=await openNetlifyRuntime(config,materials,{poolFactory:db.poolFactory,fetchImpl:http.fetchImpl});const result=await runtime.runWorkersOnce();assert.equal(result.completed,true);assert.equal(result.ops.processed,flag===true?1:0);assert.equal(result.ops.missing,flag===true?0:1);}
  assert.deepEqual(http.requests,flag===true?['/rest/v1/shifts','/rest/v1/shift_history']:['/rest/v1/shifts']);
  const imported=db.queries.filter(q=>q.sql.startsWith('INSERT INTO mercury_guard.assignments('));assert.equal(imported.length,flag===true?1:0);
  if(imported.length){assert.equal(imported[0].args[1],binding.guardId);assert.equal(imported[0].args[2],binding.vendorId);assert.equal(imported[0].args[3],binding.siteId);assert.equal(imported[0].args[4],Date.parse(source.scheduled_start));assert.equal(imported[0].args[5],Date.parse(source.scheduled_end));}
 }finally{await runtime?.close();fixture?.close();}
});
test('Netlify history failure marks the worker incomplete without applying or cancelling an assignment',async()=>{
 const value={version:1,deployment_id:randomUUID(),public_origin:'https://guard.example.invalid',platform:{site_id:randomUUID(),deployment_context:'production'},auth:{origin:'https://auth.example.invalid',publishable_key:'sb_publishable_synthetic'},database:{connection_mode:'session'},issuer:{issuer:'synthetic-history',audience:'synthetic-history',key_id:'synthetic-history'},workers:{batch_size:5,max_duration_ms:20000},ops_refresh:{origin,history_fallback:true},dashboard_delivery:false,dashboard_receiver:false};
 const env={MERCURY_GUARD_NETLIFY_CONFIG:JSON.stringify(value),MERCURY_GUARD_DATABASE_URL:'postgresql://synthetic:synthetic@db.example.invalid:5432/guard',MERCURY_GUARD_AUTH_SERVER_KEY:'sb_secret_synthetic-auth',MERCURY_GUARD_OPS_SERVER_KEY:serverKey,MERCURY_GUARD_ISSUER_PRIVATE_KEY:issuerKey};
 let runtime;
 try{
  const loaded=readNetlifyEnvironment({get:name=>env[name]}),db=database(loaded.config,loaded.materials),http=provider(loaded.config,{historyError:true});runtime=await openNetlifyRuntime(loaded.config,loaded.materials,{poolFactory:db.poolFactory,fetchImpl:http.fetchImpl});
  const result=await runtime.runWorkersOnce();assert.equal(result.completed,false);assert.equal(result.ops.failed,1);assert.equal(result.ops.processed,0);assert.equal(db.queries.some(q=>q.sql.startsWith('INSERT INTO mercury_guard.assignments(')||q.sql.startsWith('UPDATE mercury_guard.assignments SET active=false')),false);
 }finally{await runtime?.close();}
});
test('an older history update cannot regress an imported assignment, and missing from both tables never cancels it',async()=>{
 const directory=new LocalGuardDirectory(':memory:'),devices=new LocalDeviceAssignments(':memory:'),sync=new OpsAssignmentSync(devices);
 directory.addVendor({vendorId:binding.vendorId,kind:'company',active:true});directory.addGuard({guardId:binding.guardId,vendorId:binding.vendorId,authSubject:binding.authSubject,active:true});
 const original=sync.apply(source,binding),before=devices.db.prepare('SELECT body FROM assignments').get().body;
 let absent=false;const requests=[];
 const reader=createOpsShiftReader({url:origin,serverKey,historyFallback:true,fetchImpl:async url=>{const path=new URL(url).pathname;requests.push(path);return Response.json(path==='/rest/v1/shifts'||absent?[]:[{...source,updated_at:'2026-10-24T03:00:00Z',status:'cancelled'}]);}});
 const worker=createOpsRefreshWorker({loadBindings:async()=>[binding],directory,sync,readShifts:reader});
 try{
  const stale=await worker.run();assert.equal(stale.failed,1);assert.equal(stale.processed,0);assert.equal(devices.db.prepare('SELECT body FROM assignments').get().body,before);
  absent=true;const missing=await worker.run();assert.equal(missing.missing,1);assert.equal(missing.failed,0);assert.equal(devices.db.prepare('SELECT body FROM assignments').get().body,before);assert.equal(JSON.parse(before).assignmentId,original.assignmentId);
  assert.deepEqual(requests,['/rest/v1/shifts','/rest/v1/shift_history','/rest/v1/shifts','/rest/v1/shift_history']);
 }finally{await worker.stop();devices.close();directory.close();}
});
