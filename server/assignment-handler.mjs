import {DispatchCursorError} from './dispatch-feed.mjs';
import {reconcileCheckIns} from './check-in-status.mjs';
import {createGuardResolver} from './guard-directory.mjs';
import {strictJson} from './verify-batch.mjs';
export function createAssignmentHandler({verifySession,directory,devices,grantIssuer,store,dispatch,shiftLifecycle,now=Date.now}){
 const resolve=createGuardResolver({loadGuardsForSubject:s=>directory.loadGuardsForSubject(s),loadVendor:id=>directory.loadVendor(id)});
 const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
 return async request=>{
  const path=new URL(request.url).pathname;
  if(!['/v1/device-challenge','/v1/assignments','/v1/shift-grant','/v1/dispatch','/v1/shift-transition'].includes(path))return reply(404,{error:'not_found'});
  if(request.method!=='POST')return reply(405,{error:'method_not_allowed'});
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return reply(415,{error:'json_required'});
  const auth=request.headers.get('authorization')??'';
  const match=auth.length<=16384?/^Bearer ([^\s]+)$/.exec(auth):null;
  if(!match)return reply(401,{error:'authentication_required'});
  let identity,session;
  try{
   session=await verifySession(match[1]);
   if(!session||!Number.isSafeInteger(session.expiresAt)||session.expiresAt*1000<=now())return reply(401,{error:'authentication_required'});
   identity=await resolve(session);if(!identity)return reply(403,{error:'guard_access_unavailable'});
  }catch{return reply(503,{error:'identity_unavailable'});}
  const reader=request.body?.getReader();if(!reader)return reply(400,{error:'body_required'});
  try{
   let size=0;const chunks=[];
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();return reply(413,{error:'body_too_large'});}chunks.push(Buffer.from(value));}
   const body=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
   if(path==='/v1/device-challenge'){
    if(!body||Object.keys(body).join()!=='device_id')throw Error('Invalid request');
    return reply(200,devices.challenge(identity,body.device_id,now()));
   }
   if(path==='/v1/shift-transition'){
    if(!shiftLifecycle)return reply(503,{error:'shift_service_unavailable'});
    if(!body||Object.keys(body).sort().join()!=='assignment_id,proof,transition'||typeof body.assignment_id!=='string')throw Error('Invalid transition request');
    const at=now(),result=devices.list(identity,body.proof,at,{historical:true});
    const assignment=result.assignments.find(a=>a.assignmentId===body.assignment_id);
    if(!assignment)throw Error('Assignment unavailable');
    return reply(200,shiftLifecycle.transition({identity,assignment:{...assignment,active:true},deviceThumbprint:assignment.deviceThumbprint,request:body.transition,now:at}));
   }
   if(path==='/v1/dispatch'){
    if(!dispatch)return reply(503,{error:'dispatch_unavailable'});
    if(!body||Object.keys(body).sort().join()!=='assignment_id,cursor,proof'||typeof body.assignment_id!=='string'||body.cursor!==null&&typeof body.cursor!=='string')throw Error('Invalid dispatch request');
    const at=now(),result=devices.list(identity,body.proof,at),assignment=result.assignments.find(a=>a.assignmentId===body.assignment_id);
    if(!assignment)throw Error('Assignment unavailable');
    return reply(200,dispatch.read({...identity,siteId:assignment.siteId,assignmentId:assignment.assignmentId,deviceThumbprint:assignment.deviceThumbprint,revocationVersion:assignment.revocationVersion},body.cursor,at));
   }
   if(path==='/v1/shift-grant'){
    if(!grantIssuer)return reply(503,{error:'issuer_unavailable'});
    if(!body||Object.keys(body).sort().join()!=='assignment_id,proof'||typeof body.assignment_id!=='string')throw Error('Invalid grant request');
    const at=now();
    const result=devices.list(identity,body.proof,at);
    const assignment=result.assignments.find(a=>a.assignmentId===body.assignment_id&&a.canStart);
    if(!assignment)throw Error('Assignment unavailable');
    const device=devices.device(assignment.deviceId);
    const grant=grantIssuer.issue({identity,assignment,device,sessionExpiresAt:session.expiresAt*1000,
     allowedActions:['patrol','incident','photo','check_in','location',...(dispatch?['dispatch_ack']:[])],now:at});
    return reply(200,{...grant,check_in_status:store&&assignment.checkInPolicy?reconcileCheckIns(store,assignment,at):null});
   }
   return reply(200,devices.list(identity,body,now()));
  }catch(error){return error instanceof DispatchCursorError?reply(409,{error:'cursor_reset_required'}):reply(400,{error:'device_request_rejected'});}
  finally{reader.releaseLock();}
 };
}
