import {LocalGuardDirectory} from '../local-guard-directory.mjs';
// Local-only smoke check. Reads startup credentials without printing them.
import {createSupabaseSessionVerifier} from '../supabase-session.mjs';
import {readFileSync} from 'node:fs';
import {createLocalService} from '../local-service.mjs';
import {DurableIngest} from '../durable-ingest.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,generateKeyPairSync,sign,randomUUID,randomBytes} from 'node:crypto';
const lines=readFileSync(new URL('../../supabase-start.log',import.meta.url),'utf8').trim().split('\n');
const config=JSON.parse(lines.findLast(line=>line.startsWith('{')&&line.includes('API_URL')));
if(config.API_URL!=='http://127.0.0.1:55321') throw Error('Local environment required');
const base=config.API_URL+'/auth/v1';
const admin={apikey:config.SERVICE_ROLE_KEY,authorization:'Bearer '+config.SERVICE_ROLE_KEY,'content-type':'application/json'};
const email=`mercury-test-${randomUUID()}@example.invalid`,password=randomBytes(32).toString('hex');
let id;
async function call(path,options){const r=await fetch(base+path,options);if(!r.ok)throw Error(`Local auth check failed: ${r.status}`);return r.json();}
try {
 const user=await call('/admin/users',{method:'POST',headers:admin,body:JSON.stringify({email,password,email_confirm:true})});id=user.id;
 if(!id)throw Error('Missing synthetic user ID');
 const session=await call('/token?grant_type=password',{method:'POST',headers:{apikey:config.ANON_KEY,'content-type':'application/json'},body:JSON.stringify({email,password})});
 const verifySession=createSupabaseSessionVerifier({url:config.API_URL,publishableKey:config.PUBLISHABLE_KEY,allowLocal:true});
 const checked=await verifySession(session.access_token);
 if(checked?.subject!==id)throw Error('Session provider failed');
 if(await verifySession('invalid')!==null)throw Error('Malformed token accepted');
 const verified=await call('/user',{headers:{apikey:config.ANON_KEY,authorization:'Bearer '+session.access_token}});
 if(verified.id!==id)throw Error('Identity mismatch');
 const invalid=await fetch(base+'/user',{headers:{apikey:config.ANON_KEY,authorization:'Bearer invalid'}});
 if(![401,403].includes(invalid.status))throw Error('Unexpected invalid-token status: '+invalid.status);

 const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const spki=publicKey.export({type:'spki',format:'der'}),thumbprint=createHash('sha256').update(spki).digest('hex');
 const now=Math.floor(Date.now()/1000);
 const authority={subject:id,active:true,enrolled:true,revoked:false,audience:'mercury-local',guard_id:'synthetic-guard',site_id:'synthetic-site',assignment_id:'synthetic-shift',thumbprint,public_key_spki:spki.toString('base64url'),revocation_version:1,not_before:now-1,expires_at:now+600,allowed_kinds:['incident']};
 const authorityUrl=config.API_URL+'/rest/v1/guard_authorizations';
 const insert=await fetch(authorityUrl,{method:'POST',headers:admin,body:JSON.stringify(authority)});
 if(!insert.ok)throw Error('Authority insertion failed: '+insert.status);
 const denied=await fetch(authorityUrl,{headers:{apikey:config.PUBLISHABLE_KEY,authorization:'Bearer '+session.access_token}});
 if(![401,403].includes(denied.status))throw Error('User could read server authority');
 const scope={guard_id:authority.guard_id,site_id:authority.site_id,assignment_id:authority.assignment_id,device_thumbprint:thumbprint,revocation_version:1};
 const batch={batch_id:randomUUID(),schema_version:2,scope,events:[{event_id:randomUUID(),sequence:1,at:Date.now(),kind:'incident',data:{note:'Synthetic only'}}]};
 const payload=Buffer.from(JSON.stringify(batch)).toString('base64url');
 const proof=JSON.stringify({version:2,algorithm:'SHA256withECDSA',audience:'mercury-local',device_thumbprint:thumbprint,public_key_spki:authority.public_key_spki,payload,signature_der:sign('sha256',Buffer.from(`mercury-event-batch-v2\nmercury-local\n${thumbprint}\n${payload}`),privateKey).toString('base64url')});
 const dir=mkdtempSync(join(tmpdir(),'mercury-network-'));const directory=new LocalGuardDirectory(join(dir,'directory.sqlite'));
 directory.addVendor({vendorId:'synthetic-vendor',kind:'company',active:true});
 directory.addGuard({guardId:'synthetic-guard',authSubject:id,vendorId:'synthetic-vendor',active:true});
 let store=new DurableIngest(join(dir,'events.sqlite')),service=createLocalService({config,store,directory}),started=false;
 try {
  let origin=await service.start();started=true;
  const profile=()=>fetch(origin+'/v1/me',{headers:{authorization:'Bearer '+session.access_token}});
  let me=await profile();if(me.status!==200||JSON.stringify(await me.json())!==JSON.stringify({guard_id:'synthetic-guard',vendor_id:'synthetic-vendor'}))throw Error('Guard profile failed');
  directory.setGuardActive('synthetic-guard',false);if((await profile()).status!==403)throw Error('Disabled guard accepted');
  directory.setGuardActive('synthetic-guard',true);
  console.log('PASS: authenticated guard profile and disabled guard denial');
  const send=()=>fetch(origin+'/v2/batches',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+session.access_token},body:proof});
  let response=await send();if(response.status!==200)throw Error('Signed network ingestion failed: '+response.status);
  const receipt=await response.json();if(store.count()!==1)throw Error('Missing event');
  directory.setGuardActive('synthetic-guard',false);if((await send()).status!==401)throw Error('Disabled guard uploaded');
  directory.setGuardActive('synthetic-guard',true);
  console.log('PASS: disabled roster identity denies batch retries');
  await service.stop();started=false;store.close();store=new DurableIngest(join(dir,'events.sqlite'));service=createLocalService({config,store,directory});origin=await service.start();started=true;
  response=await send();if(response.status!==200||JSON.stringify(await response.json())!==JSON.stringify(receipt)||store.count()!==1)throw Error('Restart retry failed');
  const revoke=await fetch(authorityUrl+'?subject=eq.'+id,{method:'PATCH',headers:admin,body:JSON.stringify({revoked:true})});if(!revoke.ok)throw Error('Revocation update failed');
  if((await send()).status!==401)throw Error('Revoked device accepted');
  console.log('PASS: real local Auth + protected authority + signed HTTP ingestion + restart deduplication + revocation');
 } finally {if(started)await service.stop();store.close();directory.close();rmSync(dir,{recursive:true,force:true});}

} finally {
 if(id){await call('/admin/users/'+id,{method:'DELETE',headers:admin});console.log('PASS: synthetic account removed');}
}
