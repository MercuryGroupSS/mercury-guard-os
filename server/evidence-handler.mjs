import {createGuardResolver} from './guard-directory.mjs';
import {photoMetadata} from './photo-metadata.mjs';
import {photoHash,photoChunkSize,evidenceChunkMessage} from './photo-chunks.mjs';
import {strictJson} from './verify-batch.mjs';
import {verify} from 'node:crypto';
import {parseEnrollmentKey,decodeEnrollmentValue} from './enrollment-key.mjs';
export function createEvidenceHandler({verifySession,directory,devices,grantIssuer,store,now=Date.now}){
 const resolve=createGuardResolver({loadGuardsForSubject:s=>directory.loadGuardsForSubject(s),loadVendor:id=>directory.loadVendor(id)});
 const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
 return async request=>{
  const url=new URL(request.url),path=url.pathname;
  const route=/^\/v1\/evidence\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/(chunks)\/(0|[1-9][0-9]?)|\/(finalize))?$/.exec(path);if(!route)return reply(404,{error:'not_found'});
  if(url.search)return reply(400,{error:'invalid_request'});
  if(request.method!=='POST')return reply(405,{error:'method_not_allowed'});
  const chunk=route[2]==='chunks',finalize=route[4]==='finalize',index=chunk?Number(route[3]):null;
  if(request.headers.get('content-type')!==(chunk?'application/octet-stream':finalize?'application/json':'image/jpeg'))return reply(415,{error:'content_type_required'});
  if((chunk||finalize)&&(typeof store.retainPhotoChunk!=='function'||typeof store.finalizePhotoChunks!=='function'))return reply(501,{error:'chunk_transfer_unavailable'});
  const header=request.headers.get('authorization')??'',match=header.length<=16384?/^Bearer ([^\s]+)$/.exec(header):null;
  if(!match)return reply(401,{error:'authentication_required'});
  let identity,record,meta,chunkAudience,chunkKey;
  async function authorized(){
   const saved=await grantIssuer.lookup(record.event.data.capture_grant_id),scope=record.scope;
   if(!saved||saved.subject!==identity.subject||saved.vendorId!==identity.vendorId||record.vendor_id!==identity.vendorId||!saved.claims.actions.includes('photo'))return false;
   const c=saved.claims;
   if(c.guard_id!==scope.guard_id||c.site_id!==scope.site_id||c.assignment_id!==scope.assignment_id||c.device_thumbprint!==scope.device_thumbprint||c.revocation_version!==scope.revocation_version||record.event.at<c.not_before_ms||record.event.at>=c.expires_at_ms)return false;
   const d=await devices.deviceByThumbprint(scope.device_thumbprint);if(!d)return false;chunkAudience=c.audience;chunkKey=d.publicKeySpki;
   return devices.authorizes(identity,{guardId:scope.guard_id,siteId:scope.site_id,assignmentId:scope.assignment_id,thumbprint:scope.device_thumbprint,publicKeySpki:d.publicKeySpki,revocationVersion:scope.revocation_version},now(),true);
  }
  let expires,originalSession;
  try{
   const session=await verifySession(match[1]);if(!session||!Number.isSafeInteger(session.expiresAt)||session.expiresAt*1000<=now())return reply(401,{error:'authentication_required'});
   expires=session.expiresAt*1000;originalSession=session;identity=await resolve(session);if(!identity)return reply(403,{error:'evidence_unavailable'});
   record=await store.photoForGuard(identity.guardId,route[1]);if(!record||!await authorized())return reply(403,{error:'evidence_unavailable'});
   meta=photoMetadata(record.event.data);
  }catch{return reply(503,{error:'evidence_unavailable'});}
  let expected=meta.bytes;
  try{if(chunk){expected=photoChunkSize(meta,index);if(!/^[a-f0-9]{64}$/.test(request.headers.get('x-mercury-chunk-sha256')??''))return reply(400,{error:'chunk_digest_required'});}}catch{return reply(400,{error:'chunk_index_invalid'});}
  if(chunk)try{
   const key=parseEnrollmentKey(chunkKey);if(key.thumbprint!==record.scope.device_thumbprint||!verify('sha256',Buffer.from(evidenceChunkMessage(record,meta,index,request.headers.get('x-mercury-chunk-sha256'),expected,chunkAudience)),key.key,decodeEnrollmentValue(request.headers.get('x-mercury-chunk-signature'),80)))return reply(403,{error:'chunk_proof_required'});
  }catch{return reply(403,{error:'chunk_proof_required'});}
  const reader=request.body?.getReader();if(!reader)return reply(400,{error:'body_required'});
  try{
   const chunks=[];let size=0;
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>(finalize?128:expected)){await reader.cancel();return reply(413,{error:'evidence_too_large'});}chunks.push(Buffer.from(value));}
   const bytes=Buffer.concat(chunks);
   if(chunk&&(bytes.length!==expected||photoHash(bytes)!==request.headers.get('x-mercury-chunk-sha256')))return reply(400,{error:'chunk_digest_mismatch'});
   if(finalize){const input=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).length)return reply(400,{error:'invalid_finalization'});}
   // Access can change during upload. Recheck both roster and grant/device state.
   const current=await resolve({subject:identity.subject,active:true});
   const live=await verifySession(match[1]);
   if(!live||live.subject!==originalSession.subject||live.sessionId!==originalSession.sessionId||!current||current.guardId!==identity.guardId||current.vendorId!==identity.vendorId||expires<=now()||!await authorized())return reply(403,{error:'evidence_unavailable'});
   return reply(200,chunk?await store.retainPhotoChunk(record,index,bytes,now(),live):finalize?await store.finalizePhotoChunks(record,now(),live):await store.retainPhoto(record,bytes,now(),live));
  }catch{return reply(400,{error:'evidence_rejected'});}
  finally{reader.releaseLock();}
 };
}
