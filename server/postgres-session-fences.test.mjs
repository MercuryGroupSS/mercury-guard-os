import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {requirePostgresAuthSession} from './postgres-auth-session.mjs';
import {PostgresShiftGrantIssuer} from './postgres-shift-grant-issuer.mjs';
import {PostgresShiftLifecycle} from './postgres-shift-lifecycle.mjs';
import {createAssignmentHandler} from './assignment-handler.mjs';
const now=Date.now(),subject=randomUUID(),identity={subject,guardId:'session-test-guard',vendorId:'session-test-vendor'},session={subject,sessionId:randomUUID(),active:true,expiresAt:Math.floor(now/1000)+3600};
const device={deviceId:'session-test-phone',mode:'personal',guardId:identity.guardId,active:true,revoked:false,thumbprint:'a'.repeat(64),revocationVersion:1},assignment={assignmentId:'session-test-shift',guardId:identity.guardId,vendorId:identity.vendorId,siteId:'session-test-site',deviceId:device.deviceId,startsAt:now-1000,endsAt:now+3600000,active:true,canStart:true};
test('transactional current session rejects missing, mismatched, expired and unsafe verified principals without trusting another session',async()=>{
 let reads=0;const client={query:async(sql,args)=>{reads++;assert.deepEqual(args,[session.sessionId,subject]);return {rows:[{active:true}]};}};
 for(const s of [undefined,{...session,subject:randomUUID()},{...session,sessionId:'not-a-uuid'},{...session,active:false},{...session,expiresAt:Math.floor(now/1000)},{...session,expiresAt:Number.MAX_SAFE_INTEGER}])await assert.rejects(requirePostgresAuthSession(client,s,subject,now));
 for(const at of ['1',0,-1,NaN,Infinity])await assert.rejects(requirePostgresAuthSession(client,session,subject,at));
 assert.equal(reads,0);await requirePostgresAuthSession(client,session,subject,now);assert.equal(reads,1);
 await assert.rejects(requirePostgresAuthSession({query:async()=>({rows:[{active:false}]})},session,subject,now));
});
function fixture(revokeAfterInsert=false){
 let active=true,inserted=0,committed=0,rolledBack=0,reads=0;
 const client={query:async sql=>{
  if(sql.includes('auth.sessions')){reads++;return {rows:[{active}]};}
  if(sql.startsWith('SELECT 1 FROM mercury_guard.assignments'))return {rows:[{}],rowCount:1};
  if(sql.startsWith('INSERT INTO mercury_guard.capture_grants')){inserted++;if(revokeAfterInsert)active=false;}
  return {rows:[],rowCount:0};
 }};
 return {devices:{pool:client,transaction:async fn=>{try{const out=await fn(client);committed=inserted;return out;}catch(error){rolledBack++;inserted=0;throw error;}}},revoke:()=>{active=false;},state:()=>({inserted,committed,rolledBack,reads})};
}
const rsa=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey;
function issuer(f){return new PostgresShiftGrantIssuer({devices:f.devices,privateKey:rsa,keyId:'session-test',issuer:'session-test',audience:'session-test'});}
const context={identity,assignment,device,session,sessionExpiresAt:session.expiresAt*1000,allowedActions:['incident','photo','check_in'],now};
test('ordinary grants require an active exact session even with no location policy or consent component',async()=>{
 const denied=fixture();denied.revoke();await assert.rejects(issuer(denied).issue(context),/Current exact/);assert.deepEqual(denied.state(),{inserted:0,committed:0,rolledBack:1,reads:1});
 const good=fixture(),signed=await issuer(good).issue(context);assert.ok(signed.signature);assert.equal(JSON.parse(Buffer.from(signed.payload,'base64url')).actions.includes('location'),false);assert.equal(good.state().reads,2);assert.equal(good.state().committed,1);
});
test('session revocation after an ordinary grant INSERT rolls the transaction back instead of returning signed authority',async()=>{
 const f=fixture(true);await assert.rejects(issuer(f).issue(context),/Current exact/);assert.deepEqual(f.state(),{inserted:0,committed:0,rolledBack:1,reads:2});
});
test('historical attendance receipt and rejection retries retain original bytes but require the current session at both transaction boundaries',async()=>{
 const receipt={status:'shift_recorded_local_only',reason:'Original reason'},request={action:'end',confirmed:true,request_id:randomUUID(),reason:'Original reason'};
 // Obtain the production digest once; the stored receipt is never rewritten.
 const {prepareShiftTransition}=await import('./shift-transition-input.mjs'),input={identity,assignment,deviceThumbprint:device.thumbprint,session,request,now},digest=prepareShiftTransition(input).digest;
 for(const kind of ['receipt','rejection']){
  let active=true,checks=0;const client={query:async sql=>{
   if(sql.includes('auth.sessions')){checks++;return {rows:[{active}]};}
   if(sql.includes(kind==='receipt'?'FROM mercury_guard.shift_transitions':'FROM mercury_guard.shift_rejections')){active=false;return {rows:[{digest,receipt}]};}
   return {rows:[]};
  }};
  const lifecycle=new PostgresShiftLifecycle({pool:client,transaction:fn=>fn(client)});
  await assert.rejects(lifecycle.transition(input),/Current exact/);assert.equal(checks,2);
 }
});
test('assignment HTTP routes propagate the captured verified session internally without adding a field to the wire request',async()=>{
 const calls=[],devices={challenge:async(i,id,at,s)=>{assert.equal(s,session);calls.push('challenge');return {};},list:async(i,p,at,options)=>{assert.equal(options.session,session);calls.push('list');return {assignments:[{...assignment,deviceThumbprint:device.thumbprint,revocationVersion:1}]};},device:async()=>device};
 const directory={loadGuardsForSubject:async()=>[{...identity,authSubject:subject,active:true}],loadVendor:async()=>({vendorId:identity.vendorId,kind:'company',active:true})};
 const shiftLifecycle={snapshot:async()=>({state:'active'}),permitsCapture:async()=>true,transition:async input=>{assert.equal(input.session,session);calls.push('transition');return {};}};
 const handler=createAssignmentHandler({verifySession:async()=>session,directory,devices,shiftLifecycle,grantIssuer:{issue:async input=>{assert.equal(input.session,session);calls.push('grant');return {};}},now:()=>now});
 const send=(path,body)=>handler(new Request('https://session.invalid'+path,{method:'POST',headers:{authorization:'Bearer synthetic','content-type':'application/json'},body:JSON.stringify(body)}));
 for(const [path,body] of [['device-challenge',{device_id:device.deviceId}],['assignments',{}],['shift-grant',{assignment_id:assignment.assignmentId,proof:{}}],['shift-transition',{assignment_id:assignment.assignmentId,proof:{},transition:{}}]])assert.equal((await send('/v1/'+path,body)).status,200);
 assert.deepEqual(calls,['challenge','list','list','grant','list','transition']);
});
