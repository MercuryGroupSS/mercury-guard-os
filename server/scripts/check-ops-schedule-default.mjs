import {spawnSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {isAbsolute} from 'node:path';

// A fresh process receives only synthetic environment values. It has no
// Netlify global and never inherits or reads another application's secrets.
export function verifyDefaultScheduleEntrypoint(modulePath){
 assert.ok(isAbsolute(modulePath));
 const site=randomUUID(),id='synthetic-default-handler',origin='https://ops.example.invalid';
 const env={MERCURY_GUARD_SCHEDULE_CONFIG:JSON.stringify({version:1,site_id:site,public_origin:origin,allowed_ids:[id],allow_history:false}),MERCURY_GUARD_SCHEDULE_TOKEN:randomBytes(32).toString('base64url'),SUPABASE_URL:'https://dyctehllmjryjwvrmxdw.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_synthetic-default-only'};
 const code=`import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
 assert.equal(typeof globalThis.Netlify,'undefined');let calls=0;
 const c=JSON.parse(process.env.MERCURY_GUARD_SCHEDULE_CONFIG),id=c.allowed_ids[0];
 globalThis.fetch=async(url,options)=>{calls++;const u=new URL(url);assert.equal(u.origin,process.env.SUPABASE_URL);assert.equal(u.searchParams.get('select'),'id,scheduled_start,scheduled_end,status,updated_at');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers.apikey,process.env.SUPABASE_SERVICE_ROLE_KEY);return Response.json([{id,scheduled_start:'2026-10-29T22:00:00Z',scheduled_end:'2026-10-30T10:00:00Z',status:'scheduled',updated_at:'2026-10-29T17:00:00Z'}]);};
 const {default:handler}=await import(pathToFileURL(process.argv[1]));assert.equal(typeof handler,'function');const u=new URL('/.netlify/functions/mercury-one-schedule',c.public_origin);u.searchParams.set('ids',JSON.stringify([id]));u.searchParams.set('history','false');const context={site:{id:c.site_id},deploy:{context:'production'}};
 assert.equal((await handler(new Request(u),context)).status,401);assert.equal(calls,0);
 const response=await handler(new Request(u,{headers:{authorization:'Bearer '+process.env.MERCURY_GUARD_SCHEDULE_TOKEN}}),context);assert.equal(response.status,200);const body=await response.text();assert.equal(JSON.parse(body).rows[0].id,id);assert.equal(calls,1);assert.ok(!body.includes(process.env.SUPABASE_SERVICE_ROLE_KEY));
 console.log(JSON.stringify({default_Node_handler_passed:true,Netlify_global_absent:true,synthetic_environment_only:true,unauthenticated_denied_before_source:true,source_GETs:1,private_key_absent_from_response:true}));`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',code,modulePath],{env,encoding:'utf8',timeout:15000,maxBuffer:65536});
 assert.equal(child.status,0,'Production default handler failed in the isolated Node environment');
 const receipt=JSON.parse(child.stdout);assert.equal(receipt.default_Node_handler_passed,true);return receipt;
}
