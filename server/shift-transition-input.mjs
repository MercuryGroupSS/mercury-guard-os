import {createHash} from 'node:crypto';
const stable=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
export function prepareShiftTransition({identity,assignment,deviceThumbprint,request,now,allowStart=true}){
  if(typeof allowStart!=='boolean'||!identity||!assignment||['guardId','vendorId'].some(k=>!stable(identity[k])||identity[k]!==assignment[k])||!stable(identity.subject)||!stable(assignment.assignmentId)||!stable(assignment.siteId)||assignment.active!==true||!/^[a-f0-9]{64}$/.test(deviceThumbprint)||!Number.isSafeInteger(now)||now<=0||!Number.isSafeInteger(assignment.startsAt)||!Number.isSafeInteger(assignment.endsAt)||assignment.startsAt>=assignment.endsAt)throw Error('Authorized shift scope required');
  if(!request||Object.keys(request).sort().join()!=='action,confirmed,reason,request_id'||!stable(request.request_id)||!['start','end'].includes(request.action)||request.confirmed!==true||typeof request.reason!=='string'||request.reason.length>2000)throw Error('Explicit shift confirmation required');
  const scope={guard_id:identity.guardId,vendor_id:identity.vendorId,site_id:assignment.siteId,assignment_id:assignment.assignmentId,device_thumbprint:deviceThumbprint};
  const digest=createHash('sha256').update(JSON.stringify({scope,subject:identity.subject,request,starts_at:assignment.startsAt,ends_at:assignment.endsAt})).digest('hex');
 return {scope,digest};
}
