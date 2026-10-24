const stable=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
export function prepareOpsBinding(binding,{operator,reason,now=Date.now()}={}){
  const required=['opsShiftId','guardId','vendorId','siteId','authSubject','revision','active'],optional=['patrolRoute','checkInPolicy','locationPolicy'];
  if(!binding||required.some(k=>!Object.hasOwn(binding,k))||Object.keys(binding).some(k=>![...required,...optional].includes(k))||required.slice(0,5).some(k=>!stable(binding[k]))||!Number.isSafeInteger(binding.revision)||binding.revision<1||typeof binding.active!=='boolean')throw Error('Explicit complete binding required');
  if([operator,reason].some(x=>typeof x!=='string'||!x.trim()||x.length>500||/[\u0000-\u001f]/.test(x))||!Number.isSafeInteger(now)||now<=0)throw Error('Approval context required');
  if(binding.patrolRoute!==undefined&&binding.patrolRoute!==null)patrolRoutePolicy(binding.patrolRoute,binding.locationPolicy);
  if(binding.checkInPolicy!==undefined&&binding.checkInPolicy!==null&&Object.hasOwn(binding.checkInPolicy,'attention'))checkInAttention(binding.checkInPolicy.attention);
  if(binding.locationPolicy!==undefined&&binding.locationPolicy!==null)locationPolicy(binding.locationPolicy);
  const body=JSON.stringify(canonical(binding));if(Buffer.byteLength(body)>32768)throw Error('Binding too large');
 return {body,operator:operator.trim(),reason:reason.trim(),now};
}
import {patrolRoutePolicy} from './patrol-route.mjs';
import {locationPolicy} from './location-policy.mjs';
import {checkInAttention} from './check-in-policy.mjs';
