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
import {strictJson} from './verify-batch.mjs';

const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.sort().join();
const safe=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
function apiKey(value,role){if(!safe(value,16384)||/\s/.test(value))throw Error();if(value.startsWith(role==='anon'?'sb_publishable_':'sb_secret_'))return;const p=value.split('.');if(p.length!==3||p.some(v=>!v||!/^[A-Za-z0-9_-]+$/.test(v))||strictJson(Buffer.from(p[1],'base64url').toString('utf8'))?.role!==role)throw Error();}
// Internal shared shape has no listener, certificate paths, environment lookup or authority defaults.
export function validateGuardApplicationConfiguration(value){
 try{
  if(!exact(value,['deployment_id','public_origin','auth','issuer','allow_local_auth','receiver_enabled','mail_recipients'])||!(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/).test(value.deployment_id)||typeof value.allow_local_auth!=='boolean'||typeof value.receiver_enabled!=='boolean')throw Error();
  const c=structuredClone(value),u=new URL(c.public_origin),a=new URL(c.auth?.origin);
  if(!safe(c.public_origin,256)||u.origin!==c.public_origin||u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash||!exact(c.auth,['origin','publishable_key','server_key'])||!safe(c.auth.publishable_key,16384)||!safe(c.auth.server_key,16384)||a.origin!==c.auth.origin||a.username||a.password||a.pathname!=='/'||a.search||a.hash||(a.protocol!=='https:'&&!(c.allow_local_auth&&c.auth.origin==='http://127.0.0.1:55321')))throw Error();
  if(!exact(c.issuer,['issuer','audience','key_id'])||!safe(c.issuer.issuer,256)||!(/^[A-Za-z0-9._:/-]{1,128}$/).test(c.issuer.audience)||!(/^[A-Za-z0-9_-]{1,64}$/).test(c.issuer.key_id))throw Error();
  apiKey(c.auth.publishable_key,'anon');apiKey(c.auth.server_key,'service_role');
  if(c.mail_recipients!==null&&(!Array.isArray(c.mail_recipients)||c.mail_recipients.length>25||new Set(c.mail_recipients).size!==c.mail_recipients.length||c.mail_recipients.some(v=>typeof v!=='string'||v.length>254||v!==v.toLowerCase()||/[\u0000-\u0020\u007f-\uffff]/.test(v)||!/^\S+@\S+\.\S+$/.test(v))))throw Error();
  return c;
 }catch{throw Error('Guard application configuration invalid');}
}
const reply=(status,error)=>new Response(JSON.stringify({error}),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
// This composition deliberately has no legacy authorizations-table/SQLite fallback.
export function createGuardApplication({configuration,pool,directory,devices,grantIssuer,store,dispatch,shiftLifecycle,admin,escalations,locationConsents,receiver=null,fetchImpl=fetch}){
 const c=validateGuardApplicationConfiguration(configuration);
 if(!pool||!directory||!devices||!grantIssuer||!store||!dispatch||!shiftLifecycle||!admin||!escalations||!locationConsents||[devices,grantIssuer,escalations,locationConsents].some(v=>v.audience!==c.issuer.audience)||grantIssuer.issuer!==c.issuer.issuer||grantIssuer.keyId!==c.issuer.key_id)throw Error('Complete configured Guard components required');
 if(c.receiver_enabled?typeof receiver?.observations!=='function'||typeof receiver?.media!=='function':receiver!==null)throw Error('Explicit configured receiver composition required');
 const auth={url:c.auth.origin,publishableKey:c.auth.publishable_key,allowLocal:c.allow_local_auth,loadSession:createPostgresAuthSessionReader(pool),fetchImpl};
 const verifySession=createSupabaseSessionVerifier(auth),passwordSession=createPasswordSession(auth),credentials=createAccountCredentials({...auth,verifySession});
 const accountCredentials=c.mail_recipients===null?credentials:{...credentials,sendCode:async(email,intent)=>{if(!c.mail_recipients.includes(email))throw Error('Account recipient unavailable');return credentials.sendCode(email,intent);},setPassword:async(email,code,password)=>{if(!c.mail_recipients.includes(email))throw Error('Account recipient unavailable');return credentials.setPassword(email,code,password);}};
 const account=createAccountHandler({credentials:accountCredentials,consumeAttempt:createPostgresLoginLimiter(pool)}),logout=createSessionLogoutHandler({...auth,verifySession});
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
