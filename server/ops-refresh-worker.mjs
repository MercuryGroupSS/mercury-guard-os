import {createGuardResolver} from './guard-directory.mjs';
const stable=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
function snapshot(rows){
 if(!Array.isArray(rows)||rows.length>1000)throw Error('Bounded bindings required');
 const seen=new Set();
 return structuredClone(rows).map(b=>{
  if(!b||!['opsShiftId','guardId','vendorId','siteId','authSubject'].every(k=>stable(b[k]))||!Number.isSafeInteger(b.revision)||b.revision<1||typeof b.active!=='boolean'||seen.has(b.opsShiftId))throw Error('Invalid approved bindings');
  seen.add(b.opsShiftId);return b;
 });
}
export function createOpsRefreshWorker({loadBindings,readShifts,sync,directory,intervalMs=30000,schedule=setInterval,cancel=clearInterval,now=Date.now}){
 if(typeof loadBindings!=='function'||typeof readShifts!=='function'||typeof sync?.apply!=='function'||typeof sync?.revokeBinding!=='function'||!Number.isSafeInteger(intervalMs)||intervalMs<1000)throw Error('Refresh dependencies required');
 const resolve=createGuardResolver({loadGuardsForSubject:s=>directory.loadGuardsForSubject(s),loadVendor:id=>directory.loadVendor(id)});
 let timer=null,inflight=null,generation=0,last={processed:0,missing:0,failed:0,changedMappings:0,at:null};
 function run(){
  if(inflight)return inflight;
  const epoch=generation;
  inflight=(async()=>{
   const result={processed:0,missing:0,failed:0,changedMappings:0,at:now()};
   try{
    const approved=snapshot(await loadBindings());
    for(const binding of approved.filter(b=>!b.active)){
     if(epoch!==generation)break;
     const latest=snapshot(await loadBindings()).find(b=>b.opsShiftId===binding.opsShiftId);
     if(epoch!==generation)break;
     if(JSON.stringify(latest)!==JSON.stringify(binding)){result.changedMappings++;continue;}
     try{sync.revokeBinding(binding);result.processed++;}catch{result.failed++;}
    }
    const active=approved.filter(b=>b.active);
    for(let offset=0;offset<active.length;offset+=25){
     if(epoch!==generation)break;
     const page=active.slice(offset,offset+25);
     let fetched;
     try{fetched=await readShifts(page.map(b=>b.opsShiftId));}catch{result.failed+=page.length;continue;}
     if(epoch!==generation)break;
     const current=new Map(snapshot(await loadBindings()).map(b=>[b.opsShiftId,b]));
     if(!Array.isArray(fetched.rows)||fetched.rows.length>page.length||new Set(fetched.rows.map(r=>r.id)).size!==fetched.rows.length||fetched.rows.some(r=>!page.some(b=>b.opsShiftId===r.id)))throw Error('Source scope mismatch');
     const source=new Map(fetched.rows.map(r=>[r.id,r]));
     for(const binding of page){
      if(epoch!==generation)break;
      if(JSON.stringify(current.get(binding.opsShiftId))!==JSON.stringify(binding)){result.changedMappings++;continue;}
      const row=source.get(binding.opsShiftId);if(!row){result.missing++;continue;}
      try{
       if(binding.active){const identity=await resolve({subject:binding.authSubject,active:true});if(!identity||identity.guardId!==binding.guardId||identity.vendorId!==binding.vendorId)throw Error('Guard unavailable');}
       // Re-read approval after asynchronous directory lookup too.
       const latest=snapshot(await loadBindings()).find(b=>b.opsShiftId===binding.opsShiftId);
       if(epoch!==generation)break;
       if(JSON.stringify(latest)!==JSON.stringify(binding)){result.changedMappings++;continue;}
       sync.apply(row,binding);result.processed++;
      }catch{result.failed++;}
     }
    }
   }catch{result.failed++;}
   last=result;return {...result};
  })().finally(()=>{inflight=null;});
  return inflight;
 }
 return {run,status:()=>({...last,scheduled:timer!==null,inflight:inflight!==null}),start(){if(timer!==null)return;timer=schedule(()=>{void run();},intervalMs);timer?.unref?.();void run();},stop(){generation++;if(timer!==null){cancel(timer);timer=null;}}};
}
