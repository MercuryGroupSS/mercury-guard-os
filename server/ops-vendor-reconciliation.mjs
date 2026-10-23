// Trusted server snapshots only. This preview neither provisions nor authenticates a guard.
const stable=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
export function reconcileOpsVendors(rows,bindings){
 if(!Array.isArray(rows)||!Array.isArray(bindings)||rows.length>10000||bindings.length>10000)throw Error('Bounded vendor snapshots required');
 const current=new Map(),aliases=new Map(),localIds=new Set(),upstreamIds=new Set();
 for(const row of rows){
  if(!row||!stable(row.vendor_id)||current.has(row.vendor_id))throw Error('Invalid or duplicate upstream vendor');
  if(row.prev_ids!=null&&(!Array.isArray(row.prev_ids)||row.prev_ids.length>1000||row.prev_ids.some(x=>!stable(x))))throw Error('Invalid upstream alias history');
  current.set(row.vendor_id,row);
  for(const old of new Set(row.prev_ids??[])){const matches=aliases.get(old)??[];matches.push(row.vendor_id);aliases.set(old,matches);}
 }
 return bindings.map(binding=>{
  if(!binding||!stable(binding.vendorId)||!stable(binding.opsVendorId)||!['company','individual'].includes(binding.kind)||!Number.isSafeInteger(binding.revision)||binding.revision<1||typeof binding.active!=='boolean')throw Error('Approved vendor binding required');
  if(localIds.has(binding.vendorId)||upstreamIds.has(binding.opsVendorId))throw Error('Ambiguous vendor bindings');
  localIds.add(binding.vendorId);upstreamIds.add(binding.opsVendorId);
  const base={vendorId:binding.vendorId,opsVendorId:binding.opsVendorId,kind:binding.kind,revision:binding.revision};
  if(!binding.active)return {...base,status:'binding_disabled'};
  const row=current.get(binding.opsVendorId),history=(aliases.get(binding.opsVendorId)??[]).filter(id=>id!==binding.opsVendorId);
  // An old code reused by a new vendor must not silently acquire the old vendor's guards.
  if(history.length)return {...base,status:row||history.length>1?'ambiguous_source_identity':'rename_review_required',candidateOpsVendorIds:[...history].sort()};
  if(!row)return {...base,status:'source_missing'};
  // is_agency is a licensing flag, not proof that a non-agency vendor is an individual.
  if(row.is_agency===true&&binding.kind!=='company')return {...base,status:'vendor_kind_review_required'};
  return {...base,status:'source_link_resolved'};
 });
}
