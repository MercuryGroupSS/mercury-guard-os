import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalService} from './local-service.mjs';

const config={API_URL:'http://127.0.0.1:55321',PUBLISHABLE_KEY:'synthetic-unused',SERVICE_ROLE_KEY:'synthetic-unused'};
const paths=['/v1/location-consents','/v1/location-consents/challenge','/v1/location-consents/status'];

test('composed location routes deny missing and malformed authentication before any consent-store operation',async()=>{
 let calls=0;
 const denied=async()=>{calls++;throw Error('Unauthenticated consent operation reached storage');};
 const service=createLocalService({config,store:{ingest:denied},locationConsents:{challenge:denied,receive:denied,status:denied}});
 const origin=await service.start();
 try{
  for(const path of paths){
   for(const authorization of [null,'Bearer malformed']){
    const response=await fetch(origin+path,{method:'POST',headers:{'content-type':'application/json',...(authorization?{authorization}:{})},body:'{}',redirect:'error',signal:AbortSignal.timeout(5000)});
    assert.equal(response.status,401,path);
    assert.deepEqual(await response.json(),{error:'authentication_required'});
    assert.equal(response.headers.get('cache-control'),'no-store');
   }
  }
  assert.equal(calls,0);
 }finally{await service.stop();}
});

test('without an explicit transactional consent dependency the local service exposes no location consent endpoint',async()=>{
 let writes=0;
 const service=createLocalService({config,store:{ingest:async()=>{writes++;throw Error('Unexpected ingest');}}});
 const origin=await service.start();
 try{
  for(const path of paths){
   const response=await fetch(origin+path,{method:'POST',headers:{'content-type':'application/json'},body:'{}',redirect:'error',signal:AbortSignal.timeout(5000)});
   assert.equal(response.status,404,path);
  }
  assert.equal(writes,0);
 }finally{await service.stop();}
});
