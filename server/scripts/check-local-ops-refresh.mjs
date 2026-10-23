import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
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
let created=false,devices,directory,bindings,folder;
try{
 // CREATE without IF NOT EXISTS refuses to touch an existing shifts table.
 sql(`BEGIN; CREATE TABLE public.shifts(id text PRIMARY KEY,scheduled_start timestamptz,scheduled_end timestamptz,status text,updated_at timestamptz);
 COMMENT ON TABLE public.shifts IS '${marker}';
 ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON public.shifts FROM PUBLIC,anon,authenticated;
 GRANT SELECT ON public.shifts TO service_role;
 INSERT INTO public.shifts VALUES('synthetic-shift','2026-10-23T12:00:00Z','2026-10-23T20:00:00Z','scheduled','2026-10-23T10:00:00Z'),('unmapped-shift','2026-10-23T12:00:00Z','2026-10-23T20:00:00Z','scheduled','2026-10-23T10:00:00Z');
 NOTIFY pgrst,'reload schema'; COMMIT;`);created=true;
 const read=createOpsShiftReader({url:config.API_URL,serverKey:config.SECRET_KEY??config.SERVICE_ROLE_KEY,allowLocal:true});
 let result;
 for(let i=0;i<10;i++){try{result=await read(['synthetic-shift','missing-shift']);break;}catch{if(i===9)throw Error('Local REST fixture unavailable');await new Promise(r=>setTimeout(r,200));}}
 if(result.rows.length!==1||result.rows[0].id!=='synthetic-shift'||result.missingIds.join()!=='missing-shift')throw Error('REST projection failed');
 console.log('PASS: real local REST selects only mapped schedule rows and reports missing IDs');
 folder=mkdtempSync(join(tmpdir(),'mercury-ops-refresh-'));devices=new LocalDeviceAssignments(join(folder,'devices.sqlite'));directory=new LocalGuardDirectory(join(folder,'directory.sqlite'));bindings=new OpsBindingStore(join(folder,'bindings.sqlite'));
 directory.addVendor({vendorId:'vendor',kind:'company',active:true});directory.addGuard({guardId:'guard',vendorId:'vendor',authSubject:'subject',active:true});
 bindings.approve({opsShiftId:'synthetic-shift',guardId:'guard',vendorId:'vendor',siteId:'site',authSubject:'subject',revision:1,active:true},{operator:'local-smoke',reason:'Synthetic integration test'});
 const worker=createOpsRefreshWorker({loadBindings:()=>bindings.list(),readShifts:read,sync:new OpsAssignmentSync(devices),directory});
 if((await worker.run()).processed!==1)throw Error('Initial refresh failed');
 const original=JSON.parse(devices.db.prepare('SELECT body FROM assignments').get().body);
 sql("UPDATE public.shifts SET status='cancelled',updated_at='2026-10-23T10:01:00Z' WHERE id='synthetic-shift';");
 if((await worker.run()).processed!==1)throw Error('Cancellation refresh failed');
 const cancelled=JSON.parse(devices.db.prepare('SELECT body FROM assignments WHERE id=?').get(original.assignmentId).body);
 if(cancelled.active!==false||cancelled.startsAt!==original.startsAt||cancelled.endsAt!==original.endsAt)throw Error('Cancellation history changed');
 console.log('PASS: persisted approval + real REST + roster check + assignment creation and cancellation');
}finally{
 devices?.close();directory?.close();bindings?.close();if(folder)rmSync(folder,{recursive:true,force:true});
 if(created){
  if(sql("SELECT obj_description('public.shifts'::regclass,'pg_class');")!==marker)throw Error('Fixture ownership changed; cleanup refused');
  sql('DROP TABLE public.shifts; NOTIFY pgrst,\'reload schema\';');
  if(sql("SELECT to_regclass('public.shifts') IS NULL;")!=='t')throw Error('Fixture cleanup unverified');
  console.log('PASS: temporary local REST table removed; hosted Ops untouched');
 }
}
