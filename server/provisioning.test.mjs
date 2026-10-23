import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,rmSync,existsSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {validateProvisioning,createProvisioning} from './provisioning.mjs';
import {LocalGuardDirectory} from './local-guard-directory.mjs';
const publicKeySpki=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({type:'spki',format:'der'}).toString('base64url');
function fixture(){return {version:1,vendors:[{vendorId:'company',kind:'company',active:true}],guards:[{guardId:'guard-a',authSubject:'auth-a',vendorId:'company',email:'a@example.test',active:true},{guardId:'guard-b',authSubject:'auth-b',vendorId:'company',email:'b@example.test',active:true}],devices:[{deviceId:'site-phone',mode:'site',siteId:'site',publicKeySpki,active:true,revoked:false}],assignments:[{assignmentId:'shift',guardId:'guard-a',vendorId:'company',siteId:'site',startsAt:1000,endsAt:100000,active:true}],dashboardBindings:[]};}
test('company roster creates separate individual identities in a new unactivated snapshot',()=>{
 const dir=mkdtempSync(join(tmpdir(),'provision-')),output=join(dir,'snapshot');try{
  assert.equal(validateProvisioning(fixture()).guards,2);const result=createProvisioning(fixture(),output);assert.equal(result.status,'validated_not_activated');
  assert.equal(statSync(output).mode&0o777,0o700);assert.equal(statSync(join(output,'directory.sqlite')).mode&0o777,0o600);
  const directory=new LocalGuardDirectory(join(output,'directory.sqlite'));try{assert.equal(directory.loginAccount('guard-b').subject,'auth-b');assert.equal(directory.loginAccount('guard-a').subject,'auth-a');}finally{directory.close();}
  assert.throws(()=>createProvisioning(fixture(),output));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('ambiguous credentials, foreign vendor links and unknown fields fail before filesystem creation',()=>{
 const dir=mkdtempSync(join(tmpdir(),'provision-invalid-'));try{
  const mutations=[x=>x.guards[1].authSubject='auth-a',x=>x.guards[1].email='A@example.test',x=>x.assignments[0].vendorId='other',x=>x.guards[0].password='forbidden',x=>x.devices[0].publicKeySpki='invalid',x=>x.assignments[0].siteId='other',x=>x.vendors[0].active=false,x=>x.devices[0].guardId='guard-a'];
  for(const mutate of mutations){const value=fixture();mutate(value);assert.throws(()=>createProvisioning(value,join(dir,'snapshot')));assert.equal(existsSync(join(dir,'snapshot')),false);}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
