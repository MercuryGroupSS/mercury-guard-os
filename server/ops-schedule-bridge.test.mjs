import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,generateKeyPairSync} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {OPS_SCHEDULE_PATH,createOpsScheduleBridge,createOpsScheduleBridgeReader,scheduleBridgeToken} from './ops-schedule-bridge.mjs';
import {createOpsSourceReader} from './ops-source-reader.mjs';
import {validateOpsSourceConfig} from './ops-source-config.mjs';
import {readNetlifyEnvironment,validateNetlifyConfiguration} from './netlify-config.mjs';
import {configuredFixture} from './fixtures/configured-service.mjs';
import {validateConfiguredServiceConfig} from './configured-service-config.mjs';
import {createOpsScheduleEntrypoint} from '../integration-drafts/ops-schedule-bridge/entry.mjs';

const token=randomBytes(32).toString('base64url'),origin='https://ops.example.invalid',at=Date.parse('2026-10-29T17:00:00Z');
const shift={id:'synthetic-ridge-shift',scheduled_start:'2026-10-29T22:00:00Z',scheduled_end:'2026-10-30T10:00:00Z',status:'scheduled',updated_at:'2026-10-29T16:55:00Z'};
function endpoint(ids=[shift.id],history='false'){const u=new URL(OPS_SCHEDULE_PATH,origin);u.searchParams.set('ids',JSON.stringify(ids));u.searchParams.set('history',history);return u;}
function fixture(options={}){let calls=0;const bridge=createOpsScheduleBridge({publicOrigin:origin,token,allowedIds:[shift.id,'missing'],allowHistory:true,now:()=>at,readShifts:async requested=>{calls++;return {rows:requested.includes(shift.id)?[shift]:[],missingIds:requested.filter(id=>id!==shift.id),fetchedAt:at};},...options});return {bridge,calls:()=>calls};}
const request=(url=endpoint(),headers={authorization:'Bearer '+token},method='GET')=>new Request(url,{headers,method});
test('bridge and consumer complete the exact five-field protocol without names, clock events or service keys',async()=>{
 let options;const f=fixture(),reader=createOpsScheduleBridgeReader({url:origin,token,historyFallback:true,now:()=>at,fetchImpl:async(url,init)=>{options=init;return f.bridge(new Request(url,init));}});
 assert.deepEqual(await reader([shift.id,'missing']),{rows:[shift],missingIds:['missing'],fetchedAt:at});
 assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers.authorization,'Bearer '+token);assert.ok(options.signal);assert.equal(f.calls(),1);
 assert.equal(options.headers.apikey,undefined);
 const response=await f.bridge(request());assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('access-control-allow-origin'),null);
});
test('source bridge rejects missing/wrong credentials, methods, origins, unknown IDs and query fields before upstream work',async()=>{
 const f=fixture();
 for(const [req,status]of [[request(endpoint(),{}),401],[request(endpoint(),{authorization:'Bearer '+randomBytes(32).toString('base64url')}),401],[request(endpoint(),{authorization:'Bearer '+token},'POST'),405],[request(endpoint(),{authorization:'Bearer '+token,origin}),400],[request(endpoint(['another-shift'])),403],[request(new URL('/wrong',origin)),404]])assert.equal((await f.bridge(req)).status,status);
 for(const alter of [u=>u.searchParams.append('ids','[]'),u=>u.searchParams.append('history','false'),u=>u.searchParams.set('table','guards'),u=>u.searchParams.set('select','*'),u=>u.searchParams.set('ids','[]'),u=>u.searchParams.set('ids',JSON.stringify([shift.id,shift.id])),u=>u.searchParams.set('history','yes')]){const u=endpoint();alter(u);assert.equal((await f.bridge(request(u))).status,400);}
 assert.equal(f.calls(),0);
});
test('history requires explicit approvals on both sides and cannot be selected through a caller table/path',async()=>{
 let history;const f=fixture({readShifts:async(ids,options)=>{history=options.historyFallback;return {rows:[shift],missingIds:[],fetchedAt:at};}});
 assert.equal((await f.bridge(request(endpoint([shift.id],'true')))).status,200);assert.equal(history,true);
 assert.equal((await fixture({allowHistory:false}).bridge(request(endpoint([shift.id],'true')))).status,400);
 assert.throws(()=>createOpsScheduleBridge({publicOrigin:origin,token,allowedIds:[shift.id],allowHistory:'true',readShifts(){}}));
});
test('source errors and malformed upstream rows are redacted and never become successful empty schedules',async()=>{
 for(const readShifts of [async()=>{throw Error('private-upstream-key');},async()=>({rows:[{...shift,guard_name:'private'}],missingIds:[],fetchedAt:at}),async()=>({rows:[shift,shift],missingIds:[],fetchedAt:at}),async()=>({rows:[{...shift,status:'unknown'}],missingIds:[],fetchedAt:at}),async()=>({rows:[shift],missingIds:[shift.id],fetchedAt:at}),async()=>({rows:[shift],missingIds:[],fetchedAt:at-60001})]){
  const response=await fixture({readShifts}).bridge(request());assert.equal(response.status,502);assert.deepEqual(await response.json(),{error:'schedule_source_unavailable'});
 }
});
test('consumer refuses redirects, error responses, stale data, duplicate keys and dishonest missing IDs',async()=>{
 const valid={version:1,rows:[shift],missing_ids:[],fetched_at:at};
 const providers=[()=>new Response('upstream-private',{status:403}),()=>new Response('{}',{headers:{'content-type':'text/plain'}}),()=>Response.json({...valid,fetched_at:at+60001}),()=>Response.json({...valid,fetched_at:at-60001}),()=>Response.json({...valid,missing_ids:[shift.id]}),()=>Response.json({...valid,rows:[{...shift,clock_in:'private'}]}),()=>new Response('{"version":1,"version":1,"rows":[],"missing_ids":[],"fetched_at":1}',{headers:{'content-type':'application/json'}}),()=>new Response('x'.repeat(65537),{headers:{'content-type':'application/json'}}),()=>{const r=Response.json(valid);Object.defineProperty(r,'redirected',{value:true});return r;}];
 for(const provider of providers){const reader=createOpsScheduleBridgeReader({url:origin,token,now:()=>at,fetchImpl:async()=>provider()});await assert.rejects(reader([shift.id]),e=>e.message==='Ops schedule bridge read failed; existing assignments must be preserved');}
});
test('consumer bounds requested IDs and never calls a source for an empty list',async()=>{
 let calls=0;const reader=createOpsScheduleBridgeReader({url:origin,token,now:()=>at,fetchImpl:async()=>{calls++;throw Error();}});
 assert.deepEqual(await reader([]),{rows:[],missingIds:[],fetchedAt:at});
 for(const ids of [null,[shift.id,shift.id],['bad id'],Array.from({length:26},(_,i)=>String(i))])await assert.rejects(reader(ids),/unique shift IDs/);
 assert.equal(calls,0);
 for(const url of ['http://ops.example.invalid','https://ops.example.invalid/other','https://user:password@ops.example.invalid','https://ops.example.invalid?secret=x'])assert.throws(()=>createOpsScheduleBridgeReader({url,token}));
 for(const bad of ['sb_secret_other-service',token+'x','x'.repeat(43),undefined]){if(bad===token)continue;assert.throws(()=>scheduleBridgeToken(bad));}
});
function netlifyFixture(){const issuerKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}),value={version:1,deployment_id:randomUUID(),public_origin:'https://guard.example.invalid',platform:{site_id:randomUUID(),deployment_context:'production'},auth:{origin:'https://auth.example.invalid',publishable_key:'sb_publishable_synthetic'},database:{connection_mode:'session'},issuer:{issuer:'synthetic',audience:'synthetic',key_id:'synthetic'},workers:{batch_size:5,max_duration_ms:20000},ops_refresh:{origin,transport:'schedule_bridge',history_fallback:true},dashboard_delivery:false,dashboard_receiver:false};const env={MERCURY_GUARD_NETLIFY_CONFIG:JSON.stringify(value),MERCURY_GUARD_DATABASE_URL:'postgresql://synthetic:synthetic@db.example.invalid:5432/guard',MERCURY_GUARD_AUTH_SERVER_KEY:'sb_secret_synthetic',MERCURY_GUARD_OPS_SCHEDULE_TOKEN:token,MERCURY_GUARD_ISSUER_PRIVATE_KEY:issuerKey};return {value,env,load:()=>readNetlifyEnvironment({get:n=>env[n]}),save(){env.MERCURY_GUARD_NETLIFY_CONFIG=JSON.stringify(value);}};}
test('Netlify and direct loaders accept only the explicit bridge credential variant without a copied Ops service key',()=>{
 const f=netlifyFixture(),loaded=f.load();assert.equal(loaded.config.ops_refresh.schedule_token,token);assert.equal(loaded.config.ops_refresh.server_key,undefined);assert.deepEqual(validateNetlifyConfiguration(loaded.config,loaded.materials).ops_refresh,loaded.config.ops_refresh);
 const direct=configuredFixture();try{const c={...direct.config,ops_refresh:{...f.value.ops_refresh,schedule_token:token,interval_ms:60000}};assert.deepEqual(validateConfiguredServiceConfig(c).ops_refresh,c.ops_refresh);}finally{direct.close();}
 for(const mutate of [()=>{delete f.env.MERCURY_GUARD_OPS_SCHEDULE_TOKEN;},()=>{f.value.ops_refresh.server_key='sb_secret_source';f.save();},()=>{f.value.ops_refresh.transport='unknown';f.save();},()=>{f.value.ops_refresh.history_fallback='true';f.save();}]){const old=structuredClone(f.value),env={...f.env};mutate();assert.throws(f.load,/configuration invalid/);for(const k of Object.keys(f.value))delete f.value[k];Object.assign(f.value,old);for(const k of Object.keys(f.env))delete f.env[k];Object.assign(f.env,env);}
 for(const value of [{origin,transport:'other'},{origin,transport:'schedule_bridge',schedule_token:token,server_key:'sb_secret_other'},{origin,transport:'schedule_bridge',schedule_token:'sb_secret_other'}])assert.throws(()=>validateOpsSourceConfig(value,{credentials:true}));
 assert.throws(()=>createOpsSourceReader({origin,transport:'unknown'}));
});
test('draft Ops entrypoint requires exact production site context and existing source origin; response never contains source key',async()=>{
 const site=randomUUID(),env={MERCURY_GUARD_SCHEDULE_CONFIG:JSON.stringify({version:1,site_id:site,public_origin:origin,allowed_ids:[shift.id],allow_history:true}),MERCURY_GUARD_SCHEDULE_TOKEN:token,SUPABASE_URL:'https://dyctehllmjryjwvrmxdw.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_existing-ops-synthetic'},calls=[];
 const handler=createOpsScheduleEntrypoint({get:n=>env[n],fetchImpl:async(url,init)=>{calls.push({url,init});return Response.json([shift]);}}),context={site:{id:site},deploy:{context:'production'}};
 for(const ctx of [undefined,{site:{id:site},deploy:{context:'deploy-preview'}},{site:{id:randomUUID()},deploy:{context:'production'}}])assert.equal((await handler(request(),ctx)).status,503);
 assert.equal(calls.length,0);
 // The response freshness uses the real reader clock, not the synthetic unit-test clock.
 const response=await handler(request(),context);assert.equal(response.status,200);const text=await response.text();assert.ok(!text.includes(env.SUPABASE_SERVICE_ROLE_KEY));assert.ok(!text.includes('guard_name'));assert.equal(calls[0].init.method,'GET');assert.equal(calls[0].init.redirect,'error');assert.equal(new URL(calls[0].url).searchParams.get('select'),'id,scheduled_start,scheduled_end,status,updated_at');
 env.SUPABASE_URL='https://another-project.supabase.co';assert.equal((await handler(request(),context)).status,503);assert.equal(calls.length,1);
});
test('an actual loopback HTTP bridge transport composes both sides; injected local routing is test-only',async()=>{
 const f=fixture(),server=createServer(async(req,res)=>{const response=await f.bridge(new Request(new URL(req.url,origin),{method:req.method,headers:req.headers}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const reader=createOpsScheduleBridgeReader({url:origin,token,now:()=>at,fetchImpl:(url,init)=>{const target=new URL(url);target.protocol='http:';target.host='127.0.0.1:'+server.address().port;return fetch(target,init);}});assert.deepEqual(await reader([shift.id]),{rows:[shift],missingIds:[],fetchedAt:at});assert.equal(f.calls(),1);}finally{await new Promise(resolve=>server.close(resolve));}
});
