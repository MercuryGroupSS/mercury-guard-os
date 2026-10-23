import {strictJson,verifyScopedBatch} from './verify-batch.mjs';
import {createGuardResolver} from './guard-directory.mjs';
const required={incident:'incident',patrol_checkpoint:'patrol',check_in:'check_in',photo_evidence:'photo',location:'location'};
// Candidate IDs only select server records. Signature and every capture grant are checked before storage.
export function createGrantIngestHandler({verifySession,directory,devices,grantIssuer,store,now=Date.now}){
 const resolve=createGuardResolver({loadGuardsForSubject:s=>directory.loadGuardsForSubject(s),loadVendor:id=>directory.loadVendor(id)});
 const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
 return async request=>{
  if(new URL(request.url).pathname!=='/v2/batches')return reply(404,{error:'not_found'});
  if(request.method!=='POST')return reply(405,{error:'method_not_allowed'});
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return reply(415,{error:'json_required'});
  const header=request.headers.get('authorization')??'',match=header.length<=16384?/^Bearer ([^\s]+)$/.exec(header):null;
  if(!match)return reply(401,{error:'authentication_required'});
  let session,identity;
  try{session=await verifySession(match[1]);if(!session||!Number.isSafeInteger(session.expiresAt)||session.expiresAt*1000<=now())return reply(401,{error:'authentication_required'});identity=await resolve(session);if(!identity)return reply(401,{error:'authentication_required'});}
  catch{return reply(503,{error:'authorization_unavailable'});}
  const reader=request.body?.getReader();if(!reader)return reply(400,{error:'body_required'});
  try{
   const chunks=[];let size=0;
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>360000){await reader.cancel();return reply(413,{error:'body_too_large'});}chunks.push(Buffer.from(value));}
   const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
   const envelope=strictJson(raw);
   if(typeof envelope.payload!=='string'||envelope.payload.length>351000||typeof envelope.public_key_spki!=='string')throw Error('Invalid envelope');
   const candidate=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(envelope.payload,'base64url')));
   const grantId=candidate?.events?.[0]?.data?.capture_grant_id;
   const first=grantIssuer.lookup(grantId);
   if(!first||first.subject!==identity.subject||first.vendorId!==identity.vendorId)throw Error('Grant unavailable');
   const c=first.claims,at=now(),seconds=Math.floor(at/1000);
   const context={enrolled:true,revoked:false,audience:c.audience,thumbprint:c.device_thumbprint,publicKeySpki:envelope.public_key_spki,
    guardId:c.guard_id,siteId:c.site_id,assignmentId:c.assignment_id,revocationVersion:c.revocation_version,vendorId:first.vendorId,
    notBefore:seconds,expiresAt:Math.min(seconds+60,session.expiresAt),allowedKinds:Object.keys(required)};
   if(!devices.authorizes(identity,context,at,true))throw Error('Device or assignment unavailable');
   const {batch}=verifyScopedBatch(raw,context,seconds);
   for(const event of batch.events){
    const saved=grantIssuer.lookup(event.data.capture_grant_id),g=saved?.claims;
    if(!g||saved.subject!==identity.subject||saved.vendorId!==identity.vendorId||g.issuer!==c.issuer||g.audience!==c.audience||g.guard_id!==c.guard_id||g.site_id!==c.site_id||g.assignment_id!==c.assignment_id||g.device_thumbprint!==c.device_thumbprint||g.revocation_version!==c.revocation_version||!g.actions.includes(required[event.kind])||event.at<g.not_before_ms||event.at>=g.expires_at_ms||event.at>at)throw Error('Capture grant mismatch');
   }
   return reply(200,store.ingest(raw,context,seconds));
  }catch{return reply(400,{error:'batch_rejected'});}
  finally{reader.releaseLock();}
 };
}
