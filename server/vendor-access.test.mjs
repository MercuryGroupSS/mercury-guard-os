import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {LocalGuardDirectory} from './local-guard-directory.mjs';
import {createGuardResolver} from './guard-directory.mjs';

test('vendor suspension persists and denies all linked guards without changing individual status',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'mercury-vendor-access-'));
 let directory;
 try{
  const path=join(folder,'directory.sqlite');directory=new LocalGuardDirectory(path);
  directory.addVendor({vendorId:'company',kind:'company',active:true});
  directory.addVendor({vendorId:'individual',kind:'individual',active:true});
  for(const [guardId,vendorId] of [['a','company'],['b','company'],['c','individual']]){
   directory.addGuard({guardId,vendorId,authSubject:'subject-'+guardId,active:true});
   directory.setLoginEmail(guardId,guardId+'@example.test');
  }
  const resolve=createGuardResolver({loadGuardsForSubject:s=>directory.loadGuardsForSubject(s),loadVendor:id=>directory.loadVendor(id)});
  const identity=id=>resolve({subject:'subject-'+id,active:true});
  assert.equal((await identity('c')).vendorId,'individual');
  assert.equal(directory.loginAccount('company'),null);
  directory.setGuardActive('b',false);
  directory.setVendorActive('company',false);
  directory.close();directory=new LocalGuardDirectory(path);
  for(const id of ['a','b']){assert.equal(directory.loginAccount(id),null);assert.equal(await identity(id),null);}
  assert.equal((await identity('c')).guardId,'c');
  assert.equal(directory.loadGuardsForSubject('subject-a')[0].active,true);
  directory.setVendorActive('company',true);
  assert.equal((await identity('a')).guardId,'a');
  assert.equal(directory.loginAccount('a').subject,'subject-a');
  assert.equal(await identity('b'),null);
  assert.equal(directory.loginAccount('b'),null);
  directory.setVendorActive('individual',false);
  assert.equal(await identity('c'),null);
  assert.equal(directory.loginAccount('c'),null);
  assert.throws(()=>directory.setVendorActive('missing',false),/Vendor not found/);
  assert.throws(()=>directory.setVendorActive('company',1),/Boolean required/);
  assert.equal(directory.loadVendor('company').active,true);
 }finally{directory?.close();rmSync(folder,{recursive:true,force:true});}
});
