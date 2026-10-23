import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAdminAuthAccountReader} from './admin-auth-account.mjs';
const subject='11111111-1111-4111-8111-111111111111';
test('account lookup uses only trusted Auth administration and returns limited verified fields',async()=>{
 const reader=createAdminAuthAccountReader({url:'https://auth.example.test',serverKey:'sb_secret_synthetic',fetchImpl:async(url,options)=>{assert.equal(url,'https://auth.example.test/auth/v1/admin/users/'+subject);assert.equal(options.headers.apikey,'sb_secret_synthetic');assert.equal(options.redirect,'error');return Response.json({id:subject,email:'GUARD@example.invalid',email_confirmed_at:'2026-10-23T10:00:00Z',user_metadata:{admin:true},private_field:'omit'});}});
 assert.deepEqual(await reader(subject),{subject,email:'guard@example.invalid',confirmed:true,enabled:true});
 for(const url of ['http://auth.example.test','https://user:secret@auth.example.test','https://auth.example.test/?key=secret'])assert.throws(()=>createAdminAuthAccountReader({url,serverKey:'synthetic'}));
});
test('foreign, absent or unconfirmed Auth accounts cannot be represented as confirmed identities',async()=>{
 const lookup=response=>createAdminAuthAccountReader({url:'https://auth.example.test',serverKey:'synthetic',fetchImpl:async()=>response});
 assert.equal(await lookup(new Response('',{status:404}))(subject),null);
 assert.equal(await lookup(Response.json({id:'different',email:'guard@example.invalid'}))(subject),null);
 const account=await lookup(Response.json({id:subject,email:'guard@example.invalid',email_confirmed_at:null}))(subject);assert.equal(account.confirmed,false);
 await assert.rejects(lookup(new Response('',{status:503}))(subject));
});
