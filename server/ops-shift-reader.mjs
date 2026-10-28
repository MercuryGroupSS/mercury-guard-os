import {strictJson} from './verify-batch.mjs';
const columns=['id','scheduled_start','scheduled_end','status','updated_at'];
const stable=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
// Server-controlled origin/key and approved IDs only. No writes or broad roster reads.
export function createOpsShiftReader({url,serverKey,fetchImpl=fetch,allowLocal=false,historyFallback=false,now=Date.now}){
 if(typeof historyFallback!=='boolean')throw Error('Explicit Ops history fallback flag required');
 const base=new URL(url);
 if(base.username||base.password||base.search||base.hash||base.pathname!=='/'||(base.protocol!=='https:'&&!(allowLocal&&base.origin==='http://127.0.0.1:55321')))throw Error('Trusted Ops origin required');
 if(typeof serverKey!=='string'||serverKey.length>16384||/\s/.test(serverKey)||!(serverKey.startsWith('sb_secret_')||/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(serverKey)))throw Error('Server API credential required');
 const headers={apikey:serverKey,accept:'application/json','accept-profile':'public'};
 if(!serverKey.startsWith('sb_secret_'))headers.authorization='Bearer '+serverKey;
 return async ids=>{
  if(!Array.isArray(ids)||ids.length>25||ids.some(x=>!stable(x))||new Set(ids).size!==ids.length)throw Error('Explicit unique shift IDs required');
  ids=[...ids];
  if(ids.length===0)return {rows:[],missingIds:[],fetchedAt:now()};
  try{
   // One deadline covers both reads. History cannot widen IDs, fields or origin,
   // override a current row, or turn a rejected current response into a fallback.
   const signal=AbortSignal.timeout(5000);
   const read=async(table,requested)=>{
   const endpoint=new URL('/rest/v1/'+table,base);endpoint.searchParams.set('select',columns.join(','));endpoint.searchParams.set('id','in.('+requested.map(id=>'"'+id+'"').join(',')+')');endpoint.searchParams.set('limit',String(requested.length+1));
   const response=await fetchImpl(endpoint.toString(),{method:'GET',headers,redirect:'error',signal});
   if(response.status!==200||response.redirected||!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??'')){await response.body?.cancel();throw Error('Source response rejected');}
   const reader=response.body?.getReader();if(!reader)throw Error('Source body missing');
   let bytes=0;const chunks=[];
   try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>65536){await reader.cancel();throw Error('Source body exceeded bound');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
   const rows=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
   if(!Array.isArray(rows)||rows.length>requested.length)throw Error('Invalid source list');
   const seen=new Set();const projected=rows.map(row=>{
    if(!row||!requested.includes(row.id)||seen.has(row.id)||Object.keys(row).sort().join()!==[...columns].sort().join()||columns.some(k=>typeof row[k]!=='string'))throw Error('Invalid source row');
    seen.add(row.id);return Object.fromEntries(columns.map(k=>[k,row[k]]));
   });
   return projected;
   };
   const rows=await read('shifts',ids),seen=new Set(rows.map(row=>row.id));
   const missing=ids.filter(id=>!seen.has(id));
   if(historyFallback&&missing.length){
    const historical=await read('shift_history',missing);
    for(const row of historical){rows.push(row);seen.add(row.id);}
   }
   return {rows,missingIds:ids.filter(id=>!seen.has(id)),fetchedAt:now()};
  }catch{throw Error('Ops shift read failed; existing assignments must be preserved');}
 };
}
