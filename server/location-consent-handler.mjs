import {strictJson} from './verify-batch.mjs';
import {locationExact} from './location-policy.mjs';
import {LocationInputError,LocationAuthError,LocationDeniedError,LocationConflictError} from './location-consent-input.mjs';
const paths=new Set(['/v1/location-consents','/v1/location-consents/challenge','/v1/location-consents/status']);
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
export function createLocationConsentHandler({verifySession,store,now=Date.now}){
 if(typeof verifySession!=='function'||['challenge','receive','status'].some(k=>typeof store?.[k]!=='function'))throw Error('Protected location consent dependencies required');
 return async request=>{
  const url=new URL(request.url);if(!paths.has(url.pathname))return reply(404,{error:'not_found'});if(url.search)return reply(400,{error:'invalid_location_request'});if(request.method!=='POST')return reply(405,{error:'method_not_allowed'});if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return reply(415,{error:'json_required'});
  const header=request.headers.get('authorization')??'',token=header.length<=16384?/^Bearer ([^\s]+)$/.exec(header)?.[1]:null;if(!token)return reply(401,{error:'authentication_required'});
  let session;try{session=await verifySession(token);if(session?.active!==true||!Number.isSafeInteger(session.expiresAt)||session.expiresAt*1000<=now())return reply(401,{error:'authentication_required'});}catch{return reply(503,{error:'location_authorization_unavailable'});}
  try{
   const reader=request.body?.getReader();if(!reader)return reply(400,{error:'invalid_location_request'});let size=0;const chunks=[];try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();return reply(413,{error:'location_body_too_large'});}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
   let body;try{body=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));if(url.pathname==='/v1/location-consents')locationExact(body,['intent','proof']);else if(url.pathname.endsWith('/status'))locationExact(body,['consent_id','proof']);else locationExact(body,['device_id','consent_id']);}catch{return reply(400,{error:'invalid_location_request'});}
   if(url.pathname.endsWith('/challenge'))return reply(200,await store.challenge(session,body));if(url.pathname.endsWith('/status')){const value=await store.status(session,body.consent_id,body.proof);return value?reply(200,value):reply(404,{error:'location_consent_unavailable'});}return reply(200,await store.receive(session,body.intent,body.proof));
  }catch(error){if(error instanceof LocationAuthError)return reply(401,{error:'authentication_required'});if(error instanceof LocationDeniedError)return reply(403,{error:'location_consent_access_unavailable'});if(error instanceof LocationConflictError)return reply(409,{error:'location_consent_request_conflict'});if(error instanceof LocationInputError)return reply(400,{error:'invalid_location_request'});return reply(503,{error:'location_consent_service_unavailable'});}
 };
}
