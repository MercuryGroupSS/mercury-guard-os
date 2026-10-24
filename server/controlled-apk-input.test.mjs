import test from 'node:test';import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';import {mkdtempSync,writeFileSync,chmodSync,symlinkSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {validatePublicGuardConfiguration,validateControlledBuildInput,readPrivateBuildFile,assertPreviousApkCompatible,parseApkIdentity} from './controlled-apk-input.mjs';
const key=generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({format:'der',type:'spki'}).toString('base64url');
const config={endpoint:'https://synthetic.invalid',issuer:'synthetic',audience:'synthetic',device_id:'synthetic-phone',issuer_keys:{synthetic:key}};
const input={version:1,mode:'synthetic_build_proof',source_directory:'/tmp/guard-source',source_commit:'a'.repeat(40),public_config_path:'/tmp/public.json',signing:{keystore_path:'/tmp/test.p12',store_password:'synthetic',key_alias:'synthetic',key_password:'synthetic'},expected:{package:'ca.mercury.guard',version_code:34,version_name:'0.34.0',signer_sha256:'b'.repeat(64)},output_directory:'/tmp/guard-result',previous_apk:null,tools:{gradle:'/tmp/gradle',java_home:'/tmp/jdk',android_sdk:'/tmp/sdk',gradle_cache_directory:null}};
test('public config excludes credentials and requires exact HTTPS/RSA identity and explicit proof mode',()=>{
 assert.deepEqual(validatePublicGuardConfiguration(config,input.mode),config);
 for(const mutate of [c=>c.password='secret',c=>c.endpoint='http://synthetic.invalid',c=>c.endpoint+='/',c=>c.endpoint='https://user:secret@synthetic.invalid',c=>c.issuer_keys.synthetic+='=',c=>c.issuer_keys.synthetic=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({type:'spki',format:'der'}).toString('base64url'),c=>c.audience='bad\nvalue']){const c=structuredClone(config);mutate(c);assert.throws(()=>validatePublicGuardConfiguration(c,input.mode));}
 assert.throws(()=>validatePublicGuardConfiguration(config,'controlled_release'));assert.throws(()=>validatePublicGuardConfiguration({...config,endpoint:'https://guard.example.com'},'synthetic_build_proof'));
});
test('build review binds source/package/version/signer and forbids extra test/signing flags or source output',()=>{
 assert.deepEqual(validateControlledBuildInput(input),input);
 for(const mutate of [c=>c.httpsTest=true,c=>c.expected.package+=' .httpstest',c=>delete c.expected.signer_sha256,c=>c.source_commit='main',c=>c.signing.store_password='',c=>c.output_directory=c.source_directory+'/out',c=>c.output_directory=c.source_directory+'/..output',c=>c.tools.gradle='gradle']){const c=structuredClone(input);mutate(c);assert.throws(()=>validateControlledBuildInput(c));}
});
test('private material rejects symlinks, public permissions and unbounded input',()=>{
 const dir=mkdtempSync(join(tmpdir(),'controlled-build-input-'));try{const p=join(dir,'private'),link=join(dir,'link');writeFileSync(p,'synthetic',{mode:0o600});assert.equal(readPrivateBuildFile(p).toString(),'synthetic');assert.throws(()=>readPrivateBuildFile(p,2));chmodSync(p,0o644);assert.throws(()=>readPrivateBuildFile(p));chmodSync(p,0o600);symlinkSync(p,link);assert.throws(()=>readPrivateBuildFile(link));}finally{rmSync(dir,{recursive:true,force:true});}
});
test('APK parsing requires release identity and prior comparison rejects wrong package/signer/downgrade',()=>{
 const badging="package: name='ca.mercury.guard' versionCode='34' versionName='0.34.0'",cert='Signer #1 certificate SHA-256 digest: '+'b'.repeat(64);
 assert.deepEqual(parseApkIdentity(badging,cert),input.expected);assert.throws(()=>parseApkIdentity(badging+'\napplication-debuggable',cert));assert.throws(()=>parseApkIdentity(badging,cert+'\n'+cert));
 assert.throws(()=>parseApkIdentity(badging.replace("versionCode='34'","versionCode='0'"),cert));
 assertPreviousApkCompatible({...input.expected,version_code:33},input.expected);
 for(const previous of [{...input.expected,version_code:35},{...input.expected,package:'ca.mercury.guard.preview'},{...input.expected,signer_sha256:'c'.repeat(64)}])assert.throws(()=>assertPreviousApkCompatible(previous,input.expected));
});
