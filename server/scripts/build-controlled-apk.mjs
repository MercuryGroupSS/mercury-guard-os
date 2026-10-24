#!/usr/bin/env node
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,lstatSync,chmodSync,symlinkSync,copyFileSync,rmSync,constants} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash,randomUUID} from 'node:crypto';
import {loadControlledBuildInput,parseApkIdentity,assertPreviousApkCompatible,assertControlledBuildOutputIsolation} from '../controlled-apk-input.mjs';

process.umask(0o077);
const execute=promisify(execFile),digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const repository='https://github.com/MercuryGroupSS/mercury-guard-os.git';
let temporary,phase='input',privateLog,outputClaimed=false;const run=randomUUID();
function fail(){throw Error('Controlled build gate failed');}
// No secret values appear in this generated script, arguments or environment.
const init=`import groovy.json.JsonSlurper
def reviewed = new JsonSlurper().parse(new File(System.getenv('MERCURY_CONTROLLED_INPUT_FILE')))
allprojects { p ->
 p.buildDir = new File(System.getenv('MERCURY_CONTROLLED_BUILD_DIRECTORY'), p.name)
 p.afterEvaluate {
  if (p.plugins.hasPlugin('com.android.application')) {
   def android = p.extensions.getByName('android')
   android.sourceSets.getByName('release').assets.srcDir(System.getenv('MERCURY_CONTROLLED_PUBLIC_ASSETS'))
   def signing = android.signingConfigs.create('controlledSuppliedRelease')
   signing.storeFile = new File(reviewed.signing.keystore_path)
   signing.storePassword = reviewed.signing.store_password
   signing.keyAlias = reviewed.signing.key_alias
   signing.keyPassword = reviewed.signing.key_password
   android.buildTypes.getByName('release').signingConfig = signing
  }
 }
}
`;
const scriptPath=fileURLToPath(import.meta.url),helperPath=fileURLToPath(new URL('../controlled-apk-input.mjs',import.meta.url));
const tooling={builder_sha256:digest(readFileSync(scriptPath)),input_validator_sha256:digest(readFileSync(helperPath)),gradle_init_sha256:digest(Buffer.from(init)),gradle:'8.10.2',build_tools:'35.0.0'};
try{
 if(process.argv.length!==3)fail();const inputFile=resolve(process.argv[2]),{input,publicBytes}=loadControlledBuildInput(inputFile);
 assertControlledBuildOutputIsolation(input.source_directory,input.output_directory);
 if(!lstatSync(input.source_directory).isDirectory()||existsSync(input.output_directory))fail();
 temporary=mkdtempSync(join(tmpdir(),'mercury-controlled-build-'));chmodSync(temporary,0o700);
 const logDir=join(temporary,'logs');mkdirSync(logDir,{mode:0o700});privateLog=logDir;
 async function command(binary,args,label,env=process.env,timeout=120000){
  try{const r=await execute(binary,args,{env,cwd:temporary,timeout,encoding:'utf8',maxBuffer:32*1024*1024});writeFileSync(join(logDir,label+'.log'),r.stdout+'\n'+r.stderr,{mode:0o600});return r.stdout;}
  catch(error){writeFileSync(join(logDir,label+'.log'),(error.stdout??'')+'\n'+(error.stderr??''),{mode:0o600});fail();}
 }
 const gitEnv={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'},git=(directory,args,label)=>command('git',['-c','core.hooksPath=/dev/null','-C',directory,...args],label,gitEnv);
 phase='clean_source';
 if((await git(input.source_directory,['remote','get-url','origin'],'source-origin')).trim()!==repository)fail();
 if((await git(input.source_directory,['rev-parse','HEAD'],'source-head')).trim()!==input.source_commit||(await git(input.source_directory,['status','--porcelain=v1','--untracked-files=all'],'source-clean')).trim())fail();
 if(existsSync(join(input.source_directory,'app/src/main/assets/guard-service.json'))||existsSync(join(input.source_directory,'app/build/https-test/assets')))fail();
 const source=join(temporary,'source');await command('git',['-c','core.hooksPath=/dev/null','clone','--quiet','--no-hardlinks','--no-checkout',input.source_directory,source],'isolated-clone',gitEnv);
 await git(source,['checkout','--quiet','--detach',input.source_commit],'isolated-checkout');
 if((await git(source,['rev-parse','HEAD'],'isolated-head')).trim()!==input.source_commit||(await git(source,['status','--porcelain=v1','--untracked-files=all'],'isolated-clean')).trim()||existsSync(join(source,'app/src/main/assets/guard-service.json')))fail();
 phase='private_build_setup';
 const assets=join(temporary,'public-assets'),build=join(temporary,'build'),gradleHome=join(temporary,'gradle-home'),androidUser=join(temporary,'android-user');for(const dir of [assets,build,gradleHome,androidUser])mkdirSync(dir,{mode:0o700});
 writeFileSync(join(assets,'guard-service.json'),publicBytes,{mode:0o600});const initFile=join(temporary,'controlled.init.gradle');writeFileSync(initFile,init,{mode:0o600});
 if(input.tools.gradle_cache_directory){if(!lstatSync(input.tools.gradle_cache_directory).isDirectory())fail();symlinkSync(input.tools.gradle_cache_directory,join(gradleHome,'caches'),'dir');}
 const env={...process.env,JAVA_HOME:input.tools.java_home,ANDROID_HOME:input.tools.android_sdk,ANDROID_SDK_ROOT:input.tools.android_sdk,ANDROID_USER_HOME:androidUser,GRADLE_USER_HOME:gradleHome,MERCURY_CONTROLLED_INPUT_FILE:inputFile,MERCURY_CONTROLLED_PUBLIC_ASSETS:assets,MERCURY_CONTROLLED_BUILD_DIRECTORY:build};
 if(!/^(?:openjdk|java) 17\./m.test(await command(join(input.tools.java_home,'bin/java'),['--version'],'java-version',env)))fail();
 if(!(await command(input.tools.gradle,['--version'],'gradle-version',env)).includes('Gradle 8.10.2'))fail();
 const apksigner=join(input.tools.android_sdk,'build-tools/35.0.0/apksigner'),aapt=join(input.tools.android_sdk,'build-tools/35.0.0/aapt');
 async function apkIdentity(filename,label){
  const s=lstatSync(filename);if(!s.isFile()||s.size<1||s.size>200*1024*1024)fail();
  const cert=await command(apksigner,['verify','--verbose','--print-certs',filename],label+'-signature',env),manifest=await command(aapt,['dump','badging',filename],label+'-manifest',env);
  return parseApkIdentity(manifest,cert);
 }
 phase='previous_apk';if(input.previous_apk)assertPreviousApkCompatible(await apkIdentity(input.previous_apk,'previous'),input.expected);
 phase='release_build';
 await command(input.tools.gradle,['--no-daemon','-p',source,'-I',initFile,'-PhttpsTest=false','-PlocalPreview=false',':app:assembleRelease'],'release-build',env,900000);
 const apk=join(build,'app/outputs/apk/release/app-release.apk');
 phase='release_verification';const actual=await apkIdentity(apk,'release');if(Object.keys(input.expected).some(key=>actual[key]!==input.expected[key]))fail();
 const listing=(await command(aapt,['list',apk],'release-entries',env)).split('\n').filter(Boolean);
 if(listing.filter(path=>path==='assets/guard-service.json').length!==1||listing.some(path=>/(?:https_fixture_ca|https_test_network|https-test-issuer|location-test-fixture|https-test-fixture|escalation-test-fixture|tls-location-private)/i.test(path)))fail();
 const embedded=await command('unzip',['-p',apk,'assets/guard-service.json'],'embedded-public-config',env);if(!Buffer.from(embedded).equals(publicBytes))fail();
 if((await git(source,['status','--porcelain=v1','--untracked-files=all'],'source-after-build')).trim())fail();
 const bytes=readFileSync(apk),apkHash=digest(bytes);if(digest(readFileSync(scriptPath))!==tooling.builder_sha256||digest(readFileSync(helperPath))!==tooling.input_validator_sha256)fail();
 const record={version:1,status:input.mode==='synthetic_build_proof'?'synthetic_build_proof_not_operational':'controlled_release_built_activation_unverified',synthetic_only:input.mode==='synthetic_build_proof',operational_acceptance:false,repository,source_commit:input.source_commit,source_clean_before_and_after:true,...actual,apk_sha256:apkHash,apk_bytes:bytes.length,public_configuration_sha256:digest(publicBytes),https_test_assets:false,tooling,previous_apk_checked:input.previous_apk!==null,phone_installation:false,created_at:new Date().toISOString()};
 phase='immutable_output';mkdirSync(input.output_directory,{recursive:false,mode:0o755});outputClaimed=true;
 const name='MercuryOne-Release-v'+actual.version_code+'.apk';copyFileSync(apk,join(input.output_directory,name),constants.COPYFILE_EXCL);chmodSync(join(input.output_directory,name),0o444);
 writeFileSync(join(input.output_directory,'SHA256SUMS.txt'),apkHash+'  '+name+'\n',{flag:'wx',mode:0o444});
 writeFileSync(join(input.output_directory,'BUILD-RECORD.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o444});
 rmSync(temporary,{recursive:true,force:true});temporary=null;
 console.log(JSON.stringify({status:record.status,source_commit:record.source_commit,apk_sha256:apkHash,public_configuration_sha256:record.public_configuration_sha256,signer_sha256:actual.signer_sha256,package:actual.package,version_code:actual.version_code,output_directory:input.output_directory,phone_installation:false}));
}catch{
 // Keep failed private diagnostics for owner review; never publish raw Gradle,
 // signing or credential errors and never overwrite/delete an existing output.
 console.error(JSON.stringify({status:'failed',phase,partial_new_output:outputClaimed,diagnostics:privateLog??'not_created'}));process.exitCode=1;
}
