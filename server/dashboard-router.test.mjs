import {test} from 'node:test';import assert from 'node:assert/strict';import {createHash,randomUUID} from 'node:crypto';
import {projectDashboardObservation} from './dashboard-delivery.mjs';import {createDashboardRouter} from './dashboard-router.mjs';
const token='synthetic-destination-specific-token-'.repeat(2);
function job(destination){const mapping={assignmentId:'assignment',guardId:'guard',vendorId:'vendor',siteId:'site',dashboardShiftId:'upstream',destination,active:true,revision:1};const body=JSON.stringify(projectDashboardObservation({vendor_id:'vendor',scope:{assignment_id:'assignment',guard_id:'guard',site_id:'site',device_thumbprint:'a'.repeat(64)},event:{event_id:randomUUID(),at:1000,kind:'incident',data:{description:'Synthetic incident'}}},mapping));return {id:JSON.parse(body).delivery_id,body,hash:createHash('sha256').update(body).digest('hex')};}
test('destination router selects only the explicitly bound endpoint and credential',async()=>{
 const calls=[],send=createDashboardRouter({destinations:[{destination:'one',endpoint:'https://one.example.test/v1/mercury-one/observations',token},{destination:'two',endpoint:'https://two.example.test/v1/mercury-one/observations',token:token+'two'}],fetchImpl:async(url,options)=>{calls.push({url:String(url),token:options.headers.authorization});const value=JSON.parse(options.body);return new Response(JSON.stringify({delivery_id:value.delivery_id,destination:value.destination,payload_sha256:createHash('sha256').update(options.body).digest('hex'),status:'stored_in_integration_inbox'}));}});
 assert.equal((await send(job('two'))).destination,'two');assert.deepEqual(calls,[{url:'https://two.example.test/v1/mercury-one/observations',token:'Bearer '+token+'two'}]);
 await assert.rejects(send(job('unconfigured')));assert.equal(calls.length,1);
 const changed=job('one');await assert.rejects(send({...changed,hash:'0'.repeat(64)}));await assert.rejects(send({...changed,id:'b'.repeat(64)}));assert.equal(calls.length,1);
});
test('destination router rejects insecure, duplicate, unbounded or unexpected configuration',()=>{
 const route={destination:'one',endpoint:'https://one.example.test/path',token};
 for(const destinations of [[],Array(26).fill(route),[route,route],[{...route,unexpected:true}],[{...route,destination:'space here'}],[{...route,endpoint:'http://127.0.0.1/path'}],[{...route,endpoint:'https://user:password@one.example.test/path'}]])assert.throws(()=>createDashboardRouter({destinations}));
 assert.doesNotThrow(()=>createDashboardRouter({destinations:[{...route,endpoint:'http://127.0.0.1/path'}],allowLocal:true}));
});
