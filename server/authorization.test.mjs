import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthorization} from './authorization.mjs';
const session={subject:'subject-a',active:true,expiresAt:1500};
const record={subject:'subject-a',active:true,enrolled:true,revoked:false,audience:'mercury-local',thumbprint:'a'.repeat(64),publicKeySpki:'synthetic',guardId:'guard-a',siteId:'site-a',assignmentId:'shift-a',revocationVersion:1,notBefore:1000,expiresAt:1800,allowedKinds:['incident']};
function auth(s=session,a=record){return createAuthorization({verifySession:async token=>token==='test-token'?s:null,loadAuthorization:async subject=>{assert.equal(subject,'subject-a');return a;},audience:'mercury-local',now:()=>1100});}
test('verified subject selects independent authority and session bounds lifetime',async()=>{
 const result=await auth({...session,user_metadata:{guardId:'attacker'}},{...record,secret:'never return'})('Bearer test-token');
 assert.equal(result.guardId,'guard-a');assert.equal(result.expiresAt,1500);assert.equal(result.secret,undefined);
 assert.ok(Object.isFrozen(result.allowedKinds));
});
test('malformed or invalid credentials fail before authority lookup',async()=>{
 for(const header of [null,'','Basic x','Bearer wrong','Bearer a b']) assert.equal(await auth()(header),null);
 for(const s of [null,{...session,active:false},{...session,expiresAt:1100},{...session,subject:''}]) assert.equal(await auth(s)('Bearer test-token'),null);
});
test('independent authorization rejects wrong subject, scope state and grant timing',async()=>{
 for(const patch of [{subject:'other'},{active:false},{enrolled:false},{revoked:true},{audience:'other'},{guardId:''},{thumbprint:'bad'},{notBefore:1200},{expiresAt:1100},{expiresAt:2000},{allowedKinds:[]},{revocationVersion:-1}]) assert.equal(await auth(session,{...record,...patch})('Bearer test-token'),null);
});
test('provider failure cannot become authorized',async()=>{
 const a=createAuthorization({verifySession:async()=>{throw Error('offline');},loadAuthorization:async()=>record,audience:'mercury-local'});
 await assert.rejects(()=>a('Bearer token'));
});
