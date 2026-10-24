#!/usr/bin/env node
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {openSync,closeSync,existsSync,readFileSync,writeFileSync,mkdirSync,chmodSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {get} from 'node:https';
import {resolve} from 'node:path';

// Existing isolated local stack only. CI owns stack start/stop in the workflow.
// No connected-device Gradle task or unfiltered adb mutation is used here.
const root=fileURLToPath(new URL('../../',import.meta.url));
process.chdir(root);
const adb=process.env.MERCURY_ADB_BIN??'adb',gradle=process.env.MERCURY_GRADLE_BIN??'gradle';
// Optional local toolchain paths preserve the handed-off emulator's test signing
// key/output directory. CI uses the ordinary pinned Gradle/debug build defaults.
const apkRoot=resolve(process.env.MERCURY_ANDROID_APK_ROOT??'app/build/outputs/apk');
const buildArgs=['--no-daemon',...(process.env.MERCURY_GRADLE_INIT_SCRIPT?['-I',process.env.MERCURY_GRADLE_INIT_SCRIPT]:[]),...(process.env.MERCURY_LOCAL_DEBUG_KEYSTORE?['-PlocalDebugKeystore='+process.env.MERCURY_LOCAL_DEBUG_KEYSTORE]:[]),'-PhttpsTest=true',':app:assembleDebug',':app:assembleDebugAndroidTest'];
const privateDir=new URL('../../.local-backend/location-android-ci/',import.meta.url);
const publicDir=new URL('../../app/build/reports/location-acceptance/',import.meta.url);
const ownership=new URL('../../.local-backend/https-location-android-fixture.json',import.meta.url);
const ca=new URL('../../app/build/https-test/res/raw/https_fixture_ca.pem',import.meta.url);
mkdirSync(privateDir,{recursive:true,mode:0o700});chmodSync(privateDir,0o700);
const execute=promisify(execFile),abort=new AbortController();
const result={version:1,test:'ca.mercury.guard.HttpsLocationIntegrationTest',mode:'explicit_typed_synthetic_0_0',sdk_gnss:'unverified',required_gps_checkpoint_transport:'not_verified',status:'failed',fixture_cleanup:'not_started',started_at:new Date().toISOString()};
let fixture,fixtureResult,fixtureClosed,createdReverse=false,serial,failed;
class GateError extends Error{constructor(code){super(code);this.code=code;}}
function privateLog(name,text){const path=new URL(name,privateDir);writeFileSync(path,text,{mode:0o600});chmodSync(path,0o600);}
async function command(binary,args,label,timeout=30000){
 try{const output=await execute(binary,args,{cwd:root,env:process.env,encoding:'utf8',timeout,maxBuffer:32*1024*1024,signal:abort.signal});privateLog(label+'.log',output.stdout+'\n'+output.stderr);return output.stdout;}
 catch(error){privateLog(label+'.log',(error.stdout??'')+'\n'+(error.stderr??''));throw new GateError(label+'_failed');}
}
const device=(args,label,timeout)=>command(adb,['-s',serial,...args],label,timeout);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function interrupt(){abort.abort();}
process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
async function health(){
 if(!existsSync(ca))return false;
 return new Promise(resolve=>{
  const req=get({hostname:'localhost',port:55446,path:'/test/health',ca:readFileSync(ca),timeout:2000},res=>{
   let text='';res.on('data',chunk=>{text+=chunk;if(text.length>512)req.destroy(Error('Bounded health response required'));});
   res.on('end',()=>{try{resolve(res.statusCode===200&&JSON.parse(text).fixture_type==='real_pg_auth_location');}catch{resolve(false);}});
  });req.on('timeout',()=>req.destroy(Error('Health timeout')));req.on('error',()=>resolve(false));
 });
}
async function startFixture(){
 if(existsSync(ownership))throw new GateError('existing_fixture_requires_owner_cleanup');
 const log=new URL('fixture.log',privateDir),fd=openSync(log,'w',0o600);chmodSync(log,0o600);
 try{fixture=spawn(process.execPath,['server/scripts/https-location-android-fixture.mjs'],{cwd:root,env:{...process.env,MERCURY_HTTPS_LOCATION_FIXTURE:'synthetic-only'},stdio:['ignore',fd,fd]});}finally{closeSync(fd);}
 fixtureClosed=new Promise(resolve=>{fixture.once('error',()=>resolve(fixtureResult={spawn_error:true}));fixture.once('close',(code,signal)=>resolve(fixtureResult={code,signal}));});
 result.fixture_cleanup='pending';
 const until=Date.now()+90000;
 while(Date.now()<until){
  if(abort.signal.aborted)throw new GateError('interrupted');
  if(fixtureResult)throw new GateError('fixture_start_failed');
  let own=false;try{own=JSON.parse(readFileSync(ownership,'utf8')).pid===fixture.pid;}catch{}
  if(own&&await health())return;
  await pause(300);
 }
 throw new GateError('fixture_ready_timeout');
}
async function cleanup(){
 // am instrument has its own finally; force-stop only our dedicated test package
 // before draining the exact fixture, including on an interrupted test process.
 if(serial&&fixture)try{await execute(adb,['-s',serial,'shell','am','force-stop','ca.mercury.guard.httpstest'],{timeout:15000,maxBuffer:1024*1024});}catch{failed??='test_package_stop_unconfirmed';}
 if(fixture){
  if(!fixtureResult)fixture.kill('SIGTERM');
  const closed=await Promise.race([fixtureClosed,new Promise(resolve=>{const timer=setTimeout(()=>resolve(null),120000);timer.unref();})]);
  const text=readFileSync(new URL('fixture.log',privateDir),'utf8');
  if(closed?.code===0&&!existsSync(ownership)&&text.includes('PASS: exact HTTPS location consent/grant/observation/shift rows, Auth users/sessions and test assets cleaned; global limiter retained.'))result.fixture_cleanup='confirmed';
  else{result.fixture_cleanup='unconfirmed';failed='fixture_cleanup_unconfirmed';fixture.unref();}
 }
 if(createdReverse)try{await execute(adb,['-s',serial,'reverse','--remove','tcp:55446'],{timeout:15000,maxBuffer:1024*1024});}catch{failed??='owned_reverse_cleanup_unconfirmed';}
}
try{
 serial=process.env.MERCURY_ANDROID_SERIAL;
 if(!serial){
  if(process.env.CI!=='true')throw new GateError('explicit_emulator_serial_required');
  const inventory=await command(adb,['devices'],'emulator_inventory');
  const candidates=inventory.split('\n').map(line=>line.trim().split(/\s+/)).filter(([id,state])=>/^emulator-\d+$/.test(id)&&state==='device');
  if(candidates.length!==1)throw new GateError('exactly_one_ci_emulator_required');
  serial=candidates[0][0];
 }
 if(!/^emulator-\d+$/.test(serial))throw new GateError('emulator_serial_required');
 if((await device(['shell','getprop','ro.kernel.qemu'],'emulator_identity')).trim()!=='1')throw new GateError('emulator_identity_required');
 if((await device(['shell','getprop','ro.build.version.sdk'],'emulator_sdk')).trim()!=='35')throw new GateError('api35_emulator_required');
 result.emulator=serial;
 // Do not override or later remove somebody else's reverse mapping.
 const reverses=await device(['reverse','--list'],'reverse_inventory');
 const existing=reverses.split('\n').map(line=>line.trim().split(/\s+/)).filter(parts=>parts.at(-2)==='tcp:55446');
 if(existing.length&&existing.some(parts=>parts.at(-1)!=='tcp:55446'))throw new GateError('conflicting_reverse_mapping');
 await startFixture();
 await command(gradle,buildArgs,'https_test_build',600000);
 if(!existing.length){await device(['reverse','tcp:55446','tcp:55446'],'reverse_create');createdReverse=true;}
 await device(['install','-r','-t',resolve(apkRoot,'debug/app-debug.apk')],'test_app_install',90000);
 await device(['install','-r','-t',resolve(apkRoot,'androidTest/debug/app-debug-androidTest.apk')],'test_runner_install',90000);
 for(const permission of ['ACCESS_FINE_LOCATION','ACCESS_COARSE_LOCATION','POST_NOTIFICATIONS'])await device(['shell','pm','grant','ca.mercury.guard.httpstest','android.permission.'+permission],'grant_'+permission);
 await device(['shell','cmd','location','set-location-enabled','true'],'emulator_location_setting');
 console.log('Running explicit typed synthetic 0,0 location acceptance on one emulator; SDK GNSS remains unverified.');
 const output=await device(['shell','am','instrument','-w','-r','-e','locationIntegration','true','-e','locationTypedFixture','true','-e','class','ca.mercury.guard.HttpsLocationIntegrationTest','ca.mercury.guard.httpstest.test/androidx.test.runner.AndroidJUnitRunner'],'instrumentation',180000);
 if(!/OK \(1 test\)/.test(output)||/INSTRUMENTATION_STATUS_CODE: -\d|FAILURES!!!|INSTRUMENTATION_FAILED|INSTRUMENTATION_ABORTED|Process crashed/.test(output))throw new GateError('instrumentation_did_not_pass_one_test');
 if(!/INSTRUMENTATION_RESULT: required_gps_checkpoint_transport=verified_synthetic_0_0/.test(output))throw new GateError('required_gps_checkpoint_transport_unverified');
 result.required_gps_checkpoint_transport='verified_synthetic_0_0';result.tests_passed=1;result.status='passed';
}catch(error){failed=error instanceof GateError?error.code:'runner_failed';}
finally{
 try{await cleanup();}catch{failed='fixture_cleanup_unconfirmed';result.fixture_cleanup='unconfirmed';fixture?.unref();}
 if(failed){result.status='failed';result.error=failed;}
 result.finished_at=new Date().toISOString();
 mkdirSync(publicDir,{recursive:true});writeFileSync(new URL('result.json',publicDir),JSON.stringify(result,null,2)+'\n');
 // Raw provider/fixture/build output stays in ignored mode-600 private files.
 console.log(JSON.stringify(result));
 if(failed)process.exitCode=1;
}
