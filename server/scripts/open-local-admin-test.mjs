// Attended browser test fixture. Local only; SIGINT/SIGTERM removes its own rows.
import {Client} from 'pg';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {openLocalGuardDirectory} from '../local-directory-factory.mjs';
import {openLocalAssignmentStore} from '../local-assignment-factory.mjs';
import {PostgresAdministration} from '../postgres-administration.mjs';
import {createAdminAuthAccountReader} from '../admin-auth-account.mjs';
import {createLocalService} from '../local-service.mjs';
const root=new URL('../../',import.meta.url),config=JSON.parse(readFileSync(new URL('supabase-start.log',root),'utf8').split('\n').findLast(l=>l.startsWith('{')&&l.includes('API_URL'))),dbUrl=new URL(config.DB_URL);
if(config.API_URL!=='http://127.0.0.1:55321'||dbUrl.hostname!=='127.0.0.1'||dbUrl.port!=='55322')throw Error('Isolated local environment required');
const run='console-test-'+randomUUID(),email=run+'@example.invalid',password=randomBytes(32).toString('base64url'),vendorId=run+'-company',guardId=run+'-guard';
const owner=new Client({connectionString:config.DB_URL}),headers={apikey:config.SERVICE_ROLE_KEY,authorization:'Bearer '+config.SERVICE_ROLE_KEY,'content-type':'application/json'},file=new URL('.local-backend/admin-console-test.json',root);
if(existsSync(file))throw Error('A console fixture already owns the private test file. Stop that fixture first.');
let subject,directory,service,closing=false,ownsFile=false;
async function cleanup(){if(closing)return;closing=true;try{if(service)await service.stop();if(directory)await directory.close();
 if(subject){await owner.query('DELETE FROM mercury_guard.admin_audit WHERE actor_subject=$1',[subject]);await owner.query('DELETE FROM mercury_guard.admin_accounts WHERE auth_subject=$1',[subject]);await owner.query('DELETE FROM mercury_guard.guard_login WHERE guard_id=$1',[guardId]);await owner.query('DELETE FROM mercury_guard.guards WHERE guard_id=$1 AND auth_subject=$2',[guardId,subject]);await owner.query('DELETE FROM mercury_guard.vendors WHERE vendor_id=$1',[vendorId]);await owner.query('DELETE FROM mercury_guard.login_attempts WHERE bucket=$1',['account:'+createHash('sha256').update('admin-login:'+email).digest('hex')]);const r=await fetch(config.API_URL+'/auth/v1/admin/users/'+subject,{method:'DELETE',headers});if(!r.ok)throw Error('Temporary account cleanup failed');}
 if(ownsFile)rmSync(file,{force:true});console.log('Temporary console account, audit and fixture rows removed.');
 }finally{await owner.end();}}
await owner.connect();
try{
 const result=await fetch(config.API_URL+'/auth/v1/admin/users',{method:'POST',headers,body:JSON.stringify({email,password,email_confirm:true})});if(!result.ok)throw Error('Temporary Auth account unavailable');subject=(await result.json()).id;if(!subject)throw Error('Account ID unavailable');
 await owner.query('INSERT INTO mercury_guard.admin_accounts(auth_subject,email,active) VALUES($1,$2,true)',[subject,email]);directory=await openLocalGuardDirectory({config,mode:'postgres'});const {devices}=await openLocalAssignmentStore({mode:'postgres',directory});
 const admin=new PostgresAdministration({devices,loadAuthAccount:createAdminAuthAccountReader({url:config.API_URL,serverKey:config.SERVICE_ROLE_KEY,allowLocal:true})});
 service=createLocalService({config,store:{ingest:async()=>{throw Error('Admin-only test fixture');}},admin});const origin=await service.start();mkdirSync(new URL('.local-backend/',root),{recursive:true,mode:0o700});writeFileSync(file,JSON.stringify({origin,email,password,subject,vendorId,guardId})+'\n',{mode:0o600,flag:'wx'});ownsFile=true;
 console.log('Local console browser fixture: '+origin+'/admin/');console.log('Temporary sign-in is in the private .local-backend/admin-console-test.json file. Stop this process to clean up.');
 process.on('SIGINT',()=>cleanup().then(()=>process.exit(0),()=>process.exit(1)));process.on('SIGTERM',()=>cleanup().then(()=>process.exit(0),()=>process.exit(1)));
}catch(error){await cleanup();throw error;}
