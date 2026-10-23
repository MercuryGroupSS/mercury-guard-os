import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LocalGuardDirectory} from './local-guard-directory.mjs';
import {administerVendor} from './vendor-administration.mjs';

test('operator vendor changes are atomic, audited and preserve individual guard state',()=>{
 const folder=mkdtempSync(join(tmpdir(),'vendor-admin-')),database=join(folder,'directory.sqlite');
 const d=new LocalGuardDirectory(database);
 try{
  d.addVendor({vendorId:'company',kind:'company',active:true});
  for(const [guardId,active] of [['a',true],['b',false]])d.addGuard({guardId,active,authSubject:guardId,vendorId:'company'});
  const args={database,vendorId:'company'};
  assert.equal(administerVendor(args).eligibleGuards,1);
  assert.equal(d.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='vendor_access_audit'").get().n,0);
  const change={...args,action:'suspend',operator:'local-test',reason:'Synthetic suspension'};
  const result=administerVendor(change);assert.equal(result.eligibleGuards,0);assert.equal(result.changed,true);
  assert.equal(d.loadVendor('company').active,false);
  assert.equal(d.db.prepare('SELECT count(*) n FROM vendor_access_audit').get().n,1);
  assert.equal(administerVendor(change).changed,false);
  assert.equal(d.db.prepare('SELECT count(*) n FROM vendor_access_audit').get().n,2);
  assert.equal(administerVendor({...change,action:'activate'}).eligibleGuards,1);
  assert.equal(d.loadGuardsForSubject('b')[0].active,false);
  d.db.exec("CREATE TRIGGER audit_failure BEFORE INSERT ON vendor_access_audit BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  assert.throws(()=>administerVendor(change));assert.equal(d.loadVendor('company').active,true);
  assert.throws(()=>administerVendor({...change,reason:''}));
  assert.throws(()=>administerVendor({...change,vendorId:'missing'}));
  assert.throws(()=>administerVendor({...args,database:join(folder,'missing.sqlite')}));
  assert.equal(existsSync(join(folder,'missing.sqlite')),false);
  symlinkSync(database,join(folder,'link.sqlite'));
  assert.throws(()=>administerVendor({...args,database:join(folder,'link.sqlite')}));
 }finally{d.close();rmSync(folder,{recursive:true,force:true});}
});
