import {test} from 'node:test';import assert from 'node:assert/strict';import {OwnerAdminMembership,membershipRequest} from './owner-admin-membership.mjs';
const request={requestId:'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',subject:'11111111-2222-3333-4444-555555555555',email:'owner@example.invalid',active:true,operator:' Local owner ',reason:' Approved first owner '};
test('owner membership requests require exact individual account, explicit status and a bounded reason',()=>{
 assert.deepEqual(membershipRequest(request),{...request,requestId:request.requestId.toLowerCase(),operator:'Local owner',reason:'Approved first owner'});
 for(const change of [{active:'true'},{subject:'company-vendor'},{email:'OWNER@example.invalid'},{reason:' '},{reason:'reason\nfor change'},{extra:true}])assert.throws(()=>membershipRequest({...request,...change}));
});
test('service role cannot use owner provisioning, regardless of claimed operator label',async()=>{
 let readAccount=false,released=false;const owner=new OwnerAdminMembership({pool:{connect:async()=>({query:async()=>({rows:[{role:'service_role'}]}),release:()=>{released=true;}})},loadAuthAccount:async()=>{readAccount=true;}});
 await assert.rejects(owner.set({...request,operator:'postgres'}),/database owner/);assert.equal(readAccount,false);assert.equal(released,true);
});
