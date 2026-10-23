import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomUUID,randomBytes,generateKeyPairSync,createHash,sign} from 'node:crypto';
import {createAssignmentHandler} from '../assignment-handler.mjs';
import {createSupabaseSessionVerifier} from '../supabase-session.mjs';
import {createOpsShiftReader} from '../ops-shift-reader.mjs';
import {OpsBindingStore} from '../ops-binding-store.mjs';
import {OpsAssignmentSync} from '../ops-assignment-sync.mjs';
import {LocalDeviceAssignments} from '../local-device-assignments.mjs';
import {LocalGuardDirectory} from '../local-guard-directory.mjs';
import {createOpsRefreshWorker} from '../ops-refresh-worker.mjs';
const lines=readFileSync(new URL('../../supabase-start.log',import.meta.url),'utf8').split('\n');
const config=JSON.parse(lines.findLast(line=>line.startsWith('{')&&line.includes('API_URL')));
if(config.API_URL!=='http://127.0.0.1:55321')throw Error('Isolated local environment required');
const marker='mercury-ops-fixture-'+randomUUID();
function sql(text){const result=spawnSync('/usr/local/bin/docker',['exec','-i','supabase_db_mercury-guard-os-local','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],{input:text,encoding:'utf8'});if(result.status!==0)throw Error('Local fixture SQL failed; existing tables must remain unchanged');return result.stdout.trim();}
const base=config.API_URL+'/auth/v1';
const admin={apikey:config.SERVICE_ROLE_KEY,authorization:'Bearer '+config.SERVICE_ROLE_KEY,'content-type':'application/json'};
async function auth(path,options){const response=await fetch(base+path,options);if(!response.ok)throw Error('Local Auth request failed');return response.json();}
const at=Date.now(),starts=new Date(at-60000).toISOString(),ends=new Date(at+3600000).toISOString(),updated=new Date(at-120000).toISOString();
let created=false,devices,directory,bindings,folder,authId;
try{
 // CREATE without IF NOT EXISTS refuses to touch an existing shifts table.
 sql(`BEGIN; CREATE TABLE public.shifts(id text PRIMARY KEY,scheduled_start timestamptz,scheduled_end timestamptz,status text,updated_at timestamptz);
 COMMENT ON TABLE public.shifts IS '${marker}';
 ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON public.shifts FROM PUBLIC,anon,authenticated;
 GRANT SELECT ON public.shifts TO service_role;
 INSERT INTO public.shifts VALUES('synthetic-shift','${starts}','${ends}','scheduled','${updated}'),('unmapped-shift','${starts}','${ends}','scheduled','${updated}');
 NOTIFY pgrst,'reload schema'; COMMIT;`);created=true;
 const read=createOpsShiftReader({url:config.API_URL,serverKey:config.SECRET_KEY??config.SERVICE_ROLE_KEY,allowLocal:true});
 let result;
 for(let i=0;i<10;i++){try{result=await read(['synthetic-shift','missing-shift']);break;}catch{if(i===9)throw Error('Local REST fixture unavailable');await new Promise(r=>setTimeout(r,200));}}
 if(result.rows.length!==1||result.rows[0].id!=='synthetic-shift'||result.missingIds.join()!=='missing-shift')throw Error('REST projection failed');
 console.log('PASS: real local REST selects only mapped schedule rows and reports missing IDs');
 folder=mkdtempSync(join(tmpdir(),'mercury-ops-refresh-'));devices=new LocalDeviceAssignments(join(folder,'devices.sqlite'));directory=new LocalGuardDirectory(join(folder,'directory.sqlite'));bindings=new OpsBindingStore(join(folder,'bindings.sqlite'));
 const email='mercury-ops-'+randomUUID()+'@example.invalid',password=randomBytes(32).toString('hex');
 const user=await auth('/admin/users',{method:'POST',headers:admin,body:JSON.stringify({email,password,email_confirm:true})});authId=user.id;if(!authId)throw Error('Synthetic Auth subject missing');
 const session=await auth('/token?grant_type=password',{method:'POST',headers:{apikey:config.ANON_KEY,'content-type':'application/json'},body:JSON.stringify({email,password})});
 directory.addVendor({vendorId:'vendor',kind:'company',active:true});directory.addGuard({guardId:'guard',vendorId:'vendor',authSubject:authId,active:true});
 bindings.approve({opsShiftId:'synthetic-shift',guardId:'guard',vendorId:'vendor',siteId:'site',authSubject:authId,revision:1,active:true},{operator:'local-smoke',reason:'Synthetic integration test'});
 const worker=createOpsRefreshWorker({loadBindings:()=>bindings.list(),readShifts:read,sync:new OpsAssignmentSync(devices),directory});
 if((await worker.run()).processed!==1)throw Error('Initial refresh failed');
 const original=JSON.parse(devices.db.prepare('SELECT body FROM assignments').get().body);
 const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),spki=keys.publicKey.export({type:'spki',format:'der'}),thumbprint=createHash('sha256').update(spki).digest('hex');
 devices.enroll({deviceId:'synthetic-phone',mode:'site',siteId:'site',active:true,revoked:false,publicKeySpki:spki.toString('base64url')});
 const handler=createAssignmentHandler({directory,devices,verifySession:createSupabaseSessionVerifier({url:config.API_URL,publishableKey:config.PUBLISHABLE_KEY,allowLocal:true})});
 const request=(path,body)=>handler(new Request('https://local-test.invalid'+path,{method:'POST',headers:{authorization:'Bearer '+session.access_token,'content-type':'application/json'},body:JSON.stringify(body)}));
 async function deviceProof(){
  const response=await request('/v1/device-challenge',{device_id:'synthetic-phone'});if(response.status!==200)throw Error('Enrolled challenge denied');const c=await response.json();
  return {version:1,algorithm:'SHA256withECDSA',audience:c.audience,request_id:c.request_id,challenge:c.challenge,device_thumbprint:thumbprint,public_key_spki:spki.toString('base64url'),signature_der:sign('sha256',Buffer.from(`mercury-enrollment-proof-v1\n${c.audience}\n${c.request_id}\n${c.challenge}\n${thumbprint}`),keys.privateKey).toString('base64url')};
 }
 const proof=await deviceProof(),assigned=await request('/v1/assignments',proof);
 if(assigned.status!==200||(await assigned.json()).assignments[0]?.assignmentId!==original.assignmentId)throw Error('Imported assignment not visible to authenticated phone');
 if((await request('/v1/assignments',proof)).status!==400)throw Error('Device proof replay accepted');
 console.log('PASS: real local Auth and enrolled-device proof expose the imported assignment and reject replay');
 sql(`UPDATE public.shifts SET status='cancelled',updated_at='${new Date(at).toISOString()}' WHERE id='synthetic-shift';`);
 if((await worker.run()).processed!==1)throw Error('Cancellation refresh failed');
 const cancelled=JSON.parse(devices.db.prepare('SELECT body FROM assignments WHERE id=?').get(original.assignmentId).body);
 if(cancelled.active!==false||cancelled.startsAt!==original.startsAt||cancelled.endsAt!==original.endsAt)throw Error('Cancellation history changed');
 const after=await request('/v1/assignments',await deviceProof());if(after.status!==200||(await after.json()).assignments.length!==0)throw Error('Cancelled assignment remained available to phone');
 console.log('PASS: persisted approval + real REST + roster check + assignment creation and cancellation at phone API');
}finally{
 if(authId){await auth('/admin/users/'+authId,{method:'DELETE',headers:admin});console.log('PASS: temporary Auth account removed');}
 devices?.close();directory?.close();bindings?.close();if(folder)rmSync(folder,{recursive:true,force:true});
 if(created){
  if(sql("SELECT obj_description('public.shifts'::regclass,'pg_class');")!==marker)throw Error('Fixture ownership changed; cleanup refused');
  sql('DROP TABLE public.shifts; NOTIFY pgrst,\'reload schema\';');
  if(sql("SELECT to_regclass('public.shifts') IS NULL;")!=='t')throw Error('Fixture cleanup unverified');
  console.log('PASS: temporary local REST table removed; hosted Ops untouched');
 }
}
