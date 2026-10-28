import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOpsShiftReader} from './ops-shift-reader.mjs';
const row={id:'shift-a',scheduled_start:'2026-10-23T12:00:00Z',scheduled_end:'2026-10-23T20:00:00Z',updated_at:'2026-10-23T10:00:00Z',status:'scheduled'};
const config={url:'https://ops.example.test',serverKey:'sb_secret_synthetic'};
test('reader requests only mapped IDs and schedule fields with server-only credentials',async()=>{
 let count=0;const read=createOpsShiftReader({...config,now:()=>123,fetchImpl:async(url,options)=>{
  count++;const u=new URL(url);assert.equal(u.pathname,'/rest/v1/shifts');assert.equal(u.searchParams.get('id'),'in.("shift-a","shift-b")');assert.equal(u.searchParams.get('select'),'id,scheduled_start,scheduled_end,status,updated_at');
  assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers.authorization,undefined);assert.equal(options.headers.apikey,config.serverKey);
  return Response.json([row]);
 }});
 assert.deepEqual(await read(['shift-a','shift-b']),{rows:[row],missingIds:['shift-b'],fetchedAt:123});
 assert.deepEqual((await read([])).rows,[]);assert.equal(count,1);
 await assert.rejects(()=>read(['bad,id']));await assert.rejects(()=>read(['shift-a','shift-a']));
});
test('source errors, truncation, foreign rows and excess fields fail without leaking credentials',async()=>{
 const responses=[()=>new Response('',{status:302}),()=>Response.json([row],{status:206}),()=>Response.json([{...row,id:'foreign'}]),()=>Response.json([row,row]),()=>Response.json([{...row,guard_name:'Private'}]),()=>new Response('x'.repeat(65537),{headers:{'content-type':'application/json'}}),()=>{throw Error(config.serverKey);}];
 for(const response of responses){const read=createOpsShiftReader({...config,fetchImpl:async()=>response()});await assert.rejects(()=>read(['shift-a']),e=>e.message==='Ops shift read failed; existing assignments must be preserved');}
 assert.throws(()=>createOpsShiftReader({...config,url:'http://ops.example.test'}));
 assert.throws(()=>createOpsShiftReader({...config,url:'https://user:pass@ops.example.test'}));
});
test('history is disabled by default and explicit false; a present current row never queries history',async()=>{
 for(const options of [{},{historyFallback:false},{historyFallback:true}]){
  const calls=[];const read=createOpsShiftReader({...config,...options,fetchImpl:async url=>{calls.push(new URL(url).pathname);return Response.json([row]);}});
  assert.deepEqual((await read(['shift-a'])).rows,[row]);assert.deepEqual(calls,['/rest/v1/shifts']);
 }
 for(const options of [{},{historyFallback:false}]){
  const calls=[];const read=createOpsShiftReader({...config,...options,fetchImpl:async url=>{calls.push(new URL(url).pathname);return Response.json([]);}});
  assert.deepEqual((await read(['shift-a'])).missingIds,['shift-a']);assert.deepEqual(calls,['/rest/v1/shifts']);
 }
 for(const historyFallback of [undefined,null,0,1,'true','shift_history',{},[]]){
  if(historyFallback!==undefined)assert.throws(()=>createOpsShiftReader({...config,historyFallback}));
 }
});
test('opt-in history reads only missing approved IDs with the same projection, authority and shared deadline',async()=>{
 const primary={...row,id:'shift-b'},history={...row,status:'clocked_in',updated_at:'2026-10-24T04:05:00Z'},calls=[];
 const ids=['shift-a','shift-b','shift-c'];
 const read=createOpsShiftReader({...config,historyFallback:true,now:()=>456,fetchImpl:async(url,options)=>{
  const u=new URL(url);calls.push({u,options});assert.equal(u.origin,config.url);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers['accept-profile'],'public');assert.equal(options.headers.apikey,config.serverKey);assert.equal(u.searchParams.get('select'),'id,scheduled_start,scheduled_end,status,updated_at');assert.deepEqual([...u.searchParams.keys()].sort(),['id','limit','select']);
  if(u.pathname==='/rest/v1/shifts'){assert.equal(u.searchParams.get('id'),'in.("shift-a","shift-b","shift-c")');ids.splice(0,ids.length,'unapproved');return Response.json([primary]);}
  assert.equal(u.pathname,'/rest/v1/shift_history');assert.equal(u.searchParams.get('id'),'in.("shift-a","shift-c")');assert.equal(u.searchParams.get('limit'),'3');assert.equal(options.signal,calls[0].options.signal);return Response.json([history]);
 }});
 assert.deepEqual(await read(ids),{rows:[primary,history],missingIds:['shift-c'],fetchedAt:456});assert.equal(calls.length,2);
});
test('history cannot override primary rows or release partial results on source rejection',async()=>{
 const primary={...row,id:'shift-b'};
 for(const bad of [()=>Response.json([row,primary]),()=>Response.json([{...row,id:'shift-b'}]),()=>Response.json([row,row]),()=>Response.json([{...row,guard_name:'Unrequested private value'}]),()=>Response.json([{...row,updated_at:null}]),()=>Response.json({rows:[row]}),()=>new Response('[', {headers:{'content-type':'application/json'}}),()=>new Response('x'.repeat(65537),{headers:{'content-type':'application/json'}}),()=>new Response(null,{status:302}),()=>Response.json([row],{status:206}),()=>new Response('[]',{headers:{'content-type':'text/html'}}),()=>{throw Error(config.serverKey);}]){
  let calls=0;const read=createOpsShiftReader({...config,historyFallback:true,fetchImpl:async()=>++calls===1?Response.json([primary]):bad()});
  await assert.rejects(read(['shift-a','shift-b']),error=>error.message==='Ops shift read failed; existing assignments must be preserved');assert.equal(calls,2);
 }
 const redirected=Response.json([row]);Object.defineProperty(redirected,'redirected',{value:true});
 let calls=0;const read=createOpsShiftReader({...config,historyFallback:true,fetchImpl:async()=>++calls===1?Response.json([]):redirected});await assert.rejects(read(['shift-a']),/existing assignments must be preserved/);
});
test('rejected primary reads never fall back; empty scopes and maximum scopes stay bounded',async()=>{
 let calls=0;const rejected=createOpsShiftReader({...config,historyFallback:true,fetchImpl:async()=>{calls++;return Response.json([{...row,id:'unapproved'}]);}});
 await assert.rejects(rejected(['shift-a']),/existing assignments must be preserved/);assert.equal(calls,1);
 const ids=Array.from({length:25},(_,index)=>'shift-'+index),paths=[];
 const read=createOpsShiftReader({...config,historyFallback:true,now:()=>999,fetchImpl:async(url,options)=>{const u=new URL(url);paths.push(u.pathname);assert.equal(u.searchParams.get('id'),'in.('+ids.map(id=>'"'+id+'"').join(',')+')');assert.equal(u.searchParams.get('limit'),'26');assert.ok(options.signal instanceof AbortSignal);return Response.json([]);}});
 assert.deepEqual(await read([]),{rows:[],missingIds:[],fetchedAt:999});assert.deepEqual(paths,[]);
 assert.deepEqual(await read(ids),{rows:[],missingIds:ids,fetchedAt:999});assert.deepEqual(paths,['/rest/v1/shifts','/rest/v1/shift_history']);
 await assert.rejects(read([...ids,'shift-26']),/Explicit unique shift IDs required/);assert.equal(paths.length,2);
});
