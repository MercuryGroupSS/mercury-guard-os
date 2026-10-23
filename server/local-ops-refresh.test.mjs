import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OpsBindingStore} from './ops-binding-store.mjs';
import {LocalGuardDirectory} from './local-guard-directory.mjs';
import {LocalDeviceAssignments} from './local-device-assignments.mjs';
import {OpsAssignmentSync} from './ops-assignment-sync.mjs';
import {openLocalOpsRefresh} from './local-ops-refresh.mjs';
const config={API_URL:'http://127.0.0.1:55321',SERVICE_ROLE_KEY:'local.test.signature'};
test('Ops refresh is opt-in and rejects invalid source modes before creating stores',async()=>{
 const off=openLocalOpsRefresh({config});assert.deepEqual(off.status(),{enabled:false});await off.start();await off.close();
 assert.throws(()=>openLocalOpsRefresh({config,mode:'on'}));
 assert.throws(()=>openLocalOpsRefresh({config,mode:'local',source:{url:'https://other.test'}}));
 assert.throws(()=>openLocalOpsRefresh({config,mode:'remote',source:{url:'http://127.0.0.1:55321',serverKey:'local.test.signature'}}));
});
test('recurring local composition reads only approved IDs and applies saved revocations without upstream access',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mercury-refresh-')),path=join(dir,'bindings.sqlite');
 const bindings=new OpsBindingStore(path),directory=new LocalGuardDirectory(':memory:'),devices=new LocalDeviceAssignments(':memory:');
 const binding={opsShiftId:'approved',guardId:'guard',vendorId:'vendor',siteId:'site',authSubject:'subject',revision:1,active:true};
 bindings.approve(binding,{operator:'test',reason:'synthetic'});directory.addVendor({vendorId:'vendor',kind:'company',active:true});directory.addGuard({guardId:'guard',vendorId:'vendor',authSubject:'subject',active:true});
 let callback,reads=0,cancelled=false;
 const refresh=openLocalOpsRefresh({mode:'local',config,bindingsPath:path,sync:new OpsAssignmentSync(devices),directory,schedule:fn=>{callback=fn;return 1;},cancel:()=>{cancelled=true;},fetchImpl:async(url,options)=>{
  reads++;assert.equal(options.method,'GET');assert.equal(new URL(url).searchParams.get('id'),'in.("approved")');
  return Response.json([{id:'approved',scheduled_start:'2026-10-23T12:00:00Z',scheduled_end:'2026-10-23T20:00:00Z',updated_at:'2026-10-23T10:00:00Z',status:'scheduled'}]);
 }});
 try{
  assert.equal((await refresh.start()).processed,1);assert.equal(reads,1);
  bindings.approve({...binding,active:false,revision:2},{operator:'test',reason:'synthetic revoke'});
  await callback();assert.equal(reads,1);assert.equal(JSON.parse(devices.db.prepare('SELECT body FROM assignments').get().body).active,false);
  await refresh.close();assert.equal(cancelled,true);await callback();assert.equal(reads,1);
  assert.throws(()=>refresh.run(),/closed/);
 }finally{await refresh.close();bindings.close();directory.close();devices.close();rmSync(dir,{recursive:true,force:true});}
});
