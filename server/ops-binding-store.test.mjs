import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {OpsBindingStore} from './ops-binding-store.mjs';
const binding={opsShiftId:'shift',guardId:'guard',vendorId:'vendor',siteId:'site',authSubject:'subject',revision:1,active:true};
const context={operator:'synthetic-admin',reason:'Approved synthetic assignment',now:1000};
test('approved mappings survive restart with immutable history and exact retry',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ops-bindings-')),path=join(dir,'bindings.sqlite');let store=new OpsBindingStore(path);
 try{
  assert.equal(store.approve(binding,context).status,'approved_locally');store.close();store=new OpsBindingStore(path);
  assert.deepEqual(store.list(),[binding]);assert.equal(store.approve(binding,context).status,'unchanged');
  assert.throws(()=>store.approve({...binding,guardId:'other'},context));
  store.approve({...binding,revision:2,active:false},context);
  assert.throws(()=>store.approve(binding,context));
  assert.equal(store.list()[0].active,false);assert.equal(store.db.prepare('SELECT count(*) n FROM ops_binding_history').get().n,2);
  assert.equal(JSON.parse(store.db.prepare('SELECT body FROM ops_binding_history WHERE revision=1').get().body).active,true);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('failed audit insertion cannot change current approval and unexpected credentials are refused',()=>{
 const store=new OpsBindingStore(':memory:');try{
  store.approve(binding,context);store.db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON ops_binding_history BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END;");
  assert.throws(()=>store.approve({...binding,revision:2,active:false},context));assert.equal(store.list()[0].active,true);
  assert.throws(()=>store.approve({...binding,password:'secret'},context));assert.throws(()=>store.approve(binding,{...context,reason:''}));
 }finally{store.close();}
});
test('patrol round authority must be explicitly approved and invalid rounds never enter binding history',()=>{
 const store=new OpsBindingStore(':memory:'),route={routeId:'approved-route',revision:2,checkpoints:[{id:'entrance',label:'Entrance'}],rounds:[{id:'first',label:'First patrol'},{id:'second',label:'Second patrol'}]};try{
  store.approve({...binding,patrolRoute:route},context);route.rounds[0].id='changed-after-approval';assert.equal(store.list()[0].patrolRoute.rounds[0].id,'first');
  assert.throws(()=>store.approve({...binding,revision:2,patrolRoute:{...route,rounds:[{id:'same',label:'A'},{id:'same',label:'B'}]}},context));assert.equal(store.list()[0].revision,1);assert.equal(store.db.prepare('SELECT count(*) n FROM ops_binding_history').get().n,1);
 }finally{store.close();}
});
