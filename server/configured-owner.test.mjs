import test from 'node:test';import assert from 'node:assert/strict';
import {randomUUID,X509Certificate} from 'node:crypto';
import {readFileSync,chmodSync,symlinkSync} from 'node:fs';
import {configuredFixture} from './fixtures/configured-service.mjs';
import {validateConfiguredOwnerInput,readConfiguredOwnerInput,loadConfiguredOwnerMaterials} from './configured-owner-input.mjs';
import {assertOwnerTls,openConfiguredOwner} from './configured-owner-membership.mjs';
function input(f){return {version:1,expected_deployment:{deployment_id:randomUUID(),auth_origin:'https://auth.example.invalid',public_origin:'https://guard.example.invalid',issuer:'https://guard.example.invalid',audience:'guard-owner-test',issuer_key_id:'test-key',issuer_spki_sha256:'a'.repeat(64)},database:{url:'postgresql://postgres:synthetic@localhost:55322/synthetic',ca_path:f.save('database-ca.pem',readFileSync(f.config.tls.certificate_path))},auth:{origin:'https://auth.example.invalid',server_key:'sb_secret_synthetic_test_only'},request:{requestId:randomUUID(),subject:randomUUID(),email:'owner@example.invalid',active:true,operator:'Synthetic owner',reason:'Synthetic reviewed membership only'}};}
test('configured owner input is exact, deployment-bound and cannot override TLS or discover credentials',()=>{
 const f=configuredFixture();try{const c=input(f);assert.deepEqual(validateConfiguredOwnerInput(c),c);
  for(const patch of [{extra:true},{version:2},{expected_deployment:{...c.expected_deployment,issuer_spki_sha256:'not-a-hash'}},{database:{...c.database,url:c.database.url+'?sslmode=disable'}},{database:{...c.database,url:'postgresql://postgres@localhost/synthetic'}},{database:{...c.database,ca_path:null}},{auth:{...c.auth,origin:'https://foreign.example.invalid'}},{auth:{...c.auth,server_key:'sb_publishable_not_owner'}},{request:{...c.request,role:'postgres'}}])assert.throws(()=>validateConfiguredOwnerInput({...c,...patch}));
 }finally{f.close();}
});
test('configured owner request and CA are bounded private owned files, with no symlink or private-key CA substitution',()=>{
 const f=configuredFixture();try{const c=input(f),p=f.save('owner.json',JSON.stringify(c));assert.deepEqual(readConfiguredOwnerInput(p),c);assert.ok(loadConfiguredOwnerMaterials(c).databaseCa.length);
  chmodSync(p,0o644);assert.throws(()=>readConfiguredOwnerInput(p));chmodSync(p,0o600);const link=f.dir+'/linked.json';symlinkSync(p,link);assert.throws(()=>readConfiguredOwnerInput(link));
  const key=f.save('not-ca.pem',readFileSync(f.config.tls.private_key_path));assert.throws(()=>loadConfiguredOwnerMaterials({...c,database:{...c.database,ca_path:key}}));assert.throws(()=>readConfiguredOwnerInput(f.save('oversized.json',' '.repeat(65537))));
 }finally{f.close();}
});
test('owner database connection requires encrypted authorized TLS and exact peer hostname',()=>{
 const f=configuredFixture();try{const peer=new X509Certificate(readFileSync(f.config.tls.certificate_path)).toLegacyObject(),client={connection:{stream:{encrypted:true,authorized:true,getPeerCertificate:()=>peer}}};assert.doesNotThrow(()=>assertOwnerTls(client,'localhost'));assert.throws(()=>assertOwnerTls(client,'different.example.invalid'));client.connection.stream.authorized=false;assert.throws(()=>assertOwnerTls(client,'localhost'));client.connection.stream.authorized=true;client.connection.stream.encrypted=false;assert.throws(()=>assertOwnerTls(client,'localhost'));
 }finally{f.close();}
});
test('wrong owner role or deployment marker denies before Auth requests and always releases the checked connection',async()=>{
 const f=configuredFixture();try{const c=input(f),peer=new X509Certificate(readFileSync(f.config.tls.certificate_path)).toLegacyObject();
  for(const scenario of ['role','session-role','marker']){let released=0,ended=0,network=0;const pool={on(){},end:async()=>{ended++},connect:async()=>({connection:{stream:{encrypted:true,authorized:true,getPeerCertificate:()=>peer}},release(){released++},query:async sql=>({rows:sql.includes('session_user')?[{role:scenario==='role'?'service_role':'postgres',session_role:scenario==='session-role'?'other_owner':'postgres'}]:[{...c.expected_deployment,issuer:scenario==='marker'?'different':c.expected_deployment.issuer}]})})};
   await assert.rejects(openConfiguredOwner(c,loadConfiguredOwnerMaterials(c),{poolFactory:options=>{assert.equal(options.max,1);assert.equal(options.ssl.rejectUnauthorized,true);assert.equal('options'in options,false);return pool;},fetchImpl:async()=>{network++;throw Error('No Auth request permitted');}}));assert.equal(released,1);assert.equal(ended,1);assert.equal(network,0);
  }
 }finally{f.close();}
});
