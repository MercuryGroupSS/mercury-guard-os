const id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
export function patrolRoute(value){
 if(!value||!id(value.routeId)||!Number.isSafeInteger(value.revision)||value.revision<1||!Array.isArray(value.checkpoints)||value.checkpoints.length<1||value.checkpoints.length>100)throw Error('Invalid route');
 const seen=new Set();const checkpoints=value.checkpoints.map(p=>{
  if(!p||!id(p.id)||seen.has(p.id)||typeof p.label!=='string'||!p.label.trim()||p.label.length>200)throw Error('Invalid checkpoint');
  seen.add(p.id);return {id:p.id,label:p.label};
 });
 return {routeId:value.routeId,revision:value.revision,checkpoints};
}
export function permitsCheckpoint(route,data){
 return !!route&&data.route_id===route.routeId&&data.route_revision===route.revision&&route.checkpoints.some(p=>p.id===data.checkpoint_id);
}
