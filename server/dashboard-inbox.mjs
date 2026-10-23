import {createHash,timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {strictJson} from './verify-batch.mjs';
import {projectDashboardObservation} from './dashboard-delivery.mjs';
// Isolated reference inbox. It never writes existing dashboard/payroll/WhatsApp tables.
export class DashboardInbox {
 constructor(path){this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS mercury_one_inbox(id TEXT PRIMARY KEY,hash TEXT NOT NULL,body TEXT NOT NULL,receipt TEXT NOT NULL);`);}
 accept(value,raw){
  const digest=createHash('sha256').update(raw).digest('hex');
  const receipt={delivery_id:value.delivery_id,destination:value.destination,payload_sha256:digest,status:'stored_in_integration_inbox'};
  this.db.exec('BEGIN IMMEDIATE');try{
   const prior=this.db.prepare('SELECT hash,receipt FROM mercury_one_inbox WHERE id=?').get(value.delivery_id);
   if(prior){if(prior.hash!==digest)throw Error('Immutable observation conflict');this.db.exec('COMMIT');return JSON.parse(prior.receipt);}
   this.db.prepare('INSERT INTO mercury_one_inbox VALUES(?,?,?,?)').run(value.delivery_id,digest,raw,JSON.stringify(receipt));
   this.db.exec('COMMIT');return receipt;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 close(){this.db.close();}
}
export function createDashboardInboxHandler({token,destination,inbox,loadMapping}){
 if(typeof token!=='string'||token.length<32||token.length>4096||/\s/.test(token)||typeof destination!=='string'||!destination||typeof loadMapping!=='function')throw Error('Dedicated integration configuration required');
 const secret=createHash('sha256').update(token).digest();
 const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
 return async request=>{
  if(new URL(request.url).pathname!=='/v1/mercury-one/observations')return reply(404,{error:'not_found'});
  if(request.method!=='POST')return reply(405,{error:'post_required'});
  const supplied=request.headers.get('authorization')??'';
  if(supplied.length>4103||!supplied.startsWith('Bearer ')||!timingSafeEqual(secret,createHash('sha256').update(supplied.slice(7)).digest()))return reply(401,{error:'unauthorized'});
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return reply(415,{error:'json_required'});
  const reader=request.body?.getReader();if(!reader)return reply(400,{error:'body_required'});
  try{
   const chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>64000){await reader.cancel();return reply(413,{error:'body_too_large'});}chunks.push(Buffer.from(value));}
   const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)),value=strictJson(raw);
   if(value.destination!==destination||value.source!=='mercury_one'||value.version!==1)return reply(403,{error:'mapping_unavailable'});
   const mapping=await loadMapping({assignmentId:value.assignment_id,guardId:value.guard_id,vendorId:value.vendor_id,siteId:value.site_id,destination});
   if(!mapping)return reply(403,{error:'mapping_unavailable'});
   const expected=projectDashboardObservation({vendor_id:value.vendor_id,scope:{guard_id:value.guard_id,site_id:value.site_id,assignment_id:value.assignment_id,device_thumbprint:value.observation?.device_thumbprint},event:{event_id:value.observation?.event_id,kind:value.observation?.kind,at:value.observation?.occurred_at_ms,data:value.observation?.data}},mapping);
   if(JSON.stringify(expected)!==JSON.stringify(value))return reply(400,{error:'observation_rejected'});
   return reply(200,inbox.accept(value,raw));
  }catch{return reply(400,{error:'observation_rejected'});}
  finally{reader.releaseLock();}
 };
}
