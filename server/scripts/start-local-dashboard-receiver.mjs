import {readFileSync} from 'node:fs';import {createServer} from 'node:http';import {Readable} from 'node:stream';import {Pool} from 'pg';
import {PostgresDashboardInbox} from '../postgres-dashboard-inbox.mjs';import {createDashboardInboxHandler} from '../dashboard-inbox.mjs';
if(process.argv.includes('--help')){console.log('Start the isolated local Guard receiver. Requires MERCURY_RECEIVER_DESTINATION and MERCURY_RECEIVER_TOKEN in the private process environment. Optional MERCURY_RECEIVER_PORT defaults to an ephemeral port. No mappings are automatically approved.');process.exit(0);}
if(process.argv.length!==2)throw Error('Use --help for local receiver settings');
const destination=process.env.MERCURY_RECEIVER_DESTINATION,token=process.env.MERCURY_RECEIVER_TOKEN,port=Number(process.env.MERCURY_RECEIVER_PORT??0);
if(typeof destination!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(destination)||!Number.isSafeInteger(port)||port<0||port>65535)throw Error('Explicit receiver destination and valid local port required');
const config=JSON.parse(readFileSync(new URL('../../supabase-start.log',import.meta.url),'utf8').split('\n').findLast(l=>l.startsWith('{')&&l.includes('API_URL'))),url=new URL(config.DB_URL);
if(config.API_URL!=='http://127.0.0.1:55321'||!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.port!=='55322'||url.search||url.hash)throw Error('Isolated local receiver database required');
const pool=new Pool({connectionString:config.DB_URL,max:4,connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:10000,options:'-c role=service_role'});pool.on('error',()=>console.error('Local receiver database connection unavailable.'));
const inbox=new PostgresDashboardInbox(pool),handler=createDashboardInboxHandler({token,destination,inbox,loadMapping:scope=>inbox.get(scope)});
const server=createServer(async(req,res)=>{
 try{const response=await handler(new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());}
 catch{res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end('{"error":"receiver_unavailable"}');}
});server.requestTimeout=15000;server.headersTimeout=10000;
try{await pool.query('SELECT 1 FROM mercury_guard_receiver.bindings LIMIT 0');await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});console.log('Local Guard receiver: http://127.0.0.1:'+server.address().port+'/v1/mercury-one/observations');}
catch(error){await pool.end();throw error;}
let stopping=false;async function stop(){if(stopping)return;stopping=true;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await pool.end();}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
