#!/usr/bin/env node
// Owned API35 emulator only: actual Settings enrollment, framework fingerprint,
// visible individual sign-in, real local Auth/PG, and exact secure-state cleanup.
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {openSync,closeSync,existsSync,readFileSync,writeFileSync,mkdirSync,chmodSync,unlinkSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {get} from 'node:https';
import {randomInt,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {connect} from 'node:net';
import {readPrivateBuildFile} from '../controlled-apk-input.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));process.chdir(root);
const adb=process.env.MERCURY_ADB_BIN??'adb',gradle=process.env.MERCURY_GRADLE_BIN??'gradle',aapt=process.env.MERCURY_AAPT_BIN??(process.env.ANDROID_HOME?resolve(process.env.ANDROID_HOME,'build-tools/35.0.0/aapt'):'aapt');
const apkRoot=resolve(process.env.MERCURY_ANDROID_APK_ROOT??'app/build/outputs/apk'),privateDir=new URL('../../.local-backend/signin-android-ci/',import.meta.url),publicDir=new URL('../../app/build/reports/signin-acceptance/',import.meta.url),securityFile=new URL('emulator-security.json',privateDir),ownership=new URL('../../.local-backend/https-signin-android-fixture.json',import.meta.url),ca=new URL('../../app/build/https-test/res/raw/https_fixture_ca.pem',import.meta.url);
mkdirSync(privateDir,{recursive:true,mode:0o700});chmodSync(privateDir,0o700);
const execute=promisify(execFile),abort=new AbortController(),runId=randomUUID(),runDir=new URL(runId+'/',privateDir),runnerFile=new URL('runner-owner.json',privateDir),ownedUiFiles=new Set();let uiSequence=0;mkdirSync(runDir,{mode:0o700});
const result={version:1,run_id:runId,test:'ca.mercury.guard.HttpsSignInIntegrationTest',status:'failed',actual_framework_biometric:'not_verified',individual_accounts:0,fixture_cleanup:'not_started',emulator_security_cleanup:'not_started',started_at:new Date().toISOString()};
let serial,approvedEmulator=false,ownsRunner=false,claimedRunner=false,security,ownsSecurity=false,uiTouched=false,fixture,fixtureResult,fixtureClosed,createdReverse=false,unconfirmedShutdown=false,cleanupOkay=true,failed,phase='initial';
class GateError extends Error{constructor(code){super(code);this.code=code;}}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function assertResourceWindow(){
 for(const name of ['https-signin-android-fixture.json','https-location-android-fixture.json','https-escalation-android-fixture.json'])if(existsSync(new URL('../../.local-backend/'+name,import.meta.url)))throw new GateError('existing_https_fixture_requires_owner_cleanup');
 for(const port of [55443,55444,55446,55450]){const live=await new Promise(resolve=>{const socket=connect({host:'127.0.0.1',port});let done=false;const finish=value=>{if(done)return;done=true;socket.destroy();resolve(value);};socket.setTimeout(500,()=>finish(false));socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));});if(live)throw new GateError('existing_https_listener_requires_owner_coordination');}
}
function privateLog(name,value){const path=new URL(name,runDir);writeFileSync(path,value,{mode:0o600});chmodSync(path,0o600);}
async function command(binary,args,label,{timeout=30000,maxBuffer=32*1024*1024,log=false,cleanup=false}={}){try{const output=await execute(binary,args,{cwd:root,env:process.env,encoding:'utf8',timeout,maxBuffer,...(cleanup?{}:{signal:abort.signal})});if(log)privateLog(label+'.log',output.stdout+'\n'+output.stderr);return output.stdout;}catch(error){if(log)privateLog(label+'.log',(error.stdout??'')+'\n'+(error.stderr??''));throw new GateError(label+'_failed');}}
const device=(args,label,options)=>command(adb,['-s',serial,...args],label,options);
process.once('SIGINT',()=>abort.abort());process.once('SIGTERM',()=>abort.abort());
function fingerprints(text){const json=text.split('\n').find(line=>line.startsWith('{')&&line.includes('"prints"'));if(!json)throw new GateError('fingerprint_inventory_unavailable');return JSON.parse(json).prints.reduce((sum,p)=>sum+p.count,0);}
async function secureState(cleanup=false){const options={cleanup};const lock=await device(['shell','dumpsys','lock_settings'],'lock_state',options),prints=await device(['shell','dumpsys','fingerprint'],'fingerprint_state',options);return {credential:/CredentialType: (\w+)/.exec(lock)?.[1],fingers:fingerprints(prints)};}
function securityRecord(){writeFileSync(securityFile,JSON.stringify(security)+'\n',{mode:0o600});chmodSync(securityFile,0o600);}
function decode(text){return text.replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');}
async function nodes(timeout=30000){
 if(!approvedEmulator||!ownsRunner||!ownsSecurity||!uiTouched)throw new GateError('settings_ui_ownership_required');
 const until=Date.now()+timeout;let reason='dump_not_ready';
 while(Date.now()<until){
  if(abort.signal.aborted)throw new GateError('interrupted');
  // AOSP DumpCommand returns without a file on null-root/idle-timeout paths,
  // sometimes with exit0. A new path and positive completion are both required;
  // an earlier hierarchy can never satisfy a later readiness attempt.
  const path=`/data/local/tmp/mercury-signin-${runId}-${++uiSequence}.xml`;ownedUiFiles.add(path);let current;
  try{
   const completion=await device(['shell','uiautomator','dump',path],'settings_dump',{timeout:Math.max(1,Math.min(15000,until-Date.now())),maxBuffer:8192});
   const written=completion.split(/\r?\n/).some(line=>line===`UI hierchary dumped to: ${path}`||line===`UI hierarchy dumped to: ${path}`);
   if(written&&Date.now()<until){
    const xml=await device(['shell','cat',path],'settings_read',{timeout:Math.max(1,Math.min(5000,until-Date.now())),maxBuffer:256*1024});
    if(/^<\?xml[^>]*\?>\s*<hierarchy\b[^>]*>[\s\S]*<\/hierarchy>\s*$/.test(xml)&&!/<!(?:DOCTYPE|ENTITY)\b/i.test(xml)){
     const parsed=[...xml.matchAll(/<node\b([^>]*?)\/?\s*>/g)].map(match=>Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(a=>[a[1],decode(a[2])])));
     if(parsed.length>0&&parsed.some(n=>n.package==='com.android.settings'))current=parsed;else reason='settings_window_not_ready';
    }else reason='hierarchy_not_complete';
   }else reason='dump_not_ready';
  }catch(error){
   if(!(error instanceof GateError)||!['settings_dump_failed','settings_read_failed'].includes(error.code))throw error;
   reason=error.code==='settings_read_failed'?'fresh_file_not_ready':'dump_not_ready';
  }finally{
   // XML stays in memory only and the exact temporary device file is removed
   // before returning nodes or trying again. Never persist raw UI diagnostics.
   try{await device(['shell','rm','-f',path],'owned_ui_dump_remove',{timeout:5000,cleanup:true});ownedUiFiles.delete(path);}catch{cleanupOkay=false;throw new GateError('owned_ui_dump_cleanup_unconfirmed');}
  }
  if(current)return current;
  result.ui_readiness_retries=(result.ui_readiness_retries??0)+1;
  if(abort.signal.aborted)throw new GateError('interrupted');await pause(Math.min(200,Math.max(0,until-Date.now())));
 }
 result.ui_readiness_last_reason=reason;throw new GateError('settings_ui_readiness_timeout');
}
async function waitNode(predicate,label,timeout=30000){const until=Date.now()+timeout;while(Date.now()<until){if(abort.signal.aborted)throw new GateError('interrupted');const found=(await nodes(Math.max(1,until-Date.now()))).filter(predicate);if(found.length===1)return found[0];await pause(200);}throw new GateError(label+'_not_found');}
async function tapNode(node,label){const b=/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(node.bounds??'')?.slice(1).map(Number);if(!b||b[2]<=b[0]||b[3]<=b[1]||node.enabled!=='true')throw new GateError(label+'_not_reachable');await device(['shell','input','tap',String(Math.floor((b[0]+b[2])/2)),String(Math.floor((b[1]+b[3])/2))],label);}
const textNode=value=>n=>n.package==='com.android.settings'&&n.text?.toUpperCase()===value&&n.enabled==='true';
async function tapText(value){await tapNode(await waitNode(textNode(value),'settings_'+value),'settings_action');}
async function enroll(){
 const state=await secureState();
 if(existsSync(securityFile))throw new GateError('existing_security_record_requires_owner_recovery');
 if(state.credential!=='NONE'||state.fingers!==0)throw new GateError('fresh_unsecured_unenrolled_emulator_required');
 security={version:1,serial,original_credential:'NONE',original_fingerprints:0,pin:String(randomInt(100000,1000000)),finger_id:31,state:'baseline_verified'};writeFileSync(securityFile,JSON.stringify(security)+'\n',{mode:0o600,flag:'wx'});ownsSecurity=true;result.emulator_security_cleanup='pending';
 // Fingerprint-only Settings enrollment avoids continuing a leftover optional
 // face-enrollment wizard after the owned PIN/fingerprint have been removed.
 uiTouched=true;await device(['shell','am','start','-a','android.settings.FINGERPRINT_ENROLL','-f','0x10008000'],'settings_enrollment_start');
 await tapNode(await waitNode(n=>n['resource-id']==='com.android.settings:id/lock_pin','pin_option'),'pin_option');
 const entry=await waitNode(n=>n['resource-id']==='com.android.settings:id/password_entry','pin_entry');await tapNode(entry,'pin_focus');await device(['shell','input','text',security.pin],'synthetic_pin_entry');security.state='pin_entry_in_progress';securityRecord();await tapText('NEXT');
 await waitNode(n=>n.text==='Re-enter your PIN','pin_confirm');await device(['shell','input','text',security.pin],'synthetic_pin_confirm');await tapText('CONFIRM');security.state='pin_confirmed';securityRecord();
 await waitNode(n=>n.text==='Lock screen','lock_screen_notice');await tapText('DONE');
 // API35 Google APIs image uses an explicit multipage Pixel Imprint notice.
 for(let i=0;i<8;i++){const current=await nodes();const agree=current.find(textNode('I AGREE'));if(agree){await tapNode(agree,'enrollment_consent');break;}const more=current.find(textNode('MORE'));if(!more)throw new GateError('fingerprint_notice_unexpected');await tapNode(more,'fingerprint_notice_more');if(i===7)throw new GateError('fingerprint_notice_unbounded');}
 await waitNode(n=>n.text==='Touch the sensor','sensor_enrollment');security.state='fingerprint_enrollment_started';securityRecord();
 for(let i=0;i<20;i++){await device(['emu','finger','touch','31'],'enrollment_touch');await pause(200);await device(['emu','finger','remove'],'enrollment_remove');await pause(200);if((await nodes()).some(n=>n.text==='Fingerprint added'))break;if(i===19)throw new GateError('fingerprint_enrollment_incomplete');}
 await tapText('DONE');const enrolled=await secureState();if(enrolled.credential!=='PIN'||enrolled.fingers!==1)throw new GateError('framework_enrollment_unverified');security.state='enrolled';securityRecord();
}
async function health(){if(!existsSync(ca))return false;return new Promise(resolve=>{const req=get({hostname:'localhost',port:55450,path:'/test/health',ca:readFileSync(ca),timeout:2000},res=>{let text='';res.on('data',chunk=>{text+=chunk;if(text.length>512)req.destroy(Error('Bounded response'));});res.on('end',()=>{try{resolve(res.statusCode===200&&JSON.parse(text).fixture_type==='real_pg_auth_signin');}catch{resolve(false);}});});req.on('timeout',()=>req.destroy(Error('Health timeout')));req.on('error',()=>resolve(false));});}
async function startFixture(){
 if(existsSync(ownership))throw new GateError('existing_fixture_requires_owner_cleanup');const file=new URL('fixture.log',runDir),fd=openSync(file,'w',0o600);chmodSync(file,0o600);
 try{fixture=spawn(process.execPath,['server/scripts/https-signin-android-fixture.mjs'],{cwd:root,env:{...process.env,MERCURY_HTTPS_SIGNIN_FIXTURE:'synthetic-only'},stdio:['ignore',fd,fd]});}finally{closeSync(fd);}
 fixtureClosed=new Promise(resolve=>{fixture.once('error',()=>resolve(fixtureResult={spawn_error:true}));fixture.once('close',(code,signal)=>resolve(fixtureResult={code,signal}));});result.fixture_cleanup='pending';
 const until=Date.now()+90000;while(Date.now()<until){if(abort.signal.aborted)throw new GateError('interrupted');if(fixtureResult)throw new GateError('fixture_start_failed');let own=false;try{own=JSON.parse(readPrivateBuildFile(ownership.pathname,8192)).pid===fixture.pid;}catch{}if(own&&await health())return;await pause(300);}throw new GateError('fixture_ready_timeout');
}
function parseSafeFailureFacts(output){
 const values=output.split(/\r?\n/).filter(line=>line.startsWith('INSTRUMENTATION_RESULT: mercury_signin_failure_facts='));
 if(!values.length)return {state:'absent'};
 const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&JSON.stringify(Object.keys(value).sort())===JSON.stringify([...keys].sort());
 try{
  if(values.length!==1||values[0].length>8192)throw Error();const value=JSON.parse(values[0].slice('INSTRUMENTATION_RESULT: mercury_signin_failure_facts='.length));
  if(value.version!==1||typeof value.available!=='boolean')throw Error();
  if(value.available===false){if(!exact(value,['version','available']))throw Error();return {state:'accepted',facts:{version:1,available:false}};}
  const stages=['PRE_ON_CREATE','CREATED','STARTED','RESUMED','PAUSED','STOPPED','RESTARTED','DESTROYED'],types=['ACCOUNT','LAUNCHER','DEMO','OTHER'];
  if(!exact(value,['version','available','lifecycle','root_active_package','view_flags','keyguard_locked','device_locked','interactive'])||!exact(value.lifecycle,stages)||!exact(value.view_flags,['GUARD_SIGN_IN','credentials','assignments']))throw Error();
  if(!['target','systemui','settings','launcher','other'].includes(value.root_active_package)||!['keyguard_locked','device_locked','interactive'].every(key=>typeof value[key]==='boolean')||!Object.values(value.view_flags).every(flag=>typeof flag==='boolean'))throw Error();
  const lifecycle={};for(const stage of stages){const entry=value.lifecycle[stage];if(!exact(entry,['count','types'])||!Number.isInteger(entry.count)||entry.count<0||entry.count>64||!Array.isArray(entry.types)||entry.types.length>4||new Set(entry.types).size!==entry.types.length||!entry.types.every(type=>types.includes(type)))throw Error();lifecycle[stage]={count:entry.count,types:[...entry.types]};}
  return {state:'accepted',facts:{version:1,available:true,lifecycle,root_active_package:value.root_active_package,view_flags:{GUARD_SIGN_IN:value.view_flags.GUARD_SIGN_IN,credentials:value.view_flags.credentials,assignments:value.view_flags.assignments},keyguard_locked:value.keyguard_locked,device_locked:value.device_locked,interactive:value.interactive}};
 }catch{return {state:'rejected'};}
}
async function instrument(){
 let ended=false,output,executionError,pollError;const running=execute(adb,['-s',serial,'shell','am','instrument','-w','-r','-e','signinIntegration','true','-e','class','ca.mercury.guard.HttpsSignInIntegrationTest','ca.mercury.guard.httpstest.test/androidx.test.runner.AndroidJUnitRunner'],{cwd:root,env:process.env,encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024,signal:abort.signal});const task=running.then(value=>{output=value.stdout;},()=>{executionError=true;}).finally(()=>{ended=true;});
 const handled=new Set(),expectedSteps=['unknown_finger','valid_finger_a','reopen_launcher','valid_finger_b'],fingers=new Map([['unknown_finger','32'],['valid_finger_a','31'],['valid_finger_b','31']]),reopen={started:false,completed:false,status_ok:false,amstart_elapsed_ms:0,ack_written:false};
 const recordFailureFacts=()=>{result.host_failure_facts={reopen:{...reopen},handled_steps:[...handled]};const parsed=parseSafeFailureFacts(output??'');result.instrumentation_failure_facts_state=parsed.state;if(parsed.facts)result.instrumentation_failure_facts=parsed.facts;};
 try{while(!ended){
   let step;try{step=(await device(['shell','run-as','ca.mercury.guard.httpstest','cat','files/signin-test-step'],'sensor_step',{timeout:5000})).trim();}catch{}
   if(step&&!handled.has(step)){
    if(step!==expectedSteps[handled.size])throw new GateError('unexpected_host_request');
    if(step==='reopen_launcher'){
     // The APK and PackageManager-verified real launcher only. This models a
     // user reopening the app; it never starts the private account Activity,
     // clears state, injects a session or substitutes for the next biometric.
     // Acknowledge the accepted asynchronous user launch request, not window
     // drawing/finish accounting. Kotlin independently asserts resume+relock.
     reopen.started=true;const started=performance.now();let response;
     try{response=await device(['shell','am','start','-a','android.intent.action.MAIN','-c','android.intent.category.LAUNCHER','-n','ca.mercury.guard.httpstest/ca.mercury.guard.LauncherActivity'],'actual_launcher_reopen');reopen.completed=true;}finally{reopen.amstart_elapsed_ms=Math.min(60000,Math.max(0,Math.round(performance.now()-started)));}
     reopen.status_ok=/^Starting: Intent \{[^\r\n]*cmp=ca\.mercury\.guard\.httpstest\/ca\.mercury\.guard\.LauncherActivity(?:\s|\})/m.test(response)&&!/(?:^|\n)\s*(?:Error\b|Exception\b)|java\.lang\./i.test(response);
     if(!reopen.status_ok)throw new GateError('launcher_request_rejected');
    }else{
     await device(['emu','finger','touch',fingers.get(step)],'framework_finger_touch');await pause(150);await device(['emu','finger','remove'],'framework_finger_remove');
    }
    await device(['shell','run-as','ca.mercury.guard.httpstest','touch','files/signin-test-ack-'+step],'sensor_ack');if(step==='reopen_launcher')reopen.ack_written=true;handled.add(step);
   }
   await pause(100);
  }}catch(error){pollError=error;}
 finally{
  if(!ended){try{await device(['shell','am','force-stop','ca.mercury.guard.httpstest'],'failed_instrumentation_stop',{cleanup:true});}catch{unconfirmedShutdown=true;pollError=new GateError('instrumentation_stop_unconfirmed');}running.child?.kill('SIGTERM');await Promise.race([task,pause(10000)]);if(!ended){unconfirmedShutdown=true;pollError=new GateError('instrumentation_child_unconfirmed');}}
  else await task;
 }
 if(pollError){recordFailureFacts();throw pollError;}
 // Never persist raw UI/instrumentation errors: Espresso can include entered
 // credentials in its hierarchy diagnostics. Only fixed acceptance fields leave memory.
 if(executionError||!output||!/OK \(1 test\)/.test(output)||/INSTRUMENTATION_STATUS_CODE: -\d|FAILURES!!!|INSTRUMENTATION_FAILED|INSTRUMENTATION_ABORTED|Process crashed/.test(output)){
  recordFailureFacts();const stage=/failed at bounded stage: ([a-z_]+)/.exec(output??'')?.[1],type=/failure_type=([A-Za-z]+)/.exec(output??'')?.[1];
  const stages=['initial','first_use_launcher','biometric_button','biometric_prompt_initial','biometric_cancel_control','biometric_cancel_result','unknown_fingerprint','strong_fingerprint_a','company_vendor_denied','guard_a_login','background_exit','background_reopen_ack','background_wait_account','background_wait_locked_form','background_field_lock','guard_switch_biometric','guard_b_login','explicit_signout','logout_server_confirmation','service_read_counts'];
  if(stages.includes(stage))result.failed_stage=stage;if(type)result.failure_type=['AssertionError','IllegalStateException','IllegalArgumentException','RuntimeException','NoMatchingViewException','PerformException','AmbiguousViewMatcherException','IOException','SocketTimeoutException'].includes(type)?type:'Other';throw new GateError('actual_signin_instrumentation_failed');
 }
 const marker=output.split('\n').find(line=>line.includes('SIGNIN_ACCEPTANCE actual_launcher=true actual_platform_strong_biometric=true'));
 if(!marker||JSON.stringify([...handled])!==JSON.stringify(expectedSteps))throw new GateError('actual_signin_evidence_missing');result.actual_framework_biometric='verified_emulator';result.individual_accounts=2;result.tests_passed=1;privateLog('instrumentation-summary.json',JSON.stringify({status:'passed',tests:1,host_steps:[...handled],raw_ui_output_retained:false})+'\n');
}
async function cleanup(){
 if(approvedEmulator&&fixture)try{await device(['shell','am','force-stop','ca.mercury.guard.httpstest'],'test_package_stop',{cleanup:true});}catch{cleanupOkay=false;unconfirmedShutdown=true;failed??='test_package_stop_unconfirmed';}
 if(fixture){if(!fixtureResult)fixture.kill('SIGTERM');const closed=await Promise.race([fixtureClosed,new Promise(resolve=>{const timer=setTimeout(()=>resolve(null),120000);timer.unref();})]);const log=readFileSync(new URL('fixture.log',runDir),'utf8');if(closed?.code===0&&!existsSync(ownership)&&log.includes('PASS: exact HTTPS sign-in company/guards/assignments/device/challenges, Auth users/sessions and test assets cleaned; global limiter retained.'))result.fixture_cleanup='confirmed';else{result.fixture_cleanup='unconfirmed';failed='fixture_cleanup_unconfirmed';fixture.unref();}}
 if(approvedEmulator&&createdReverse)try{await device(['reverse','--remove','tcp:55450'],'owned_reverse_remove',{cleanup:true});}catch{cleanupOkay=false;failed??='owned_reverse_cleanup_unconfirmed';}
 if(approvedEmulator&&ownsSecurity){
  try{const current=await secureState(true);if(current.fingers>1||!['NONE','PIN'].includes(current.credential))throw new GateError('security_ownership_changed');
   if(current.credential==='PIN'){if(!(await device(['shell','locksettings','verify','--old',security.pin],'cleanup_owned_pin_verify',{cleanup:true})).includes('Lock credential verified successfully'))throw new GateError('cleanup_owned_pin_verification_failed');await device(['shell','locksettings','clear','--old',security.pin],'cleanup_owned_pin_clear',{cleanup:true});}
   const until=Date.now()+10000;let clean;do{clean=await secureState(true);if(clean.credential==='NONE'&&clean.fingers===0)break;await pause(200);}while(Date.now()<until);
   if(clean.credential!=='NONE'||clean.fingers!==0)throw new GateError('original_security_state_unconfirmed');unlinkSync(securityFile);result.emulator_security_cleanup='confirmed_none_pin_zero_fingerprints';
  }catch{cleanupOkay=false;result.emulator_security_cleanup='unconfirmed_ownership_retained';failed='emulator_security_cleanup_unconfirmed';}
 }
 if(approvedEmulator&&(ownsSecurity||uiTouched))for(const path of [...ownedUiFiles])try{await device(['shell','rm','-f',path],'owned_ui_dump_remove',{cleanup:true});ownedUiFiles.delete(path);}catch{cleanupOkay=false;failed??='owned_ui_dump_cleanup_unconfirmed';}
 if(ownsRunner){
  if(cleanupOkay&&!unconfirmedShutdown&&(!fixture||result.fixture_cleanup==='confirmed')&&(!ownsSecurity||result.emulator_security_cleanup==='confirmed_none_pin_zero_fingerprints')){const saved=JSON.parse(readPrivateBuildFile(runnerFile.pathname,4096));if(saved.pid!==process.pid||saved.run!==runId||saved.serial!==serial)throw new GateError('runner_ownership_changed');unlinkSync(runnerFile);ownsRunner=false;}
  else result.runner_ownership='retained_for_recovery';
 }
}
try{
 serial=process.env.MERCURY_ANDROID_SERIAL;if(!serial){if(process.env.CI!=='true')throw new GateError('explicit_emulator_serial_required');const devices=await command(adb,['devices'],'emulator_inventory'),matches=devices.split('\n').map(l=>l.trim().split(/\s+/)).filter(([id,state])=>/^emulator-\d+$/.test(id)&&state==='device');if(matches.length!==1)throw new GateError('one_ci_emulator_required');serial=matches[0][0];}
 if(!/^emulator-\d+$/.test(serial)||process.env.CI!=='true'&&serial!=='emulator-5568')throw new GateError('owned_emulator_serial_required');if((await device(['shell','getprop','ro.kernel.qemu'],'emulator_identity')).trim()!=='1')throw new GateError('qemu_required');if((await device(['shell','getprop','ro.build.version.sdk'],'emulator_sdk')).trim()!=='35')throw new GateError('api35_required');approvedEmulator=true;result.emulator=serial;
 try{writeFileSync(runnerFile,JSON.stringify({version:1,pid:process.pid,run:runId,serial})+'\n',{mode:0o600,flag:'wx'});ownsRunner=true;claimedRunner=true;}catch{throw new GateError('existing_runner_requires_owner_recovery');}
 await assertResourceWindow();
 phase='actual_settings_enrollment';await enroll();
 phase='real_auth_fixture';await startFixture();
 phase='debug_only_build';const build=['--no-daemon',...(process.env.MERCURY_GRADLE_INIT_SCRIPT?['-I',process.env.MERCURY_GRADLE_INIT_SCRIPT]:[]),...(process.env.MERCURY_LOCAL_DEBUG_KEYSTORE?['-PlocalDebugKeystore='+process.env.MERCURY_LOCAL_DEBUG_KEYSTORE]:[]),'-Pkotlin.compiler.execution.strategy=in-process','-PhttpsTest=true',':app:assembleDebug',':app:assembleDebugAndroidTest'];await command(gradle,build,'https_test_build',{timeout:600000,log:true});
 const app=resolve(apkRoot,'debug/app-debug.apk'),test=resolve(apkRoot,'androidTest/debug/app-debug-androidTest.apk');for(const [path,pkg] of [[app,'ca.mercury.guard.httpstest'],[test,'ca.mercury.guard.httpstest.test']]){const badging=await command(aapt,['dump','badging',path],'owned_apk_identity');if(!badging.startsWith(`package: name='${pkg}' `))throw new GateError('unexpected_built_apk_package');if(pkg==='ca.mercury.guard.httpstest'&&!badging.split(/\r?\n/).some(line=>line.startsWith("launchable-activity: name='ca.mercury.guard.LauncherActivity' ")))throw new GateError('unexpected_built_apk_launcher');}
 const reverses=await device(['reverse','--list'],'reverse_inventory'),existing=reverses.split('\n').map(l=>l.trim().split(/\s+/)).filter(p=>p.at(-2)==='tcp:55450');if(existing.length&&existing.some(p=>p.at(-1)!=='tcp:55450'))throw new GateError('conflicting_reverse_mapping');if(!existing.length){await device(['reverse','tcp:55450','tcp:55450'],'reverse_create');createdReverse=true;}
 await device(['install','-r','-t',app],'owned_test_install',{timeout:90000});await device(['install','-r','-t',test],'owned_runner_install',{timeout:90000});await device(['shell','pm','clear','ca.mercury.guard.httpstest'],'fresh_owned_test_install');
 phase='actual_visible_signin';console.log('Testing actual framework biometric and two individual guard sign-ins on the owned API35 emulator; raw credential UI output is withheld.');await instrument();result.status='passed';
}catch(error){failed=error instanceof GateError?error.code:'runner_failed';result.failed_phase=phase;}
finally{try{await cleanup();}catch{failed='cleanup_unconfirmed';result.fixture_cleanup='unconfirmed';fixture?.unref();}if(failed){result.status='failed';result.error=failed;}result.finished_at=new Date().toISOString();privateLog('result.json',JSON.stringify(result,null,2)+'\n');if(claimedRunner){mkdirSync(publicDir,{recursive:true});writeFileSync(new URL('result.json',publicDir),JSON.stringify(result,null,2)+'\n');}console.log(JSON.stringify(result));if(failed)process.exitCode=1;}
