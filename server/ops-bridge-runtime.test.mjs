import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,generateKeyPairSync} from 'node:crypto';
import {createServer} from 'node:net';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {createOpsScheduleBridge} from './ops-schedule-bridge.mjs';
import {openNetlifyRuntime} from './netlify-runtime.mjs';
import {readNetlifyEnvironment} from './netlify-config.mjs';
import {openConfiguredRuntime} from './configured-runtime.mjs';
import {configuredFixture} from './fixtures/configured-service.mjs';
import {configuredDeploymentIdentity,loadConfiguredMaterials} from './configured-service-config.mjs';

const origin='https://ops.example.invalid',token=randomBytes(32).toString('base64url');
const shift={id:'synthetic-bridge-shift',scheduled_start:'2026-10-29T22:00:00Z',scheduled_end:'2026-10-30T10:00:00Z',status:'scheduled',updated_at:'2026-10-29T16:55:00Z'};
const binding={opsShiftId:shift.id,guardId:'synthetic-bridge-guard',vendorId:'synthetic-bridge-vendor',siteId:'synthetic-bridge-site',authSubject:randomUUID(),revision:1,active:true};
async function unusedPort(){const s=createServer();await new Promise((r,j)=>{s.once('error',j);s.listen(0,'127.0.0.1',r);});const p=s.address().port;await new Promise(r=>s.close(r));return p;}
function database(config,materials){
 const marker=configuredDeploymentIdentity(config,materials),queries=[];
 const query=async(input,values)=>{const text=typeof input==='string'?input:input.text,args=typeof input==='string'?values:input.values;queries.push({text,args});
  if(text.includes('has_column_privilege'))return {rows:[{role:'service_role',sessions:true,marker_read_only:true,consent_order:true}]};
  if(text==='SELECT current_user AS role')return {rows:[{role:'service_role'}]};
  if(text.includes('unnest'))return {rows:[{missing:false}]};if(text.includes('deployment_identity'))return {rows:[marker]};
  if(text.includes('pg_try_advisory_lock'))return {rows:[{acquired:true}]};if(text.includes('pg_advisory_unlock'))return {rows:[{released:true}]};
  if(text==='SELECT body FROM mercury_guard.ops_bindings ORDER BY source_id LIMIT 1001')return {rows:[{body:binding}]};
  if(text.includes('FROM mercury_guard.guards WHERE auth_subject'))return {rows:[{guard_id:binding.guardId,auth_subject:binding.authSubject,vendor_id:binding.vendorId,active:true}]};
  if(text.includes('FROM mercury_guard.vendors'))return {rows:[{vendor_id:binding.vendorId,kind:'individual',active:true}]};
  return {rows:[],rowCount:/^(INSERT|UPDATE)/.test(text)?1:0};
 };
 return {queries,poolFactory:()=>({on(){},query,connect:async()=>({query,release(){}}),end:async()=>{}})};
}
for(const mode of ['configured','netlify'])for(const failed of [false,true])test(mode+' runtime composes the real bridge consumer and refresh worker; upstream failure='+failed,async()=>{
 let local,runtime,config,materials,calls=0;
 const bridge=createOpsScheduleBridge({publicOrigin:origin,token,allowedIds:[shift.id],allowHistory:true,readShifts:async(ids,options)=>{calls++;assert.deepEqual(ids,[shift.id]);assert.equal(options.historyFallback,true);if(failed)throw Error('private source error');return {rows:[shift],missingIds:[],fetchedAt:Date.now()};}});
 if(mode==='configured'){local=configuredFixture({port:await unusedPort()});config={...local.config,ops_refresh:{origin,transport:'schedule_bridge',schedule_token:token,interval_ms:60000,history_fallback:true}};materials=loadConfiguredMaterials(config);}
 else{
  const key=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}),value={version:1,deployment_id:randomUUID(),public_origin:'https://guard.example.invalid',platform:{site_id:randomUUID(),deployment_context:'production'},auth:{origin:'https://auth.example.invalid',publishable_key:'sb_publishable_synthetic'},database:{connection_mode:'session'},issuer:{issuer:'synthetic',audience:'synthetic',key_id:'synthetic'},workers:{batch_size:5,max_duration_ms:20000},ops_refresh:{origin,transport:'schedule_bridge',history_fallback:true},dashboard_delivery:false,dashboard_receiver:false};
  const env={MERCURY_GUARD_NETLIFY_CONFIG:JSON.stringify(value),MERCURY_GUARD_AUTH_SERVER_KEY:'sb_secret_synthetic',MERCURY_GUARD_DATABASE_URL:'postgresql://synthetic:synthetic@db.example.invalid:5432/guard',MERCURY_GUARD_ISSUER_PRIVATE_KEY:key,MERCURY_GUARD_OPS_SCHEDULE_TOKEN:token};({config,materials}=readNetlifyEnvironment({get:n=>env[n]}));
 }
 const db=database(config,materials),fetchImpl=async(url,options)=>new URL(url).origin===config.auth.origin?Response.json({mailer_autoconfirm:false,external:{email:true},disable_signup:false}):bridge(new Request(url,options));
 try{
  let result;
  if(mode==='configured'){
   runtime=await openConfiguredRuntime(config,materials,{poolFactory:db.poolFactory,fetchImpl,schedule:()=>({unref(){}}),cancel(){}});await runtime.start();
   for(let i=0;i<100;i++){const s=runtime.status().ops;if(s?.at!==null&&!s.inflight){result=s;break;}await nextTurn();}assert.ok(result);
  }else{runtime=await openNetlifyRuntime(config,materials,{poolFactory:db.poolFactory,fetchImpl});result=(await runtime.runWorkersOnce()).ops;}
  assert.equal(calls,1);assert.equal(result.failed,failed?1:0);assert.equal(result.processed,failed?0:1);
  const imports=db.queries.filter(q=>q.text.startsWith('INSERT INTO mercury_guard.assignments('));assert.equal(imports.length,failed?0:1);
  if(!failed){assert.equal(imports[0].args[1],binding.guardId);assert.equal(imports[0].args[4],Date.parse(shift.scheduled_start));}
  assert.equal(db.queries.some(q=>q.text.startsWith('UPDATE mercury_guard.assignments SET active=false')),false);
 }finally{await runtime?.close();local?.close();}
});
