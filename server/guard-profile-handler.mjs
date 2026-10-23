import {createGuardResolver} from './guard-directory.mjs';
export function createGuardProfileHandler({verifySession,directory,now=()=>Math.floor(Date.now()/1000)}) {
 const resolve=createGuardResolver({loadGuardsForSubject:s=>directory.loadGuardsForSubject(s),loadVendor:id=>directory.loadVendor(id)});
 const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
 return async request=>{
  if(new URL(request.url).pathname!=='/v1/me')return reply(404,{error:'not_found'});
  if(request.method!=='GET')return reply(405,{error:'method_not_allowed'});
  const header=request.headers.get('authorization');
  if(!header||header.length>16384)return reply(401,{error:'authentication_required'});
  const match=/^Bearer ([^\s]+)$/.exec(header);if(!match)return reply(401,{error:'authentication_required'});
  try {
   const session=await verifySession(match[1]);
   if(!session||!Number.isSafeInteger(session.expiresAt)||session.expiresAt<=now())return reply(401,{error:'authentication_required'});
   const guard=await resolve(session);
   if(!guard)return reply(403,{error:'guard_access_unavailable'});
   return reply(200,{guard_id:guard.guardId,vendor_id:guard.vendorId});
  }catch{return reply(503,{error:'identity_unavailable'});}
 };
}
