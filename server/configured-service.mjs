import {createServer} from 'node:https';
import {Readable} from 'node:stream';
import {validateConfiguredServiceConfig} from './configured-service-config.mjs';
import {createSupabaseSessionVerifier} from './supabase-session.mjs';
import {createPostgresAuthSessionReader} from './postgres-auth-session.mjs';
import {createPasswordSession} from './password-session.mjs';
import {createSessionLogoutHandler} from './session-logout-handler.mjs';
import {createAccountCredentials} from './account-credentials.mjs';
import {createAccountHandler} from './account-handler.mjs';
import {createPostgresLoginLimiter} from './postgres-login-limiter.mjs';
import {accountPageResponse} from './account-page-handler.mjs';
import {createAdminHandler} from './admin-handler.mjs';
import {adminConsoleResponse} from './admin-console-handler.mjs';
import {withEscalationAdministration} from './escalation-administration.mjs';
import {createGrantIngestHandler} from './grant-ingest-handler.mjs';
import {createGuardProfileHandler} from './guard-profile-handler.mjs';
import {createLoginHandler} from './login-handler.mjs';
import {createAssignmentHandler} from './assignment-handler.mjs';
import {createEvidenceHandler} from './evidence-handler.mjs';
import {createEscalationHandler} from './escalation-handler.mjs';
import {createLocationConsentHandler} from './location-consent-handler.mjs';

const reply=(status,error)=>new Response(JSON.stringify({error}),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
// This composition deliberately has no legacy authorizations-table/SQLite fallback.
export function createConfiguredApplication({config,pool,directory,devices,grantIssuer,store,dispatch,shiftLifecycle,admin,escalations,locationConsents,receiver=null,fetchImpl=fetch}){
 const c=validateConfiguredServiceConfig(config);
 if(!pool||!directory||!devices||!grantIssuer||!store||!dispatch||!shiftLifecycle||!admin||!escalations||!locationConsents||[devices,grantIssuer,escalations,locationConsents].some(v=>v.audience!==c.issuer.audience)||grantIssuer.issuer!==c.issuer.issuer||grantIssuer.keyId!==c.issuer.key_id)throw Error('Complete configured Guard components required');
 if(c.dashboard_receiver!=null?typeof receiver?.observations!=='function'||typeof receiver?.media!=='function':receiver!==null)throw Error('Explicit configured receiver composition required');
 const auth={url:c.auth.origin,publishableKey:c.auth.publishable_key,allowLocal:c.mode==='isolated_local_pilot',loadSession:createPostgresAuthSessionReader(pool),fetchImpl};
 const verifySession=createSupabaseSessionVerifier(auth),passwordSession=createPasswordSession(auth),credentials=createAccountCredentials({...auth,verifySession});
 const account=createAccountHandler({credentials,consumeAttempt:createPostgresLoginLimiter(pool)}),logout=createSessionLogoutHandler({...auth,verifySession});
 const ingest=createGrantIngestHandler({directory,devices,grantIssuer,store,dispatch,shiftLifecycle,verifySession}),profile=createGuardProfileHandler({directory,verifySession}),login=createLoginHandler({directory,passwordSession}),assignments=createAssignmentHandler({directory,devices,grantIssuer,store,dispatch,shiftLifecycle,verifySession}),evidence=createEvidenceHandler({directory,devices,grantIssuer,store,verifySession});
 const escalation=createEscalationHandler({verifySession,store:escalations}),consent=createLocationConsentHandler({verifySession,store:locationConsents}),administration=createAdminHandler({admin:withEscalationAdministration(admin,escalations),verifySession,passwordSession});
 return {assertConfiguration:()=>credentials.assertConfiguration(),async handle(request){
  const u=new URL(request.url);if(u.origin!==c.public_origin)return reply(421,'origin_unavailable');
  const origin=request.headers.get('origin');if(origin!==null&&origin!==c.public_origin)return reply(403,'origin_denied');
  const p=u.pathname;
  if(receiver&&p==='/v1/mercury-one/observations')return receiver.observations(request);
  if(receiver&&p.startsWith('/v1/mercury-one/media/'))return receiver.media(request);
  if(p==='/account'||p.startsWith('/account/'))return accountPageResponse(request);
  if(p.startsWith('/v1/account/'))return account(request);
  if(p==='/admin'||p.startsWith('/admin/'))return adminConsoleResponse(request);
  if(p.startsWith('/v1/admin/'))return administration(request);
  if(p==='/v1/session/logout')return logout(request);
  if(p==='/v1/session/login')return login(request);
  if(p==='/v1/me')return profile(request);
  if(['/v1/device-challenge','/v1/assignments','/v1/dispatch','/v1/shift-grant','/v1/shift-transition'].includes(p))return assignments(request);
  if(p.startsWith('/v1/evidence/'))return evidence(request);
  if(p==='/v1/escalations'||p==='/v1/escalations/status')return escalation(request);
  if(['/v1/location-consents','/v1/location-consents/challenge','/v1/location-consents/status'].includes(p))return consent(request);
  if(p==='/v2/batches')return ingest(request);
  return reply(404,'not_found');
 }};
}
export function createConfiguredService({config,materials,application,preflight=async()=>{}}){
 const c=validateConfiguredServiceConfig(config),active=new Set();let stopping=false,startPromise=null;
 if(typeof application?.handle!=='function'||typeof application?.assertConfiguration!=='function'||typeof preflight!=='function')throw Error('Configured application required');
 const server=createServer({cert:materials.certificate,key:materials.tlsKey,minVersion:'TLSv1.2'},(req,res)=>{
  const operation=(async()=>{
   let response;
   try{
    const hostCount=req.rawHeaders.filter((_,i)=>i%2===0&&req.rawHeaders[i].toLowerCase()==='host').length;
    if(stopping)response=reply(503,'service_stopping');
    else if(hostCount!==1||req.headers.host!==new URL(c.public_origin).host||!req.url.startsWith('/')||req.url.startsWith('//')||req.url.includes('#')||['forwarded','x-forwarded-host','x-forwarded-proto','x-original-url','x-rewrite-url'].some(h=>req.headers[h]!==undefined))response=reply(421,'origin_unavailable');
    else response=await application.handle(new Request(new URL(req.url,c.public_origin),{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Readable.toWeb(req),duplex:'half'})}));
   }catch{response=reply(500,'request_failed');}
   if(!res.destroyed){res.writeHead(response.status,{...Object.fromEntries(response.headers),'strict-transport-security':'max-age=31536000','referrer-policy':'no-referrer'});res.end(Buffer.from(await response.arrayBuffer()));}
  })().catch(()=>{if(!res.destroyed){res.writeHead(500,{'cache-control':'no-store'});res.end();}});
  active.add(operation);void operation.finally(()=>active.delete(operation));
 });
 server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
 return {async check(){await preflight();await application.assertConfiguration();return {status:'configuration_verified',origin:c.public_origin,deployment_id:c.deployment_id};},
  start(){if(stopping)return Promise.reject(Error('Configured service stopped'));if(startPromise)return startPromise;startPromise=(async()=>{await this.check();if(stopping)throw Error('Configured service stopped');await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(c.listen.port,c.listen.host,()=>{server.removeListener('error',reject);resolve();});});if(stopping)throw Error('Configured service stopped');return c.public_origin;})();return startPromise;},
  async stop(){stopping=true;await startPromise?.catch(()=>{});const closed=server.listening?new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve())):Promise.resolve();const timer=setTimeout(()=>server.closeAllConnections(),15000);timer.unref();try{await closed;await Promise.allSettled([...active]);}finally{clearTimeout(timer);}}
 };
}
