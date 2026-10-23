import {Client} from 'pg';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {PostgresGuardDirectory} from '../postgres-guard-directory.mjs';
import {createGuardResolver} from '../guard-directory.mjs';
const lines=readFileSync(new URL('../../supabase-start.log',import.meta.url),'utf8').split('\n');
const config=JSON.parse(lines.findLast(line=>line.startsWith('{')&&line.includes('API_URL')));
const url=new URL(config.DB_URL);if(config.API_URL!=='http://127.0.0.1:55321'||!['127.0.0.1','localhost'].includes(url.hostname)||url.port!=='55322')throw Error('Isolated database required');
const client=new Client({connectionString:config.DB_URL,connectionTimeoutMillis:5000,query_timeout:5000});
await client.connect();
const subject=randomUUID(),vendor='test-'+randomUUID(),guard='test-'+randomUUID(),email=subject+'@example.invalid';
try{
 await client.query('BEGIN');
 await client.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[subject,email]);
 await client.query('INSERT INTO mercury_guard.vendors(vendor_id,kind,active) VALUES($1,$2,true)',[vendor,'company']);
 await client.query('INSERT INTO mercury_guard.guards(guard_id,auth_subject,vendor_id,active) VALUES($1,$2,$3,true)',[guard,subject,vendor]);
 await client.query('INSERT INTO mercury_guard.guard_login VALUES($1,$2)',[guard,email]);
 await client.query('SET LOCAL ROLE service_role');
 const directory=new PostgresGuardDirectory({client});
 const resolve=createGuardResolver({loadGuardsForSubject:s=>directory.loadGuardsForSubject(s),loadVendor:id=>directory.loadVendor(id)});
 assert.deepEqual(await directory.loginAccount(guard),{subject,email});
 assert.equal(await directory.loginAccount("' OR true --"),null);
 assert.equal((await resolve({subject,active:true})).guardId,guard);
 const bucket=createHash('sha256').update(subject).digest('hex');for(let i=0;i<5;i++)assert.equal(await directory.consumeLoginAttempt(bucket,Date.now()),true);assert.equal(await directory.consumeLoginAttempt(bucket,Date.now()),false);
 await client.query('UPDATE mercury_guard.vendors SET active=false WHERE vendor_id=$1',[vendor]);
 assert.equal(await directory.loginAccount(guard),null);assert.equal(await resolve({subject,active:true}),null);
 console.log('PASS: PostgreSQL service-role directory, parameterized lookup, mandatory limiter and vendor suspension');
}finally{
 try{await client.query('ROLLBACK');console.log('PASS: all PostgreSQL identity fixtures rolled back');}finally{await client.end();}
}
