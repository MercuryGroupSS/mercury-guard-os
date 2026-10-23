import {Client} from 'pg';
import {readFileSync} from 'node:fs';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {openLocalGuardDirectory} from '../local-directory-factory.mjs';
import {createLocalService} from '../local-service.mjs';
import {DurableIngest} from '../durable-ingest.mjs';
const lines=readFileSync(new URL('../../supabase-start.log',import.meta.url),'utf8').split('\n');
const config=JSON.parse(lines.findLast(l=>l.startsWith('{')&&l.includes('API_URL'))),url=new URL(config.DB_URL);
if(config.API_URL!=='http://127.0.0.1:55321'||!['127.0.0.1','localhost'].includes(url.hostname)||url.port!=='55322')throw Error('Local environment required');
const admin=new Client({connectionString:config.DB_URL}),vendor='smoke-'+randomUUID(),guard='smoke-'+randomUUID();
const authHeaders={apikey:config.SERVICE_ROLE_KEY,authorization:'Bearer '+config.SERVICE_ROLE_KEY,'content-type':'application/json'};
const email=randomUUID()+'@example.invalid',password=randomBytes(32).toString('hex');
let subject,directory,service,store;
await admin.connect();
try{
 const created=await fetch(config.API_URL+'/auth/v1/admin/users',{method:'POST',headers:authHeaders,body:JSON.stringify({email,password,email_confirm:true})});assert.equal(created.status,200);subject=(await created.json()).id;assert.ok(subject);
 await admin.query('INSERT INTO mercury_guard.vendors(vendor_id,kind,active) VALUES($1,$2,true)',[vendor,'company']);
 await admin.query('INSERT INTO mercury_guard.guards(guard_id,auth_subject,vendor_id,active) VALUES($1,$2,$3,true)',[guard,subject,vendor]);
 await admin.query('INSERT INTO mercury_guard.guard_login VALUES($1,$2)',[guard,email]);
 directory=await openLocalGuardDirectory({config,mode:'postgres'});store=new DurableIngest(':memory:');service=createLocalService({config,store,directory});const origin=await service.start();
 const login=()=>fetch(origin+'/v1/session/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({guard_id:guard,password})});
 const response=await login();assert.equal(response.status,200);const session=await response.json();assert.equal('refresh_token' in session,false);
 const me=()=>fetch(origin+'/v1/me',{headers:{authorization:'Bearer '+session.access_token}});
 assert.deepEqual(await (await me()).json(),{guard_id:guard,vendor_id:vendor});
 await admin.query('UPDATE mercury_guard.vendors SET active=false WHERE vendor_id=$1',[vendor]);assert.equal((await me()).status,403);assert.equal((await login()).status,401);
 console.log('PASS: real HTTP login and Auth verification with PostgreSQL directory/pool/shared limiter; suspension denies existing session');
}finally{
 if(service)await service.stop();await directory?.close();store?.close();
 try{
  await admin.query('DELETE FROM mercury_guard.guard_login WHERE guard_id=$1',[guard]);await admin.query('DELETE FROM mercury_guard.guards WHERE guard_id=$1',[guard]);await admin.query('DELETE FROM mercury_guard.vendors WHERE vendor_id=$1',[vendor]);
  await admin.query('DELETE FROM mercury_guard.login_attempts WHERE bucket=$1',['account:'+createHash('sha256').update(guard).digest('hex')]);
  if(subject){const deleted=await fetch(config.API_URL+'/auth/v1/admin/users/'+subject,{method:'DELETE',headers:authHeaders});assert.equal(deleted.ok,true);}
  console.log('PASS: synthetic identity/account rows removed; shared global limiter count retained');
 }finally{await admin.end();}
}
