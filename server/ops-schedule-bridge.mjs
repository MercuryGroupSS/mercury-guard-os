import {createHash,timingSafeEqual} from 'node:crypto';
import {strictJson} from './verify-batch.mjs';

export const OPS_SCHEDULE_PATH='/.netlify/functions/mercury-one-schedule';
const columns=['id','scheduled_start','scheduled_end','status','updated_at'];
const stable=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join()===keys.slice().sort().join();
const ids=value=>Array.isArray(value)&&value.length<=25&&value.every(stable)&&new Set(value).size===value.length;
export function scheduleBridgeToken(value){
 if(typeof value!=='string'||!(/^[A-Za-z0-9_-]{43}$/).test(value)||Buffer.from(value,'base64url').length!==32||Buffer.from(value,'base64url').toString('base64url')!==value)throw Error('Dedicated schedule credential required');
 return value;
}
function origin(value){const u=new URL(value);if(u.protocol!=='https:'||u.origin!==value||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('Trusted schedule origin required');return u;}
function checkedRows(rows,requested){
 if(!Array.isArray(rows)||rows.length>requested.length)throw Error('Invalid schedule rows');
 const seen=new Set();return rows.map(row=>{
  if(!exact(row,columns)||!requested.includes(row.id)||seen.has(row.id)||columns.some(k=>typeof row[k]!=='string'))throw Error('Invalid schedule row');
  if(!['scheduled','clocked_in','late','not_clocked_in','completed','cancelled'].includes(row.status))throw Error('Invalid schedule status');
  for(const k of ['scheduled_start','scheduled_end','updated_at'])if(!/(Z|[+-]\d\d:\d\d)$/.test(row[k])||!Number.isSafeInteger(Date.parse(row[k]))||Date.parse(row[k])<=0)throw Error('Invalid schedule time');
  if(Date.parse(row.scheduled_start)>=Date.parse(row.scheduled_end))throw Error('Invalid schedule duration');
  seen.add(row.id);return Object.fromEntries(columns.map(k=>[k,row[k]]));
 });
}
function checkedResult(value,requested){
 const rows=checkedRows(value.rows,requested),present=new Set(rows.map(r=>r.id)),missing=requested.filter(id=>!present.has(id));
 if(!ids(value.missingIds)||value.missingIds.length!==missing.length||value.missingIds.some(id=>!missing.includes(id))||!Number.isSafeInteger(value.fetchedAt)||value.fetchedAt<=0)throw Error('Invalid schedule result');
 return {rows,missingIds:missing,fetchedAt:value.fetchedAt};
}
const headers={'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});

// Ops-side implementation. The separate entrypoint is a reviewed addition only;
// installing Guard does not install or expose this function in the existing Ops site.
export function createOpsScheduleBridge({publicOrigin,token,allowedIds,allowHistory=false,readShifts,now=Date.now}){
 const base=origin(publicOrigin),expected=createHash('sha256').update(scheduleBridgeToken(token)).digest();
 if(!Array.isArray(allowedIds)||allowedIds.length<1||allowedIds.length>1000||allowedIds.some(id=>!stable(id))||new Set(allowedIds).size!==allowedIds.length||typeof allowHistory!=='boolean'||typeof readShifts!=='function')throw Error('Explicit schedule bridge scope required');
 const approved=new Set(allowedIds);
 return async request=>{
  const url=new URL(request.url);
  if(url.origin!==base.origin||url.pathname!==OPS_SCHEDULE_PATH||url.hash)return reply(404,{error:'not_found'});
  if(request.method!=='GET')return new Response(null,{status:405,headers:{...headers,allow:'GET'}});
  // No cross-origin browser interface. This credential exists only on the two servers.
  if(request.headers.has('origin'))return reply(400,{error:'invalid_request'});
  const auth=request.headers.get('authorization')??'',provided=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(auth)?.[1];
  if(!provided||!timingSafeEqual(expected,createHash('sha256').update(provided).digest()))return reply(401,{error:'authentication_required'});
  let requested,history;
  try{
   if([...url.searchParams.keys()].some(k=>!['ids','history'].includes(k))||url.searchParams.getAll('ids').length!==1||url.searchParams.getAll('history').length!==1)throw Error();
   const raw=url.searchParams.get('ids');if(raw.length>6000)throw Error();requested=strictJson(raw);history=url.searchParams.get('history');
   if(!ids(requested)||requested.length===0||!['true','false'].includes(history))throw Error();
   if(requested.some(id=>!approved.has(id)))return reply(403,{error:'shift_scope_required'});
   if(history==='true'&&!allowHistory)throw Error();
  }catch{return reply(400,{error:'invalid_request'});}
  try{
   const result=checkedResult(await readShifts(requested,{historyFallback:history==='true'}),requested),at=now();
   if(result.fetchedAt>at+60000||result.fetchedAt<at-60000)throw Error();
   const body={version:1,rows:result.rows,missing_ids:result.missingIds,fetched_at:result.fetchedAt};
   if(Buffer.byteLength(JSON.stringify(body))>65536)throw Error();return reply(200,body);
  }catch{return reply(502,{error:'schedule_source_unavailable'});}
 };
}

// Guard-side consumer: only the fixed bridge path, approved IDs, verified HTTPS,
// one five-second deadline and a 64 KiB response. Failure never means cancellation.
export function createOpsScheduleBridgeReader({url,token,historyFallback=false,fetchImpl=fetch,now=Date.now}){
 const base=origin(url);scheduleBridgeToken(token);if(typeof historyFallback!=='boolean')throw Error('Explicit history flag required');
 return async requested=>{
  if(!ids(requested))throw Error('Explicit unique shift IDs required');requested=[...requested];
  if(!requested.length)return {rows:[],missingIds:[],fetchedAt:now()};
  try{
   const endpoint=new URL(OPS_SCHEDULE_PATH,base);endpoint.searchParams.set('ids',JSON.stringify(requested));endpoint.searchParams.set('history',String(historyFallback));
   const response=await fetchImpl(endpoint.toString(),{method:'GET',headers:{authorization:'Bearer '+token,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(5000)});
   if(response.status!==200||response.redirected||!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??'')){await response.body?.cancel();throw Error();}
   const reader=response.body?.getReader();if(!reader)throw Error();let size=0;const chunks=[];
   try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();throw Error();}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
   const value=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
   if(!exact(value,['version','rows','missing_ids','fetched_at'])||value.version!==1)throw Error();
   const result=checkedResult({rows:value.rows,missingIds:value.missing_ids,fetchedAt:value.fetched_at},requested),at=now();
   if(result.fetchedAt>at+60000||result.fetchedAt<at-60000)throw Error();return result;
  }catch{throw Error('Ops schedule bridge read failed; existing assignments must be preserved');}
 };
}
