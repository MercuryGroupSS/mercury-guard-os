import {createPrivateKey,createPublicKey,createHash,X509Certificate} from 'node:crypto';
import {strictJson} from './verify-batch.mjs';
import {validateOpsSourceConfig} from './ops-source-config.mjs';
import {createDashboardRouter,createDashboardMediaRouter} from './dashboard-router.mjs';

const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.sort().join();
const safe=(v,max=16384)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const fail=()=>{throw Error('Netlify Guard configuration invalid');};
function origin(value){const u=new URL(value);if(!safe(value,256)||u.protocol!=='https:'||u.origin!==value||u.username||u.password||u.pathname!=='/'||u.search||u.hash)fail();return value;}
function apiKey(value,role){
 if(!safe(value)||/\s/.test(value))fail();if(value.startsWith(role==='anon'?'sb_publishable_':'sb_secret_'))return value;
 const p=value.split('.');if(p.length!==3||p.some(v=>!v||!/^[A-Za-z0-9_-]+$/.test(v))||strictJson(Buffer.from(p[1],'base64url').toString('utf8'))?.role!==role)fail();return value;
}
function recipients(value=[]){
 if(!Array.isArray(value)||value.length>25||new Set(value).size!==value.length||value.some(v=>typeof v!=='string'||v.length>254||v!==v.toLowerCase()||/[\u0000-\u0020\u007f-\uffff]/.test(v)||!/^\S+@\S+\.\S+$/.test(v)))fail();return structuredClone(value);
}
function publicConfiguration(value){
 const fields=['version','deployment_id','public_origin','platform','auth','database','issuer','workers','ops_refresh','dashboard_delivery','dashboard_receiver'];
 if(!exact(value,Object.hasOwn(value??{},'mail_recipients')?[...fields,'mail_recipients']:fields)||value.version!==1||!uuid(value.deployment_id))fail();
 const c=structuredClone(value);origin(c.public_origin);
 if(!exact(c.platform,['site_id','deployment_context'])||!uuid(c.platform.site_id)||c.platform.deployment_context!=='production')fail();
 if(!exact(c.auth,['origin','publishable_key']))fail();origin(c.auth.origin);apiKey(c.auth.publishable_key,'anon');
 if(!exact(c.database,['connection_mode'])||!['session','direct'].includes(c.database.connection_mode))fail();
 if(!exact(c.issuer,['issuer','audience','key_id'])||!safe(c.issuer.issuer,256)||!(/^[A-Za-z0-9._:/-]{1,128}$/).test(c.issuer.audience)||!(/^[A-Za-z0-9_-]{1,64}$/).test(c.issuer.key_id))fail();
 if(!exact(c.workers,['batch_size','max_duration_ms'])||!Number.isSafeInteger(c.workers.batch_size)||c.workers.batch_size<1||c.workers.batch_size>20||!Number.isSafeInteger(c.workers.max_duration_ms)||c.workers.max_duration_ms<1000||c.workers.max_duration_ms>25000)fail();
 if(c.ops_refresh!==null)validateOpsSourceConfig(c.ops_refresh);
 if(typeof c.dashboard_delivery!=='boolean'||typeof c.dashboard_receiver!=='boolean')fail();c.mail_recipients=recipients(c.mail_recipients);return c;
}
function secret(get,name,max=65536,{optional=false}={}){
 const value=get(name);if(optional&&(value===undefined||value===null||value===''))return undefined;
 if(typeof value!=='string'||Buffer.byteLength(value)>max||value.length<1)fail();return value;
}
function receiver(value,config){
 if(!exact(value,['version','destination','token'])||value.version!==1||typeof value.destination!=='string'||!(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/).test(value.destination)||typeof value.token!=='string'||!(/^[\x21-\x7e]{32,4096}$/).test(value.token)||[config.auth.publishable_key,config.auth.server_key,config.ops_refresh?.server_key,config.ops_refresh?.schedule_token].includes(value.token))fail();
 return {destination:value.destination,token:value.token};
}
// Only this loader reads the platform environment. No process.env fallback, files, TLS keys,
// key generation, account creation, migrations or optional destination discovery.
export function readNetlifyEnvironment({get}={}){
 try{
  if(typeof get!=='function')fail();const c=publicConfiguration(strictJson(secret(get,'MERCURY_GUARD_NETLIFY_CONFIG',16384)));
  const auth={...c.auth,server_key:apiKey(secret(get,'MERCURY_GUARD_AUTH_SERVER_KEY',16384),'service_role')};
  const database={...c.database,url:secret(get,'MERCURY_GUARD_DATABASE_URL',8192)},db=new URL(database.url);
  if(!['postgres:','postgresql:'].includes(db.protocol)||!db.username||!db.password||db.search||db.hash||!/^\/[^/]+$/.test(db.pathname)||!db.hostname||database.connection_mode==='session'&&db.port!=='5432'||database.connection_mode==='direct'&&db.port&&db.port!=='5432')fail();
  const issuerKey=createPrivateKey(secret(get,'MERCURY_GUARD_ISSUER_PRIVATE_KEY',16384));
  if(issuerKey.asymmetricKeyType!=='rsa'||issuerKey.asymmetricKeyDetails.modulusLength<2048)fail();
  const issuerSpki=createPublicKey(issuerKey).export({type:'spki',format:'der'}),ca=secret(get,'MERCURY_GUARD_DATABASE_CA',65536,{optional:true});
  if(ca!==undefined){if(!ca.includes('-----BEGIN CERTIFICATE-----')||ca.includes('PRIVATE KEY'))fail();new X509Certificate(ca);}
  const config={...c,mode:'netlify',auth,database,ops_refresh:c.ops_refresh===null?null:c.ops_refresh.transport==='schedule_bridge'?{...c.ops_refresh,schedule_token:secret(get,'MERCURY_GUARD_OPS_SCHEDULE_TOKEN',128)}:{...c.ops_refresh,server_key:apiKey(secret(get,'MERCURY_GUARD_OPS_SERVER_KEY',16384),'service_role')},dashboard_delivery:null,dashboard_receiver:null};
  if(config.ops_refresh){validateOpsSourceConfig(config.ops_refresh,{credentials:true});if(config.ops_refresh.transport==='schedule_bridge'&&[auth.publishable_key,auth.server_key].includes(config.ops_refresh.schedule_token))fail();}
  if(c.dashboard_delivery){const d=strictJson(secret(get,'MERCURY_GUARD_DELIVERY_CONFIG',65536));if(!exact(d,['version','destinations'])||d.version!==1)fail();createDashboardRouter(d);createDashboardMediaRouter(d);if(d.destinations.some(v=>typeof v.token!=='string'||!(/^[\x21-\x7e]{32,4096}$/).test(v.token)||[auth.publishable_key,auth.server_key,config.ops_refresh?.server_key,config.ops_refresh?.schedule_token].includes(v.token)))fail();config.dashboard_delivery={destinations:d.destinations};}
  if(c.dashboard_receiver)config.dashboard_receiver=receiver(strictJson(secret(get,'MERCURY_GUARD_RECEIVER_CONFIG',16384)),config);
  return {config,materials:{issuerKey,issuerPublicKey:issuerSpki.toString('base64url'),issuerSha256:createHash('sha256').update(issuerSpki).digest('hex'),...(ca?{databaseCa:Buffer.from(ca)}:{})}};
 }catch{fail();}
}
// Revalidate normalized input as well: callers cannot bypass the env loader with a TLS-free
// local/pilot mode, transaction pooling, alternate Auth role or an unbounded worker pass.
export function validateNetlifyConfiguration(value,materials){
 try{
  const fields=['version','mode','deployment_id','public_origin','platform','auth','database','issuer','workers','ops_refresh','dashboard_delivery','dashboard_receiver','mail_recipients'];
  if(!exact(value,fields)||value.mode!=='netlify'||!exact(value.auth,['origin','publishable_key','server_key'])||!exact(value.database,['connection_mode','url'])||value.ops_refresh!==null&&!validateOpsSourceConfig(value.ops_refresh,{credentials:true}))fail();
  const c=structuredClone(value),base={...c,auth:{origin:c.auth.origin,publishable_key:c.auth.publishable_key},database:{connection_mode:c.database.connection_mode},ops_refresh:c.ops_refresh===null?null:Object.fromEntries(Object.entries(c.ops_refresh).filter(([key])=>!['server_key','schedule_token'].includes(key))),dashboard_delivery:c.dashboard_delivery!==null,dashboard_receiver:c.dashboard_receiver!==null};delete base.mode;
  const env={MERCURY_GUARD_NETLIFY_CONFIG:JSON.stringify(base),MERCURY_GUARD_AUTH_SERVER_KEY:c.auth.server_key,MERCURY_GUARD_DATABASE_URL:c.database.url,MERCURY_GUARD_ISSUER_PRIVATE_KEY:materials?.issuerKey?.export({type:'pkcs8',format:'pem'}),MERCURY_GUARD_DATABASE_CA:materials?.databaseCa?.toString('utf8'),MERCURY_GUARD_OPS_SERVER_KEY:c.ops_refresh?.server_key,MERCURY_GUARD_OPS_SCHEDULE_TOKEN:c.ops_refresh?.schedule_token,MERCURY_GUARD_DELIVERY_CONFIG:c.dashboard_delivery===null?undefined:JSON.stringify({version:1,...c.dashboard_delivery}),MERCURY_GUARD_RECEIVER_CONFIG:c.dashboard_receiver===null?undefined:JSON.stringify({version:1,...c.dashboard_receiver})};
  const checked=readNetlifyEnvironment({get:name=>env[name]});if(checked.materials.issuerSha256!==materials?.issuerSha256||checked.materials.issuerPublicKey!==materials?.issuerPublicKey)fail();return checked.config;
 }catch{fail();}
}
