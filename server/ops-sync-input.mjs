import {createHash} from 'node:crypto';
import {patrolRoutePolicy} from './patrol-route.mjs';
const id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function time(x){if(typeof x!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(x))throw Error('Explicit timestamp required');const n=Date.parse(x);if(!Number.isSafeInteger(n)||n<=0)throw Error('Invalid timestamp');return n;}
export function prepareOpsSync(shift,binding){
  if(!shift||!binding||!id(shift.id)||binding.opsShiftId!==shift.id||!['guardId','vendorId','siteId'].every(k=>id(binding[k]))||typeof binding.active!=='boolean'||!Number.isSafeInteger(binding.revision)||binding.revision<1)throw Error('Explicit assignment binding required');
  if(binding.patrolRoute)patrolRoutePolicy(binding.patrolRoute,binding.locationPolicy);
  const sourceAt=time(shift.updated_at),startsAt=time(shift.scheduled_start),endsAt=time(shift.scheduled_end);
  if(startsAt>=endsAt||!['scheduled','clocked_in','late','not_clocked_in','completed','cancelled'].includes(shift.status))throw Error('Invalid upstream assignment');
  const active=binding.active&&!['completed','cancelled'].includes(shift.status);
  const material={guardId:binding.guardId,vendorId:binding.vendorId,siteId:binding.siteId,startsAt,endsAt,...(binding.patrolRoute?{patrolRoute:binding.patrolRoute}:{}),...(binding.checkInPolicy?{checkInPolicy:binding.checkInPolicy}:{}),...(binding.locationPolicy?{locationPolicy:binding.locationPolicy}:{})};
  const sourceDigest=hash({startsAt,endsAt,status:shift.status}),bindingDigest=hash({guardId:binding.guardId,vendorId:binding.vendorId,siteId:binding.siteId,active:binding.active,patrolRoute:binding.patrolRoute??null,checkInPolicy:binding.checkInPolicy??null,locationPolicy:binding.locationPolicy??null});
  const materialHash=hash(material),digest=hash({material,active,sourceAt,revision:binding.revision,status:shift.status});
 return {sourceAt,active,material,sourceDigest,bindingDigest,materialHash,digest};
}
export {id,hash};
