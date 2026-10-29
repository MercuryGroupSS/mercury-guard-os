import {createHash,createPublicKey,sign,verify} from 'node:crypto';
import {strictJson} from './verify-batch.mjs';
import {parseEnrollmentKey,decodeEnrollmentValue} from './enrollment-key.mjs';
import {createGuardResolver} from './guard-directory.mjs';
import {CurrentAuthSessionError,createPostgresAuthSessionReader} from './postgres-auth-session.mjs';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.slice().sort().join();
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const secret=v=>typeof v==='string'&&v.length>=1&&v.length<=16384&&!/\s/.test(v);
const digest=v=>createHash('sha256').update(v).digest('hex');
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
export class PersonalSessionDenied extends Error{}
// A domain-separated issuer signature binds one actual provider session to one
// approved personal installation. It is neither a shift grant nor a biometric claim.
export function createPersonalPermitCodec({key,keyId,issuer,audience,origin,now=Date.now}){
 const publicKey=createPublicKey(key),domain=`mercury-personal-session-v1.${keyId}.`;
 function read(value){try{
  if(!exact(value,['payload','signature'])||typeof value.payload!=='string'||value.payload.length>4096||!/^[A-Za-z0-9_-]+$/.test(value.payload))throw new PersonalSessionDenied();
  const bytes=Buffer.from(value.payload,'base64url');if(bytes.toString('base64url')!==value.payload||!verify('sha256',Buffer.from(domain+value.payload),publicKey,decodeEnrollmentValue(value.signature,512)))throw new PersonalSessionDenied();
  const c=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!exact(c,['version','issuer','audience','origin','subject','session_id','guard_id','vendor_id','device_id','thumbprint','revocation_version','issued_at_ms','expires_at_ms','refresh_sha256'])||!/^[a-f0-9]{64}$/.test(c.refresh_sha256)||c.version!==1||c.issuer!==issuer||c.audience!==audience||c.origin!==origin||!uuid(c.subject)||!uuid(c.session_id)||![c.guard_id,c.vendor_id,c.device_id].every(id)||!/^[a-f0-9]{64}$/.test(c.thumbprint)||!Number.isSafeInteger(c.revocation_version)||c.revocation_version<0||!Number.isSafeInteger(c.issued_at_ms)||!Number.isSafeInteger(c.expires_at_ms)||c.issued_at_ms<=0||c.issued_at_ms>now()||c.expires_at_ms<=now()||c.expires_at_ms-c.issued_at_ms!==30*86400000)throw new PersonalSessionDenied();
  return c;
 }catch{throw new PersonalSessionDenied();}}
 return {read,renew(claims,refresh){const c={...claims,refresh_sha256:digest(refresh)},payload=Buffer.from(JSON.stringify(c)).toString('base64url');const value={payload,signature:sign('sha256',Buffer.from(domain+payload),key).toString('base64url')};read(value);return value;},issue({identity,device,session,refresh}){
  const issued=now(),c={version:1,issuer,audience,origin,subject:identity.subject,session_id:session.sessionId,guard_id:identity.guardId,vendor_id:identity.vendorId,device_id:device.deviceId,thumbprint:device.thumbprint,revocation_version:device.revocationVersion,issued_at_ms:issued,expires_at_ms:issued+30*86400000,refresh_sha256:digest(refresh)};
  const payload=Buffer.from(JSON.stringify(c)).toString('base64url');const result={payload,signature:sign('sha256',Buffer.from(domain+payload),key).toString('base64url')};read(result);return result;
 }};
}
export function personalLoginMessage(audience,guard,device,at,requestId,thumb){return `mercury-personal-login-v1\n${audience}\n${guard}\n${device}\n${at}\n${requestId}\n${thumb}`;}
export function personalRefreshMessage(audience,requestId,nonce,thumb,permit,refresh){return `mercury-personal-refresh-v1\n${audience}\n${requestId}\n${nonce}\n${thumb}\n${digest(permit.payload+'.'+permit.signature)}\n${digest(refresh)}`;}
export function createPersonalSessionHandler({directory,devices,pool,grantIssuer,verifySession,passwordSession,refreshSession,origin,now=Date.now}){
 const codec=createPersonalPermitCodec({key:grantIssuer.key,keyId:grantIssuer.keyId,issuer:grantIssuer.issuer,audience:grantIssuer.audience,origin,now});
 const resolve=createGuardResolver({loadGuardsForSubject:s=>directory.loadGuardsForSubject(s),loadVendor:v=>directory.loadVendor(v)}),loadSession=createPostgresAuthSessionReader(pool);
 const denied=()=>{throw new PersonalSessionDenied();};
 async function current(c){
  const identity=await resolve({subject:c.subject,active:true}),device=await devices.device(c.device_id);
  if(!identity||identity.guardId!==c.guard_id||identity.vendorId!==c.vendor_id||!device||device.mode!=='personal'||device.guardId!==c.guard_id||!device.active||device.revoked||device.thumbprint!==c.thumbprint||device.revocationVersion!==c.revocation_version||!await loadSession(c.subject,c.session_id))denied();
  return {identity,device,session:{subject:c.subject,sessionId:c.session_id,active:true,expiresAt:Math.floor(c.expires_at_ms/1000)}};
 }
 async function checkedResult(result,claims){
  const verified=result&&await verifySession(result.access_token);
  if(!verified||verified.subject!==claims.subject||verified.sessionId!==claims.session_id||!secret(result.refresh_token))denied();
  await current(claims);return {access_token:result.access_token,expires_at:verified.expiresAt,refresh_token:result.refresh_token,server_time_ms:now()};
 }
 return async request=>{
  const u=new URL(request.url),operation=u.pathname.slice('/v1/session/personal/'.length);
  if(!['login','challenge','refresh'].includes(operation))return reply(404,{error:'not_found'});
  if(request.method!=='POST')return reply(405,{error:'method_not_allowed'});
  if(u.search||request.headers.has('authorization'))return reply(400,{error:'invalid_request'});
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return reply(415,{error:'json_required'});
  let body;const reader=request.body?.getReader();if(!reader)return reply(400,{error:'invalid_request'});
  try{const chunks=[];let size=0;while(true){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>32768){await reader.cancel();return reply(413,{error:'body_too_large'});}chunks.push(Buffer.from(value));}body=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
  catch{return reply(400,{error:'invalid_request'});}finally{reader.releaseLock();}
  try{
   if(operation==='login'){
    if(!exact(body,['guard_id','password','device_id','proof'])||!id(body.guard_id)||!id(body.device_id)||typeof body.password!=='string'||body.password.length<1||body.password.length>1024||!exact(body.proof,['issued_at_ms','request_id','thumbprint','signature_der'])||!Number.isSafeInteger(body.proof.issued_at_ms)||Math.abs(body.proof.issued_at_ms-now())>60000||!uuid(body.proof.request_id))return reply(400,{error:'invalid_request'});
    if(!await directory.consumeLoginAttempt(digest(body.guard_id),now()))return reply(429,{error:'try_again_later'});
    const account=await directory.loginAccount(body.guard_id),loadedDevice=await devices.device(body.device_id),device=loadedDevice?{...loadedDevice}:null;
    if(!account||!device||device.mode!=='personal'||device.guardId!==body.guard_id||!device.active||device.revoked||body.proof.thumbprint!==device.thumbprint)denied();
    let valid=false;try{valid=verify('sha256',Buffer.from(personalLoginMessage(grantIssuer.audience,body.guard_id,body.device_id,body.proof.issued_at_ms,body.proof.request_id,device.thumbprint)),parseEnrollmentKey(device.publicKeySpki).key,decodeEnrollmentValue(body.proof.signature_der,80));}catch{}if(!valid)denied();
    const result=await passwordSession({...account,password:body.password}),verified=result&&await verifySession(result.access_token),identity=verified&&await resolve(verified),mapping=await directory.loginAccount(body.guard_id);
    if(!identity||identity.guardId!==body.guard_id||verified.subject!==account.subject||mapping?.subject!==account.subject||mapping?.email!==account.email||!secret(result.refresh_token))denied();
    const permit=codec.issue({identity,device,session:verified,refresh:result.refresh_token}),claims=codec.read(permit);
    return reply(200,{...await checkedResult(result,claims),permit});
   }
   if(!exact(body,operation==='challenge'?['permit']:['permit','refresh_token','proof']))return reply(400,{error:'invalid_request'});
   const claims=codec.read(body.permit);
   const state=await current(claims);
   if(operation==='challenge'){
    if(!await directory.consumeLoginAttempt(digest('personal:'+claims.device_id+':'+claims.subject+':'+Math.floor(now()/60000)),now()))return reply(429,{error:'try_again_later'});
    return reply(200,await devices.challenge(state.identity,claims.device_id,now(),state.session));
   }
   if(!secret(body.refresh_token))return reply(400,{error:'invalid_request'});
   if(digest(body.refresh_token)!==claims.refresh_sha256)denied();
   const message=personalRefreshMessage(grantIssuer.audience,body.proof?.request_id,body.proof?.challenge,claims.thumbprint,body.permit,body.refresh_token);
   await devices.consumePersonalChallenge(state.identity,state.device,body.proof,message,now(),state.session);
   const result=await refreshSession(body.refresh_token),checked=await checkedResult(result,claims);return reply(200,{...checked,permit:codec.renew(claims,result.refresh_token)});
  }catch(error){const denial=error instanceof PersonalSessionDenied||error instanceof CurrentAuthSessionError;return reply(denial?401:503,{error:denial?'sign_in_failed':'sign_in_unavailable'});}
  finally{if(body&&typeof body==='object'){if('password'in body)body.password='';if('refresh_token'in body)body.refresh_token='';}}
 };
}
