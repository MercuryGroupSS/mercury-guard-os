import {createGuardResolver} from './guard-directory.mjs';
import {photoMetadata} from './photo-metadata.mjs';
export function createEvidenceHandler({verifySession,directory,devices,grantIssuer,store,now=Date.now}){
 const resolve=createGuardResolver({loadGuardsForSubject:s=>directory.loadGuardsForSubject(s),loadVendor:id=>directory.loadVendor(id)});
 const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
 return async request=>{
  const path=new URL(request.url).pathname;
  const route=/^\/v1\/evidence\/([0-9a-f-]{36})$/.exec(path);if(!route)return reply(404,{error:'not_found'});
  if(request.method!=='POST')return reply(405,{error:'method_not_allowed'});
  if(request.headers.get('content-type')!=='image/jpeg')return reply(415,{error:'jpeg_required'});
  const header=request.headers.get('authorization')??'',match=header.length<=16384?/^Bearer ([^\s]+)$/.exec(header):null;
  if(!match)return reply(401,{error:'authentication_required'});
  let identity,record,meta;
  async function authorized(){
   const saved=await grantIssuer.lookup(record.event.data.capture_grant_id),scope=record.scope;
   if(!saved||saved.subject!==identity.subject||saved.vendorId!==identity.vendorId||record.vendor_id!==identity.vendorId||!saved.claims.actions.includes('photo'))return false;
   const c=saved.claims;
   if(c.guard_id!==scope.guard_id||c.site_id!==scope.site_id||c.assignment_id!==scope.assignment_id||c.device_thumbprint!==scope.device_thumbprint||c.revocation_version!==scope.revocation_version||record.event.at<c.not_before_ms||record.event.at>=c.expires_at_ms)return false;
   const d=await devices.deviceByThumbprint(scope.device_thumbprint);if(!d)return false;
   return devices.authorizes(identity,{guardId:scope.guard_id,siteId:scope.site_id,assignmentId:scope.assignment_id,thumbprint:scope.device_thumbprint,publicKeySpki:d.publicKeySpki,revocationVersion:scope.revocation_version},now(),true);
  }
  let expires;
  try{
   const session=await verifySession(match[1]);if(!session||!Number.isSafeInteger(session.expiresAt)||session.expiresAt*1000<=now())return reply(401,{error:'authentication_required'});
   expires=session.expiresAt*1000;identity=await resolve(session);if(!identity)return reply(403,{error:'evidence_unavailable'});
   record=await store.photoForGuard(identity.guardId,route[1]);if(!record||!await authorized())return reply(403,{error:'evidence_unavailable'});
   meta=photoMetadata(record.event.data);
  }catch{return reply(503,{error:'evidence_unavailable'});}
  const reader=request.body?.getReader();if(!reader)return reply(400,{error:'body_required'});
  try{
   const chunks=[];let size=0;
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>meta.bytes){await reader.cancel();return reply(413,{error:'evidence_too_large'});}chunks.push(Buffer.from(value));}
   // Access can change during upload. Recheck both roster and grant/device state.
   const current=await resolve({subject:identity.subject,active:true});
   if(!current||current.guardId!==identity.guardId||current.vendorId!==identity.vendorId||expires<=now()||!await authorized())return reply(403,{error:'evidence_unavailable'});
   return reply(200,await store.retainPhoto(record,Buffer.concat(chunks),now()));
  }catch{return reply(400,{error:'evidence_rejected'});}
  finally{reader.releaseLock();}
 };
}
