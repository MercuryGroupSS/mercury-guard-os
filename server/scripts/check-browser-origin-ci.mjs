// Automated browser launches are confined to isolated Linux CI. Local attended
// proof uses --serve and the user's CUA browser, never their normal profile.
import {spawn} from 'node:child_process';
import {accessSync,constants,existsSync,mkdtempSync,chmodSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startBrowserOriginFixture} from './check-browser-origin.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(()=>resolve(false),ms));
async function run(){
 if(process.env.CI!=='true'||process.platform!=='linux')throw Error('ci_only_use_cua_locally');
 const executable='/usr/bin/google-chrome';
 try{accessSync(executable,constants.X_OK);if(!statSync(executable).isFile())throw Error();}catch{throw Error('ci_chrome_unavailable');}
 let fixture,profile,child,childClosed=false,deadline,result,failure,cleanupOkay=true,resolveClosed;
 const closed=new Promise(resolve=>{resolveClosed=resolve;});
 try{
  fixture=await startBrowserOriginFixture();profile=mkdtempSync(join(tmpdir(),'mercury-browser-origin-'));chmodSync(profile,0o700);
  child=spawn(executable,[
   '--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update',
   '--disable-default-apps','--disable-extensions','--disable-sync','--disable-dev-shm-usage','--password-store=basic',
   '--proxy-server=direct://','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
   '--user-data-dir='+profile,fixture.url+'?autorun=1'
  ],{stdio:'ignore',shell:false});
  child.once('error',()=>{childClosed=true;resolveClosed({kind:'browser_start_failed'});});
  child.once('close',()=>{childClosed=true;resolveClosed({kind:'browser_exited'});});
  const timeout=new Promise(resolve=>{deadline=setTimeout(()=>resolve({kind:'browser_deadline'}),30000);});
  const outcome=await Promise.race([fixture.result.then(value=>({kind:'result',value})),closed,timeout]);
  if(outcome.kind!=='result')throw Error(outcome.kind);
  if(outcome.value.status!=='passed'||outcome.value.corrected_canonical_posts!==6||outcome.value.corrected_same_origin_referer!==true)throw Error('browser_checks_failed');
  result=outcome.value;
 }catch(error){failure=['browser_start_failed','browser_exited','browser_deadline','browser_checks_failed'].includes(error.message)?error.message:'browser_fixture_failed';}
 finally{
  clearTimeout(deadline);
  if(child&&!childClosed){child.kill('SIGTERM');if(!await Promise.race([closed.then(()=>true),delay(2000)])){child.kill('SIGKILL');if(!await Promise.race([closed.then(()=>true),delay(5000)]))cleanupOkay=false;}}
  try{await fixture?.close();}catch{cleanupOkay=false;}
  if(profile&&childClosed){try{rmSync(profile,{recursive:true,force:false});if(existsSync(profile))cleanupOkay=false;}catch{cleanupOkay=false;}}
  else if(profile)cleanupOkay=false;
 }
 if(failure||!cleanupOkay){console.error(JSON.stringify({version:1,test:'browser_origin',status:'failed',reason:failure??'cleanup_unconfirmed',fixture_cleanup:cleanupOkay?'confirmed':'unconfirmed',provider_calls:0,real_accounts:0,mail_sent:0}));process.exitCode=1;return;}
 console.log(JSON.stringify({...result,browser:'system_chrome_headless',fixture_cleanup:'confirmed',temporary_browser_profile_removed:true,ios_device:'not_tested'}));
}
await run().catch(error=>{console.error(JSON.stringify({version:1,test:'browser_origin',status:'failed',reason:['ci_only_use_cua_locally','ci_chrome_unavailable'].includes(error.message)?error.message:'browser_fixture_failed',provider_calls:0}));process.exitCode=1;});
