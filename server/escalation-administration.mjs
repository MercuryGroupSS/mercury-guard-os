// Preserve the existing administrator surface while routing only the explicit
// escalation catalog/action to its independently transactional inbox.
export function withEscalationAdministration(admin,escalations){
 if(!admin||!escalations)throw Error('Administration and escalation inbox required');
 const result={pool:admin.pool};
 for(const key of ['member','loginAccount','consumeLoginAttempt','media']){
  if(typeof admin[key]==='function')result[key]=admin[key].bind(admin);
 }
 const input=request=>{
  if(!request||Array.isArray(request)||Object.keys(request).sort().join()!=='action,payload,reason,request_id'||request.action!=='escalation.acknowledge'||!request.payload||Array.isArray(request.payload)||Object.keys(request.payload).join()!=='escalation_id')throw Error('Exact escalation acknowledgement required');
  return {request_id:request.request_id,escalation_id:request.payload.escalation_id,reason:request.reason};
 };
 result.catalog=(session,kind,after='')=>kind==='escalations'?escalations.catalog(session,after):admin.catalog(session,kind,after);
 result.apply=(session,request)=>request?.action==='escalation.acknowledge'?escalations.acknowledge(session,input(request)):admin.apply(session,request);
 result.settle=(session,request)=>request?.action==='escalation.acknowledge'?escalations.settle(session,input(request)):admin.settle(session,request);
 return result;
}
