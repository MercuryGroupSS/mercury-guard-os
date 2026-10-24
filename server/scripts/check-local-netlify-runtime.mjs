#!/usr/bin/env node
import {Client} from 'pg';
import {fileURLToPath} from 'node:url';
import {readPrivateBuildFile} from '../controlled-apk-input.mjs';
import {verifyPostgresNetlifyRuntime} from './verify-postgres-netlify-runtime.mjs';
if(process.argv.length!==2)throw Error('No arguments accepted');
const c=JSON.parse(readPrivateBuildFile(fileURLToPath(new URL('../../supabase-start.log',import.meta.url)),512*1024).toString('utf8').split('\n').findLast(l=>l.startsWith('{')&&l.includes('API_URL'))),u=new URL(c.DB_URL);
if(c.API_URL!=='http://127.0.0.1:55321'||!['postgres:','postgresql:'].includes(u.protocol)||u.hostname!=='127.0.0.1'||u.port!=='55322'||u.pathname!=='/postgres'||u.username!=='postgres'||u.search||u.hash)throw Error('Exact owned loopback Supabase required');
const owner=new Client({connectionString:c.DB_URL,connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:12000});await owner.connect();try{await verifyPostgresNetlifyRuntime(c.DB_URL,owner);}finally{await owner.end();}
