import {createAssignmentHandler} from './assignment-handler.mjs';
import {createGuardResolver} from './guard-directory.mjs';
import {createGuardProfileHandler} from './guard-profile-handler.mjs';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {createIngestHandler} from './ingest-handler.mjs';
import {createAuthorization} from './authorization.mjs';
import {createSupabaseSessionVerifier} from './supabase-session.mjs';
import {createSupabaseAuthority} from './supabase-authority.mjs';
// Loopback-only pilot composition; callers provide credential config privately.
export function createLocalService({config,store,directory,devices}) {
 if(config.API_URL!=='http://127.0.0.1:55321')throw Error('Local Supabase required');
 const authority=createSupabaseAuthority({url:config.API_URL,serviceKey:config.SERVICE_ROLE_KEY,allowLocal:true});
 const resolve=directory?createGuardResolver({loadGuardsForSubject:s=>directory.loadGuardsForSubject(s),loadVendor:id=>directory.loadVendor(id)}):null;
 const authenticate=createAuthorization({
  verifySession:createSupabaseSessionVerifier({url:config.API_URL,publishableKey:config.PUBLISHABLE_KEY,allowLocal:true}),
  loadAuthorization:async subject=>{
   const a=await authority(subject);
   if(resolve){const guard=await resolve({subject,active:true});if(!guard||a?.guardId!==guard.guardId||(devices&&!devices.authorizes(guard,a)))return null;}
   return a;
  },
  audience:'mercury-local'});
 const handler=createIngestHandler({authenticate,store});
 const profile=directory?createGuardProfileHandler({directory,verifySession:createSupabaseSessionVerifier({url:config.API_URL,publishableKey:config.PUBLISHABLE_KEY,allowLocal:true})}):null;
 const assignments=directory&&devices?createAssignmentHandler({directory,devices,verifySession:createSupabaseSessionVerifier({url:config.API_URL,publishableKey:config.PUBLISHABLE_KEY,allowLocal:true})}):null;
 const server=createServer(async(req,res)=>{
  try {
   const request=new Request(new URL(req.url,'http://127.0.0.1'),{method:req.method,headers:req.headers,
    ...(['GET','HEAD'].includes(req.method)?{}:{body:Readable.toWeb(req),duplex:'half'})});
   const path=new URL(request.url).pathname;
   const response=await (profile&&path==='/v1/me'?profile(request):assignments&&['/v1/device-challenge','/v1/assignments'].includes(path)?assignments(request):handler(request));
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500,{'content-type':'application/json','cache-control':'no-store'});res.end('{"error":"request_failed"}');}
 });
 server.requestTimeout=10000;server.headersTimeout=10000;
 return {async start(){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});return `http://127.0.0.1:${server.address().port}`;},
 async stop(){server.closeAllConnections();await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}};
}
