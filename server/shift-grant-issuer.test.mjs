import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify,createPublicKey} from 'node:crypto';
import {ShiftGrantIssuer} from './shift-grant-issuer.mjs';
import {localIssuerKey} from './local-issuer-key.mjs';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const config={privateKey,keyId:'test-v1',issuer:'mercury-local',audience:'mercury-local'};
const context={identity:{subject:'user',guardId:'guard',vendorId:'vendor'},assignment:{guardId:'guard',vendorId:'vendor',deviceId:'phone',siteId:'site',assignmentId:'shift',canStart:true,startsAt:100,endsAt:2000000},device:{deviceId:'phone',siteId:'site',mode:'site',active:true,revoked:false,thumbprint:'a'.repeat(64),revocationVersion:1},sessionExpiresAt:9999999,allowedActions:['incident'],now:1000};
test('grant signature matches Android domain and bounded claims',()=>{
 const issuer=new ShiftGrantIssuer({...config,path:':memory:'});try{
  const g=issuer.issue(context),c=JSON.parse(Buffer.from(g.payload,'base64url'));
  assert.equal(verify('sha256',Buffer.from(`mercury-shift-grant-v1.${g.key_id}.${g.payload}`),createPublicKey(privateKey),Buffer.from(g.signature,'base64url')),true);
  assert.equal(c.expires_at_ms,901000);assert.equal(c.guard_id,'guard');assert.equal(c.device_thumbprint,'a'.repeat(64));assert.equal(g.server_time_ms,1000);
  const shortened=JSON.parse(Buffer.from(issuer.issue({...context,sessionExpiresAt:2000}).payload,'base64url'));assert.equal(shortened.expires_at_ms,2000);
  const ended=JSON.parse(Buffer.from(issuer.issue({...context,assignment:{...context.assignment,endsAt:1500}}).payload,'base64url'));assert.equal(ended.expires_at_ms,1500);
 }finally{issuer.close();}
});
test('invalid scopes, expired sessions and unsupported actions cannot issue',()=>{
 const issuer=new ShiftGrantIssuer({...config,path:':memory:'});try{
  for(const patch of [{sessionExpiresAt:999},{allowedActions:['admin']},{allowedActions:['incident','incident']},{device:{...context.device,revoked:true}},{assignment:{...context.assignment,vendorId:'other'}},{assignment:{...context.assignment,canStart:false}},{device:{...context.device,mode:'personal',guardId:'other'}}])assert.throws(()=>issuer.issue({...context,...patch}));
 }finally{issuer.close();}
});
test('local signing key survives restart and corrupted material is not replaced',()=>{
 const dir=mkdtempSync(join(tmpdir(),'mercury-issuer-')),path=join(dir,'private.pem');try{
  const key=localIssuerKey(path),again=localIssuerKey(path);assert.equal(key.export({type:'pkcs8',format:'pem'}),again.export({type:'pkcs8',format:'pem'}));
  writeFileSync(path,'corrupt');assert.throws(()=>localIssuerKey(path));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
