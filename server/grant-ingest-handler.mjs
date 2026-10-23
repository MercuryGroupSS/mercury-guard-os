import {reconcileCheckIns} from './check-in-status.mjs';
import {validateCheckIn,validateMissReason} from './check-in-policy.mjs';
import {photoMetadata} from './photo-metadata.mjs';
import {permitsCheckpoint} from './patrol-route.mjs';
import {strictJson,verifyScopedBatch} from './verify-batch.mjs';
import {createGuardResolver} from './guard-directory.mjs';
const required={dispatch_ack:'dispatch_ack',incident:'incident',patrol_checkpoint:'patrol',check_in:'check_in',check_in_miss_reason:'check_in',photo_evidence:'photo',location:'location'};
// Candidate IDs only select server records. Signature and every capture grant are checked before storage.
export function createGrantIngestHandler({verifySession,directory,devices,grantIssuer,store,dispatch,shiftLifecycle,now=Date.now}){
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
    guardId:c.guard_id,siteId:c.site_id,assignmentId:c.assignment_id,revocationVersion:c.revocation_version,vendorId:first.vendorId,allowHistoricalSequence:true,receivedAtMs:at,
    notBefore:seconds,expiresAt:Math.min(seconds+60,session.expiresAt),allowedKinds:Object.keys(required)};
   if(!await devices.authorizes(identity,context,at,true))throw Error('Device or assignment unavailable');
   const {batch}=verifyScopedBatch(raw,context,seconds);
   for(const event of batch.events){
    const saved=grantIssuer.lookup(event.data.capture_grant_id),g=saved?.claims;
    if(!g||saved.subject!==identity.subject||saved.vendorId!==identity.vendorId||g.issuer!==c.issuer||g.audience!==c.audience||g.guard_id!==c.guard_id||g.site_id!==c.site_id||g.assignment_id!==c.assignment_id||g.device_thumbprint!==c.device_thumbprint||g.revocation_version!==c.revocation_version||!g.actions.includes(required[event.kind])||event.at<g.not_before_ms||event.at>=g.expires_at_ms||event.at>at)throw Error('Capture grant mismatch');
    if(shiftLifecycle&&!shiftLifecycle.permitsCapture({guardId:c.guard_id,vendorId:first.vendorId,siteId:c.site_id,assignmentId:c.assignment_id,deviceThumbprint:c.device_thumbprint},event.at))throw Error('Observation outside confirmed shift');
    if(event.kind==='dispatch_ack'){if(!dispatch)throw Error('Dispatch unavailable');dispatch.validateAcknowledgement({guardId:c.guard_id,vendorId:first.vendorId,siteId:c.site_id,assignmentId:c.assignment_id},event);}
    if(event.kind==='photo_evidence')photoMetadata(event.data);
    if(event.kind==='patrol_checkpoint'&&!permitsCheckpoint(saved.policy.patrolRoute,event.data))throw Error('Checkpoint not authorized');
   }
   // Resolve photo links only after every supplied event has passed its capture grant.
   for(const event of batch.events)if(event.kind==='check_in'){
    const saved=grantIssuer.lookup(event.data.capture_grant_id);
    const linked=batch.events.find(e=>e.event_id===event.data.photo_event_id);
    const photo=linked?{scope:batch.scope,event:linked,vendor_id:identity.vendorId}:store.photoForGuard(identity.guardId,event.data.photo_event_id);
    if(photo?.vendor_id!==identity.vendorId)throw Error('Photo vendor mismatch');
    if(photo&&!grantIssuer.lookup(photo.event.data.capture_grant_id))throw Error('Photo grant unavailable');
    validateCheckIn(saved.policy.checkInPolicy,event,photo,batch.scope);
   }
   for(const event of batch.events)if(event.kind==='check_in_miss_reason'){
    const policy=grantIssuer.lookup(event.data.capture_grant_id).policy.checkInPolicy;
    validateMissReason(policy,event);
    const assignment={guardId:c.guard_id,vendorId:first.vendorId,siteId:c.site_id,assignmentId:c.assignment_id,startsAt:policy.starts_at,endsAt:policy.ends_at,checkInPolicy:policy};
    reconcileCheckIns(store,assignment,at,{activeWindow:shiftLifecycle?.checkInWindow(assignment)});
    if(!store.db.prepare('SELECT 1 FROM missed_check_ins WHERE guard=? AND assignment=? AND revision=? AND slot=?').get(c.guard_id,c.assignment_id,policy.revision,event.data.slot))throw Error('No missed delivery deadline');
   }
   return reply(200,store.ingest(raw,context,seconds));
  }catch{return reply(400,{error:'batch_rejected'});}
  finally{reader.releaseLock();}
 };
}
