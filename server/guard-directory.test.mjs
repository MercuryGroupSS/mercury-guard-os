import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGuardResolver,assignmentForGuard} from './guard-directory.mjs';
const records=[{authSubject:'user-1',guardId:'guard-1',vendorId:'MG001',active:true},{authSubject:'user-2',guardId:'guard-2',vendorId:'MG001',active:true}];
const resolve=createGuardResolver({loadGuardsForSubject:async s=>records.filter(r=>r.authSubject===s),loadVendor:async id=>({vendorId:id,kind:'company',active:true})});
test('company guards retain distinct individual identities',async()=>{
 const a=await resolve({subject:'user-1',active:true}),b=await resolve({subject:'user-2',active:true});
 assert.equal(a.vendorId,b.vendorId);assert.notEqual(a.guardId,b.guardId);
 assert.equal(await resolve({subject:'MG001',active:true}),null);
});
test('ambiguous, disabled or mismatched directory records deny access',async()=>{
 for(const rows of [[records[0],records[0]],[{...records[0],active:false}],[{...records[0],authSubject:'other'}]]){
  const r=createGuardResolver({loadGuardsForSubject:async()=>rows,loadVendor:async()=>{throw Error('must not consult vendor');}});
  assert.equal(await r({subject:'user-1',active:true}),null);
 }
 const r=createGuardResolver({loadGuardsForSubject:async()=>[records[0]],loadVendor:async()=>({vendorId:'MG001',kind:'company',active:false})});
 assert.equal(await r({subject:'user-1',active:true}),null);
});
const identity={guardId:'guard-1',vendorId:'MG001'};
const assignment={...identity,assignmentId:'shift-1',siteId:'site-1',active:true,startsAt:100,endsAt:200};
const device={deviceId:'phone-1',mode:'site',siteId:'site-1',active:true,revoked:false};
test('site phone restricts assignments by person and site, not company alone',()=>{
 assert.equal(assignmentForGuard({identity,assignment,device,now:150}).canStart,true);
 for(const patch of [{guardId:'guard-2'},{vendorId:'MG002'},{siteId:'site-2'},{active:false}])assert.equal(assignmentForGuard({identity,assignment:{...assignment,...patch},device,now:150}),null);
 assert.equal(assignmentForGuard({identity,assignment,device:{...device,revoked:true},now:150}),null);
});
test('personal phone and future/expired assignment boundaries',()=>{
 const personal={...device,mode:'personal',guardId:'guard-1'};
 assert.equal(assignmentForGuard({identity,assignment,device:personal,now:99}).canStart,false);
 assert.equal(assignmentForGuard({identity,assignment,device:personal,now:200}),null);
 assert.equal(assignmentForGuard({identity,assignment,device:{...personal,guardId:'guard-2'},now:150}),null);
});
