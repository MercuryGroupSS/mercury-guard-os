import {createCheckInWorker} from './check-in-worker.mjs';
import {createEvidenceHandler} from './evidence-handler.mjs';
import {createGrantIngestHandler} from './grant-ingest-handler.mjs';
import {createLoginHandler} from './login-handler.mjs';
import {createPasswordSession} from './password-session.mjs';
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
export function createLocalService({config,store,directory,devices,grantIssuer,dispatch}) {
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
 const handler=directory&&devices&&grantIssuer?createGrantIngestHandler({directory,devices,grantIssuer,store,dispatch,verifySession:createSupabaseSessionVerifier({url:config.API_URL,publishableKey:config.PUBLISHABLE_KEY,allowLocal:true})}):createIngestHandler({authenticate,store});
 const profile=directory?createGuardProfileHandler({directory,verifySession:createSupabaseSessionVerifier({url:config.API_URL,publishableKey:config.PUBLISHABLE_KEY,allowLocal:true})}):null;
 const assignments=directory&&devices?createAssignmentHandler({directory,devices,grantIssuer,store,dispatch,verifySession:createSupabaseSessionVerifier({url:config.API_URL,publishableKey:config.PUBLISHABLE_KEY,allowLocal:true})}):null;
 const login=directory?createLoginHandler({directory,passwordSession:createPasswordSession({url:config.API_URL,publishableKey:config.PUBLISHABLE_KEY,allowLocal:true})}):null;
 const evidence=directory&&devices&&grantIssuer?createEvidenceHandler({directory,devices,grantIssuer,store,verifySession:createSupabaseSessionVerifier({url:config.API_URL,publishableKey:config.PUBLISHABLE_KEY,allowLocal:true})}):null;
 const checkIns=devices&&store?createCheckInWorker({store,devices}):null;
 const server=createServer(async(req,res)=>{
  try {
   const request=new Request(new URL(req.url,'http://127.0.0.1'),{method:req.method,headers:req.headers,
    ...(['GET','HEAD'].includes(req.method)?{}:{body:Readable.toWeb(req),duplex:'half'})});
   const path=new URL(request.url).pathname;
   const response=await (evidence&&path.startsWith('/v1/evidence/')?evidence(request):login&&path==='/v1/session/login'?login(request):profile&&path==='/v1/me'?profile(request):assignments&&['/v1/device-challenge','/v1/assignments','/v1/shift-grant','/v1/dispatch'].includes(path)?assignments(request):handler(request));
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500,{'content-type':'application/json','cache-control':'no-store'});res.end('{"error":"request_failed"}');}
 });
 server.requestTimeout=10000;server.headersTimeout=10000;
 return {schedulerStatus:()=>checkIns?.status()??null,async start(){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});try{checkIns?.start();}catch(e){await new Promise(resolve=>server.close(resolve));throw e;}return `http://127.0.0.1:${server.address().port}`;},
 async stop(){checkIns?.stop();server.closeAllConnections();await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}};
}
