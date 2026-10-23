// Identity resolution after account authentication. Providers are server-owned;
// vendor IDs and a handset biometric are never proof of an individual identity.
function stable(value) {
 return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value);
}
export function createGuardResolver({loadGuardsForSubject,loadVendor}) {
 if(typeof loadGuardsForSubject!=='function'||typeof loadVendor!=='function')throw Error('Trusted directory providers required');
 return async session=>{
  if(!session || session.active!==true || !stable(session.subject))return null;
  const rows=await loadGuardsForSubject(session.subject);
  // Ambiguity denies access; never pick the first matching name or company.
  if(!Array.isArray(rows)||rows.length!==1)return null;
  const guard=rows[0];
  if(guard.authSubject!==session.subject||guard.active!==true||!stable(guard.guardId)||!stable(guard.vendorId))return null;
  const vendor=await loadVendor(guard.vendorId);
  if(!vendor||vendor.vendorId!==guard.vendorId||vendor.active!==true||!['company','individual'].includes(vendor.kind))return null;
  return Object.freeze({subject:session.subject,guardId:guard.guardId,vendorId:vendor.vendorId});
 };
}
// A trusted assignment binding and approved device enrollment narrow access.
// A caller-supplied device ID must first be proven by the installation key.
export function assignmentForGuard({identity,assignment,device,now=Date.now()}) {
 if(!identity||!assignment||!device||!Number.isSafeInteger(now))return null;
 for(const key of ['guardId','vendorId']) if(!stable(identity[key])||assignment[key]!==identity[key])return null;
 if(!stable(assignment.assignmentId)||!stable(assignment.siteId)||assignment.active!==true||device.active!==true||device.revoked!==false||!stable(device.deviceId))return null;
 if(device.mode==='site') {if(device.siteId!==assignment.siteId)return null;}
 else if(device.mode==='personal') {if(device.guardId!==identity.guardId)return null;}
 else return null;
 if(!Number.isSafeInteger(assignment.startsAt)||!Number.isSafeInteger(assignment.endsAt)||assignment.startsAt>=assignment.endsAt||now>=assignment.endsAt)return null;
 return Object.freeze({assignmentId:assignment.assignmentId,guardId:identity.guardId,vendorId:identity.vendorId,
  siteId:assignment.siteId,deviceId:device.deviceId,startsAt:assignment.startsAt,endsAt:assignment.endsAt,
  // Future assignments are readable; this projection does not grant clock-in.
  canStart:now>=assignment.startsAt});
}
