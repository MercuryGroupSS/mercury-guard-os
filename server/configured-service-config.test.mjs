import test from 'node:test';import assert from 'node:assert/strict';
import {chmodSync,symlinkSync,readFileSync} from 'node:fs';
import {generateKeyPairSync} from 'node:crypto';
import {join} from 'node:path';
import {configuredFixture} from './fixtures/configured-service.mjs';
import {validateConfiguredServiceConfig,readConfiguredServiceConfig,loadConfiguredMaterials,configuredDeploymentIdentity,configuredPublicConfiguration} from './configured-service-config.mjs';
const fixture=configuredFixture();test.after(()=>fixture.close());
test('configured settings require exact fields and modes, correct credential class and explicit authority',()=>{
 assert.deepEqual(validateConfiguredServiceConfig(fixture.config),fixture.config);
 for(const change of [c=>{delete c.mode;},c=>c.extra=true,c=>c.mode='production-default',c=>c.public_origin='http://localhost:55448',c=>c.public_origin+='/',c=>c.public_origin='https://attacker.invalid:55448',c=>c.listen.host='0.0.0.0',c=>c.listen.host='192.0.2.1',c=>c.auth.origin='https://other.invalid',c=>c.auth.publishable_key=c.auth.server_key,c=>c.auth.server_key=c.auth.publishable_key,c=>c.database.url+='?sslmode=disable',c=>c.database.url='postgresql://a:b@remote.invalid:55322/guard',c=>c.issuer.audience='bad\nvalue',c=>c.issuer.private_key_path='relative.pem',c=>c.ops_refresh={origin:'http://ops.invalid',server_key:c.auth.server_key,interval_ms:1000}]){
  const copy=structuredClone(fixture.config);change(copy);assert.throws(()=>validateConfiguredServiceConfig(copy),/^Error: Configured service configuration invalid$/);
 }
 const remote=structuredClone(fixture.config);remote.mode='configured';remote.auth.origin='https://auth.example.invalid';remote.database.url='postgresql://a:b@database.example.invalid:5432/guard';assert.equal(validateConfiguredServiceConfig(remote).mode,'configured');
 remote.auth.origin='http://127.0.0.1:55321';assert.throws(()=>validateConfiguredServiceConfig(remote));
});
test('private config/key files reject symlinks and group/world access without leaking input',()=>{
 const file=fixture.save('runtime.json',JSON.stringify(fixture.config));assert.deepEqual(readConfiguredServiceConfig(file),fixture.config);
 chmodSync(file,0o644);assert.throws(()=>readConfiguredServiceConfig(file),/configuration invalid/);chmodSync(file,0o600);
 const link=join(fixture.dir,'linked.json');symlinkSync(file,link);assert.throws(()=>readConfiguredServiceConfig(link),/configuration invalid/);
 const key=fixture.config.issuer.private_key_path;chmodSync(key,0o640);assert.throws(()=>loadConfiguredMaterials(fixture.config),/material invalid/);chmodSync(key,0o600);
 const errorFile=fixture.save('bad.json','{"database":"secret-password"}');assert.throws(()=>readConfiguredServiceConfig(errorFile),e=>!String(e).includes('secret-password'));
});
test('TLS name/key/validity and supplied RSA issuer are bound to public configuration',()=>{
 const material=loadConfiguredMaterials(fixture.config),id=configuredDeploymentIdentity(fixture.config,material),publicConfig=configuredPublicConfiguration(fixture.config,material,'synthetic-phone');
 assert.equal(id.issuer_spki_sha256.length,64);assert.deepEqual(Object.keys(publicConfig).sort(),['audience','device_id','endpoint','issuer','issuer_keys']);assert.ok(!JSON.stringify(publicConfig).includes('PRIVATE'));
 assert.throws(()=>loadConfiguredMaterials({...fixture.config,public_origin:'https://wrong.invalid:55448'}),/material invalid/);
 assert.throws(()=>loadConfiguredMaterials(fixture.config,{now:Date.now()+3*86400000}),/material invalid/);
 const wrong=fixture.save('wrong-tls.pem',generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}));assert.throws(()=>loadConfiguredMaterials({...fixture.config,tls:{...fixture.config.tls,private_key_path:wrong}}),/material invalid/);
 const ec=fixture.save('wrong-issuer.pem',generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({type:'pkcs8',format:'pem'}));assert.throws(()=>loadConfiguredMaterials({...fixture.config,issuer:{...fixture.config.issuer,private_key_path:ec}}),/material invalid/);
 assert.throws(()=>configuredPublicConfiguration(fixture.config,material,'not an ID'));
 assert.ok(readFileSync(fixture.config.tls.certificate_path).length>0);
});
