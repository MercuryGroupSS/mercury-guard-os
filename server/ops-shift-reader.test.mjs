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
