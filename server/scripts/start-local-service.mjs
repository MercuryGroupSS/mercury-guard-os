import {readFileSync,mkdirSync} from 'node:fs';
import {createLocalService} from '../local-service.mjs';
import {DurableIngest} from '../durable-ingest.mjs';
const root=new URL('../../',import.meta.url);
const lines=readFileSync(new URL('supabase-start.log',root),'utf8').split('\n');
const config=JSON.parse(lines.findLast(l=>l.startsWith('{')&&l.includes('API_URL')));
const dir=new URL('.local-backend/',root);mkdirSync(dir,{recursive:true,mode:0o700});
const store=new DurableIngest(new URL('events.sqlite',dir).pathname);
const service=createLocalService({config,store});
try {console.log('Local synthetic-data ingestion service: '+await service.start());}
catch(error){store.close();throw error;}
let stopping=false;
async function stop(){if(stopping)return;stopping=true;await service.stop();store.close();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
