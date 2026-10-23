import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAdminHandler} from './admin-handler.mjs';
import {AdminDeniedError,AdminConflictError} from './postgres-administration.mjs';
const request=(path,body,token='valid')=>new Request('https://guard.test/v1/admin/'+path,{method:body===undefined?'GET':'POST',headers:{...(token?{authorization:'Bearer '+token}:{}),'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
test('administration requires remotely verified active membership rather than claimed roles',async()=>{
 let applied=0,member=false;const session={subject:'subject',active:true,expiresAt:1000,user_metadata:{admin:true}};
 const handler=createAdminHandler({now:()=>1000,verifySession:async token=>token==='valid'?session:null,admin:{member:async()=>member,apply:async()=>{applied++;return {status:'applied'};},catalog:async()=>({items:[]})}});
 assert.equal((await handler(request('me',undefined,null))).status,401);assert.equal((await handler(request('me',undefined,'invalid'))).status,401);
 assert.equal((await handler(request('me'))).status,403);assert.equal((await handler(request('actions',{action:'anything'}))).status,403);assert.equal(applied,0);
 member=true;assert.equal((await handler(request('me'))).status,200);assert.equal((await handler(request('actions',{request_id:'example'}))).status,200);assert.equal(applied,1);
 session.expiresAt=1;assert.equal((await handler(request('me'))).status,401);
});
test('administration distinguishes a changed request ID, revoked membership and bounded catalog parameters',async()=>{
 let error=new AdminConflictError();const handler=createAdminHandler({now:()=>1000,verifySession:async()=>({active:true,expiresAt:1000}),admin:{member:async()=>true,apply:async()=>{throw error;},catalog:async()=>({items:[]})}});
 assert.equal((await handler(request('actions',{}))).status,409);error=new AdminDeniedError();assert.equal((await handler(request('actions',{}))).status,403);
 assert.equal((await handler(request('catalog?kind=guards&kind=vendors'))).status,400);assert.equal((await handler(request('catalog?kind=guards&token=secret'))).status,400);assert.equal((await handler(request('catalog?kind=guards'))).status,200);
});
test('admin password exchange is limited, rechecks membership and never returns refresh credentials',async()=>{
 let allowed=true,active=true,exchange=0,change=false;
 const admin={consumeLoginAttempt:async()=>allowed,loginAccount:async email=>active&&email==='admin@example.invalid'?{subject:'user',email}:null};
 const handler=createAdminHandler({admin,now:()=>1000,passwordSession:async()=>{exchange++;if(change)active=false;return {access_token:'synthetic',expires_at:1000};}});
 const credentials={email:'ADMIN@example.invalid',password:'synthetic-only'};
 let r=await handler(request('login',credentials));assert.equal(r.status,200);assert.equal('refresh_token' in await r.json(),false);
 allowed=false;assert.equal((await handler(request('login',credentials))).status,429);assert.equal(exchange,1);
 allowed=true;change=true;assert.equal((await handler(request('login',credentials))).status,401);
 assert.equal((await handler(new Request('https://guard.test/v1/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:'{'}))).status,400);
 assert.equal((await handler(request('login',{...credentials,password:'x'.repeat(5000)}))).status,400);
});
test('pending request resolution is protected and retains explicit conflict outcomes',async()=>{
 let settled=0,member=true;const handler=createAdminHandler({now:()=>1000,verifySession:async()=>({active:true,expiresAt:1000}),admin:{member:async()=>member,settle:async value=>{settled++;return {status:'not_applied'};}}});
 assert.equal((await handler(request('resolve',{}))).status,200);assert.equal(settled,1);member=false;assert.equal((await handler(request('resolve',{}))).status,403);assert.equal(settled,1);assert.equal((await handler(request('resolve'))).status,405);assert.equal((await handler(request('resolve?request_id=secret',{}))).status,400);
});
test('private report photos require current verified administrator access and never accept URL credentials',async()=>{
 const id='a'.repeat(64),bytes=Buffer.from([0xff,0xd8,0xff,0xe0,0xff,0xd9]);let member=true,valid=true,reads=0,deniedDuringRead=false;
 const handler=createAdminHandler({now:()=>1000,verifySession:async()=>valid?{active:true,expiresAt:1000}:null,admin:{member:async()=>member,media:async(_session,deliveryId)=>{reads++;assert.equal(deliveryId,id);if(deniedDuringRead)throw new AdminDeniedError();return {bytes};}}});
 assert.equal((await handler(request('media/'+id,undefined,null))).status,401);
 valid=false;assert.equal((await handler(request('media/'+id))).status,401);valid=true;
 member=false;assert.equal((await handler(request('media/'+id))).status,403);assert.equal(reads,0);member=true;
 let response=await handler(request('media/'+id));assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/jpeg');assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('cross-origin-resource-policy'),'same-origin');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 deniedDuringRead=true;assert.equal((await handler(request('media/'+id))).status,403);
 assert.equal((await handler(request('media/'+id+'?token=secret'))).status,400);assert.equal((await handler(request('media/'+id,{}))).status,405);assert.equal((await handler(request('media/'+id.toUpperCase()))).status,404);assert.equal((await handler(request('media/'+id+'/extra'))).status,404);
});
