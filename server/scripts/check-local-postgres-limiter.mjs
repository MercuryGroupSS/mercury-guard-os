import {Client} from 'pg';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {verifyPostgresOpsBindings} from './verify-postgres-ops-bindings.mjs';
import {verifyPostgresOpsSync} from './verify-postgres-ops-sync.mjs';
import {verifyPostgresDevices} from './verify-postgres-devices.mjs';
import {createPostgresLoginLimiter} from '../postgres-login-limiter.mjs';
let databaseUrl;
if(process.env.MERCURY_POSTGRES_TEST_URL){
 if(process.env.CI!=='true')throw Error('CI test connection requires explicit CI mode');
 databaseUrl=process.env.MERCURY_POSTGRES_TEST_URL;
}else{
 const lines=readFileSync(new URL('../../supabase-start.log',import.meta.url),'utf8').split('\n');
 const config=JSON.parse(lines.findLast(l=>l.startsWith('{')&&l.includes('API_URL')));
 if(config.API_URL!=='http://127.0.0.1:55321')throw Error('Local database required');
 databaseUrl=config.DB_URL;
}
const url=new URL(databaseUrl);
if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost'].includes(url.hostname)||!['5432','55322'].includes(url.port)||url.search||url.hash)throw Error('Loopback test database required');
const name='mercury_limiter_verify_'+randomUUID().replaceAll('-',''),admin=new Client({connectionString:databaseUrl}),clients=[];let created=false,fixture;
await admin.connect();
try{
 if(process.env.MERCURY_BOOTSTRAP_TEST_ROLES==='1'){
  if(process.env.CI!=='true'||!process.env.MERCURY_POSTGRES_TEST_URL)throw Error('Role bootstrap is CI-only');
  // A fresh CI PostgreSQL service has none of Supabase's role names.
  await admin.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; END $$");
 }
 await admin.query('CREATE DATABASE '+name);created=true;url.pathname='/'+name;
 fixture=new Client({connectionString:url.toString()});await fixture.connect();
 await fixture.query('CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);');
 for(const file of ['20261023184633_guard_identity.sql','20261023185052_guard_login_throttle.sql','20261023185827_guard_device_assignments.sql','20261023191157_guard_ops_sync.sql','20261023191943_guard_ops_bindings.sql'])await fixture.query(readFileSync(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
 await fixture.query(readFileSync(new URL('../../supabase/tests/guard-identity.sql',import.meta.url),'utf8'));
 await fixture.query(readFileSync(new URL('../../supabase/tests/guard-device-assignments.sql',import.meta.url),'utf8'));
 for(let i=0;i<2;i++){const c=new Client({connectionString:url.toString()});await c.connect();clients.push(c);await c.query('SET ROLE service_role');}
 const limits=clients.map(createPostgresLoginLimiter),bucket=s=>createHash('sha256').update(s).digest('hex');
 async function concurrent(n,key){const results=Array(n);await Promise.all(limits.map(async(limit,lane)=>{for(let i=lane;i<n;i+=limits.length)results[i]=await limit(bucket(key(i)));}));return results;}
 const values=await concurrent(12,()=> 'one-guard');assert.equal(values.filter(Boolean).length,5);
 await fixture.query("UPDATE mercury_guard.login_attempts SET started_at=clock_timestamp()-interval '6 minutes'");assert.equal(await limits[0](bucket('one-guard')),true);
 await fixture.query('TRUNCATE mercury_guard.login_attempts');
 const global=await concurrent(105,i=>'guard-'+i);assert.equal(global.filter(Boolean).length,100);
 assert.equal((await fixture.query('SELECT count(*)::integer n FROM mercury_guard.login_attempts')).rows[0].n,101);
 const privileges=(await fixture.query("SELECT has_function_privilege('anon','mercury_guard.consume_login_attempt(text)','EXECUTE') AS anon,has_function_privilege('authenticated','mercury_guard.consume_login_attempt(text)','EXECUTE') AS authenticated")).rows[0];assert.equal(privileges.anon,false);assert.equal(privileges.authenticated,false);
 await verifyPostgresDevices(url.toString(),fixture);
 await verifyPostgresOpsSync(url.toString(),fixture);
 await verifyPostgresOpsBindings(url.toString(),fixture);
 console.log('PASS: migration replay, concurrent shared per-account/global limits, expiry and private function grants');
}finally{
 for(const c of clients)await c.end();await fixture?.end();if(created){await admin.query('DROP DATABASE '+name);console.log('PASS: isolated limiter verification database removed');}await admin.end();
}
