import {Client} from 'pg';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createPostgresLoginLimiter} from '../postgres-login-limiter.mjs';
const lines=readFileSync(new URL('../../supabase-start.log',import.meta.url),'utf8').split('\n');
const config=JSON.parse(lines.findLast(l=>l.startsWith('{')&&l.includes('API_URL'))),url=new URL(config.DB_URL);
if(config.API_URL!=='http://127.0.0.1:55321'||!['127.0.0.1','localhost'].includes(url.hostname)||url.port!=='55322')throw Error('Local database required');
const name='mercury_limiter_verify_'+randomUUID().replaceAll('-',''),admin=new Client({connectionString:config.DB_URL}),clients=[];let created=false,fixture;
await admin.connect();
try{
 await admin.query('CREATE DATABASE '+name);created=true;url.pathname='/'+name;
 fixture=new Client({connectionString:url.toString()});await fixture.connect();
 await fixture.query('CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);');
 for(const file of ['20261023184633_guard_identity.sql','20261023185052_guard_login_throttle.sql'])await fixture.query(readFileSync(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
 await fixture.query(readFileSync(new URL('../../supabase/tests/guard-identity.sql',import.meta.url),'utf8'));
 for(let i=0;i<2;i++){const c=new Client({connectionString:url.toString()});await c.connect();clients.push(c);await c.query('SET ROLE service_role');}
 const limits=clients.map(createPostgresLoginLimiter),bucket=s=>createHash('sha256').update(s).digest('hex');
 async function concurrent(n,key){const results=Array(n);await Promise.all(limits.map(async(limit,lane)=>{for(let i=lane;i<n;i+=limits.length)results[i]=await limit(bucket(key(i)));}));return results;}
 const values=await concurrent(12,()=> 'one-guard');assert.equal(values.filter(Boolean).length,5);
 await fixture.query("UPDATE mercury_guard.login_attempts SET started_at=clock_timestamp()-interval '6 minutes'");assert.equal(await limits[0](bucket('one-guard')),true);
 await fixture.query('TRUNCATE mercury_guard.login_attempts');
 const global=await concurrent(105,i=>'guard-'+i);assert.equal(global.filter(Boolean).length,100);
 assert.equal((await fixture.query('SELECT count(*)::integer n FROM mercury_guard.login_attempts')).rows[0].n,101);
 const privileges=(await fixture.query("SELECT has_function_privilege('anon','mercury_guard.consume_login_attempt(text)','EXECUTE') AS anon,has_function_privilege('authenticated','mercury_guard.consume_login_attempt(text)','EXECUTE') AS authenticated")).rows[0];assert.equal(privileges.anon,false);assert.equal(privileges.authenticated,false);
 console.log('PASS: migration replay, concurrent shared per-account/global limits, expiry and private function grants');
}finally{
 for(const c of clients)await c.end();await fixture?.end();if(created){await admin.query('DROP DATABASE '+name);console.log('PASS: isolated limiter verification database removed');}await admin.end();
}
