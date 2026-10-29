import {build} from 'esbuild';
import {mkdirSync,readFileSync,writeFileSync,mkdtempSync,rmSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../../',import.meta.url));
if(process.argv.length>3)throw Error('One optional review output folder accepted');
const out=resolve(process.argv[2]??join(root,'.local-backend/ops-schedule-bridge-draft'));
mkdirSync(out,{recursive:true});
const output=join(out,'mercury-one-schedule.mjs');
const result=await build({absWorkingDir:root,entryPoints:['integration-drafts/ops-schedule-bridge/entry.mjs'],outfile:output,bundle:true,platform:'node',format:'esm',target:'node20',metafile:true,legalComments:'none',banner:{js:'// REVIEW DRAFT: one additive Ops function. Not installed by the Guard deployment.'}});
const bytes=readFileSync(output),sha=b=>createHash('sha256').update(b).digest('hex');
for(const item of Object.values(result.metafile.outputs))for(const external of item.imports)assert.ok(external.external&&external.path.startsWith('node:'));
// Independently load the distributed single file, outside the source/dependency tree.
const temp=mkdtempSync(join(tmpdir(),'guard-ops-bridge-bundle-'));
try{
 const path=join(temp,'mercury-one-schedule.mjs');copyFileSync(output,path);const module=await import(pathToFileURL(path));
 const token=randomBytes(32).toString('base64url'),site=randomUUID(),origin='https://ops.example.invalid',id='synthetic-bundle-shift';
 const env={MERCURY_GUARD_SCHEDULE_CONFIG:JSON.stringify({version:1,site_id:site,public_origin:origin,allowed_ids:[id],allow_history:true}),MERCURY_GUARD_SCHEDULE_TOKEN:token,SUPABASE_URL:'https://dyctehllmjryjwvrmxdw.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_synthetic-bundle-only'};
 let fetched=0;const handler=module.createOpsScheduleEntrypoint({get:n=>env[n],fetchImpl:async(url,options)=>{fetched++;assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers.apikey,env.SUPABASE_SERVICE_ROLE_KEY);assert.equal(new URL(url).searchParams.get('select'),'id,scheduled_start,scheduled_end,status,updated_at');return Response.json([{id,scheduled_start:'2026-10-29T22:00:00Z',scheduled_end:'2026-10-30T10:00:00Z',status:'scheduled',updated_at:'2026-10-29T16:00:00Z'}]);}});
 const url=new URL('/.netlify/functions/mercury-one-schedule',origin);url.searchParams.set('ids',JSON.stringify([id]));url.searchParams.set('history','true');
 const context={site:{id:site},deploy:{context:'production'}};
 assert.equal((await handler(new Request(url),context)).status,401);assert.equal(fetched,0);
 const response=await handler(new Request(url,{headers:{authorization:'Bearer '+token}}),context);assert.equal(response.status,200);const value=await response.json();assert.equal(value.rows[0].id,id);assert.equal(fetched,1);assert.ok(!JSON.stringify(value).includes(env.SUPABASE_SERVICE_ROLE_KEY));
 const record={status:'standalone_review_bundle_verified',file:'mercury-one-schedule.mjs',bytes:bytes.length,sha256:sha(bytes),source_inputs:Object.keys(result.metafile.inputs).sort().map(path=>({path,sha256:sha(readFileSync(resolve(root,path)))})),verification:{loaded_outside_source:true,missing_credential_denied_before_upstream:true,synthetic_scoped_five_field_read:true,source_key_absent_from_response:true},live_Ops_modified:false,live_activation_authorized:false};
 writeFileSync(join(out,'BUILD-RECORD.json'),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record));
}finally{rmSync(temp,{recursive:true,force:true});}
