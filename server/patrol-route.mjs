import {locationPolicy} from './location-policy.mjs';
const id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
export function patrolRoute(value){
 if(!value||!id(value.routeId)||!Number.isSafeInteger(value.revision)||value.revision<1||!Array.isArray(value.checkpoints)||value.checkpoints.length<1||value.checkpoints.length>100)throw Error('Invalid route');
 const seen=new Set();const checkpoints=value.checkpoints.map(p=>{
  if(!p||!id(p.id)||seen.has(p.id)||typeof p.label!=='string'||!p.label.trim()||p.label.length>200)throw Error('Invalid checkpoint');
  seen.add(p.id);return {id:p.id,label:p.label};
 });
 const route={routeId:value.routeId,revision:value.revision,checkpoints};
 if(Object.hasOwn(value,'gps_required')){if(value.gps_required!==true)throw Error('Explicit GPS-required route or legacy omission required');route.gps_required=true;}
 if(Object.hasOwn(value,'rounds')){
  if(!Array.isArray(value.rounds)||!value.rounds.length||value.rounds.length>100)throw Error('Explicit bounded patrol rounds required');
  const ids=new Set(),labels=new Set();route.rounds=value.rounds.map(round=>{
   if(!round||!id(round.id)||ids.has(round.id)||typeof round.label!=='string'||!round.label.trim()||round.label.length>200||labels.has(round.label.trim().toLowerCase()))throw Error('Unique patrol round required');
   ids.add(round.id);labels.add(round.label.trim().toLowerCase());return {id:round.id,label:round.label.trim()};
  });
 }
 return route;
}
// The reasoned owner approval of this exact pair attests that the notice covers
// user-triggered checkpoint fixes. Purpose is never inferred from notice words.
export function patrolRoutePolicy(value,approvedLocationPolicy){const route=patrolRoute(value);if(route.gps_required===true)locationPolicy(approvedLocationPolicy);return route;}
export function permitsCheckpoint(route,data){
 return !!route&&!!data&&data.route_id===route.routeId&&data.route_revision===route.revision&&route.checkpoints.some(p=>p.id===data.checkpoint_id)&&(route.rounds?route.rounds.some(round=>round.id===data.round_id):!Object.hasOwn(data,'round_id'));
}
// Empty is reserved for old one-pass routes; phones cannot request that scope.
export function patrolRoundKey(data){if(!Object.hasOwn(data,'round_id'))return '';if(!id(data.round_id))throw Error('Explicit patrol round required');return data.round_id;}
