import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {createIngestHandler} from './ingest-handler.mjs';
import {createAuthorization} from './authorization.mjs';
import {createSupabaseSessionVerifier} from './supabase-session.mjs';
import {createSupabaseAuthority} from './supabase-authority.mjs';
// Loopback-only pilot composition; callers provide credential config privately.
export function createLocalService({config,store}) {
 if(config.API_URL!=='http://127.0.0.1:55321')throw Error('Local Supabase required');
 const authenticate=createAuthorization({
  verifySession:createSupabaseSessionVerifier({url:config.API_URL,publishableKey:config.PUBLISHABLE_KEY,allowLocal:true}),
  loadAuthorization:createSupabaseAuthority({url:config.API_URL,serviceKey:config.SERVICE_ROLE_KEY,allowLocal:true}),
  audience:'mercury-local'});
 const handler=createIngestHandler({authenticate,store});
 const server=createServer(async(req,res)=>{
  try {
   const request=new Request(new URL(req.url,'http://127.0.0.1'),{method:req.method,headers:req.headers,
    ...(['GET','HEAD'].includes(req.method)?{}:{body:Readable.toWeb(req),duplex:'half'})});
   const response=await handler(request);
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500,{'content-type':'application/json','cache-control':'no-store'});res.end('{"error":"request_failed"}');}
 });
 server.requestTimeout=10000;server.headersTimeout=10000;
 return {async start(){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});return `http://127.0.0.1:${server.address().port}`;},
 async stop(){server.closeAllConnections();await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}};
}
