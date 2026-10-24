#!/usr/bin/env node
import {Client} from 'pg';import {readFileSync} from 'node:fs';
import {verifyPostgresConfiguredService} from './verify-postgres-configured-service.mjs';
const config=JSON.parse(readFileSync(new URL('../../supabase-start.log',import.meta.url),'utf8').split('\n').findLast(x=>x.startsWith('{')&&x.includes('API_URL'))),url=new URL(config.DB_URL);
if(config.API_URL!=='http://127.0.0.1:55321'||url.hostname!=='127.0.0.1'||url.port!=='55322'||url.search||url.hash)throw Error('Owned loopback stack required');
const owner=new Client({connectionString:config.DB_URL,connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:12000});await owner.connect();try{await verifyPostgresConfiguredService(config.DB_URL,owner);}finally{await owner.end();}
