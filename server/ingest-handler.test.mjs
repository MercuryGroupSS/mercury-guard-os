import test from 'node:test';
import assert from 'node:assert/strict';
import {createIngestHandler} from './ingest-handler.mjs';
const request=(body='{}',headers={})=>new Request('http://localhost/v2/batches',{method:'POST',headers:{'content-type':'application/json',...headers},body});
test('unauthenticated callers never reach storage',async()=>{
 let called=false;
 const handler=createIngestHandler({authenticate:async()=>null,store:{ingest(){called=true;}}});
 assert.equal((await handler(request())).status,401); assert.equal(called,false);
});
test('trusted auth context is passed independently of caller JSON',async()=>{
 const trusted={guardId:'server-guard'}; let captured;
 const handler=createIngestHandler({authenticate:async header=>header==='Bearer synthetic'?trusted:null,
 store:{ingest(raw,context,now){captured={raw,context,now}; return {status:'accepted_local_only'};}},now:()=>100});
 const response=await handler(request('{"guardId":"attacker"}',{authorization:'Bearer synthetic'}));
 assert.equal(response.status,200); assert.equal(captured.context,trusted); assert.equal(captured.now,100);
 assert.equal(response.headers.get('cache-control'),'no-store');
});
test('bounded body and generic rejection response',async()=>{
 let calls=0;
 const handler=createIngestHandler({authenticate:async()=>({}),store:{ingest(){calls++;throw Error('private details');}}});
 assert.equal((await handler(request('x'.repeat(360001)))).status,413); assert.equal(calls,0);
 const rejected=await handler(request()); assert.equal(rejected.status,400);
 assert.deepEqual(await rejected.json(),{error:'batch_rejected'});
 assert.equal((await handler(request('{}',{'content-type':'text/plain'}))).status,415);
});
