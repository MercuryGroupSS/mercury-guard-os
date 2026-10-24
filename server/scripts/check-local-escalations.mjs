import {Client} from 'pg';import {readFileSync} from 'node:fs';import {randomUUID} from 'node:crypto';import {verifyPostgresEscalations} from './verify-postgres-escalations.mjs';
let databaseUrl;
if(process.env.MERCURY_POSTGRES_TEST_URL){if(process.env.CI!=='true')throw Error('Explicit CI test mode required');databaseUrl=process.env.MERCURY_POSTGRES_TEST_URL;}
else{const raw=readFileSync(new URL('../../supabase-start.log',import.meta.url),'utf8'),config=JSON.parse(raw.split('\n').findLast(line=>line.startsWith('{')&&line.includes('API_URL')));if(config.API_URL!=='http://127.0.0.1:55321')throw Error('Owned local Supabase required');databaseUrl=config.DB_URL;}
const url=new URL(databaseUrl);if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost'].includes(url.hostname)||!['5432','55322'].includes(url.port)||url.search||url.hash)throw Error('Loopback disposable PostgreSQL only');
const name='mercury_escalations_verify_'+randomUUID().replaceAll('-',''),admin=new Client({connectionString:databaseUrl});let created=false,fixture;
await admin.connect();try{
 await admin.query('CREATE DATABASE '+name);created=true;url.pathname='/'+name;fixture=new Client({connectionString:url.toString()});await fixture.connect();
 await fixture.query('CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),not_after timestamptz);');
 for(const file of ['20261023184633_guard_identity.sql','20261023185827_guard_device_assignments.sql','20261023185052_guard_login_throttle.sql','20261023203534_guard_administration.sql','20261023211811_guard_auth_session_read.sql'])await fixture.query(readFileSync(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
 // Replay the exported canonical migration in this uniquely created disposable DB.
 await fixture.query(readFileSync(new URL('../../supabase/migrations/20261023233208_guard_escalations.sql',import.meta.url),'utf8'));
 await fixture.query(readFileSync(new URL('../../supabase/migrations/20261024001402_guard_authorized_location.sql',import.meta.url),'utf8'));
 await verifyPostgresEscalations(url.toString(),fixture);
}finally{await fixture?.end();if(created){await admin.query('DROP DATABASE '+name);console.log('PASS: isolated escalation verification database removed');}await admin.end();}
