import {createHash} from 'node:crypto';
import {strictJson} from './verify-batch.mjs';
import {validateDashboardReceipt,validateProjectedDashboardObservation} from './dashboard-delivery.mjs';
import {dashboardPhoto,validateDashboardMediaReceipt} from './dashboard-media.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const timestamp=value=>typeof value==='string'&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/.test(value)&&!value.startsWith('0000')&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,19)===value.slice(0,19);
export function receivedReportCursor(receivedAt,deliveryId){
 if(!timestamp(receivedAt)||!digest(deliveryId))throw Error('Received report position required');
 return 'r1.'+Buffer.from(JSON.stringify([receivedAt,deliveryId])).toString('base64url');
}
export function parseReceivedReportCursor(value){
 if(value==='')return null;
 if(typeof value!=='string'||value.length>200||!/^r1\.[A-Za-z0-9_-]+$/.test(value))throw Error('Bounded received report cursor required');
 const raw=Buffer.from(value.slice(3),'base64url'),position=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(raw));
 if(!Array.isArray(position)||position.length!==2||receivedReportCursor(...position)!==value)throw Error('Invalid received report cursor');
 return position;
}
// Use the immutable original columns, never today's binding or display names.
// A later source revocation must not remove an administrator's historical audit.
export function receivedObservation(row){
 if(!row||typeof row.raw_body!=='string'||Buffer.byteLength(row.raw_body)>64000||hash(row.raw_body)!==row.payload_sha256)throw Error('Received observation integrity failed');
 const value=strictJson(row.raw_body),mapping={assignmentId:row.assignment_id,guardId:row.guard_id,vendorId:row.vendor_id,siteId:row.site_id,dashboardShiftId:row.dashboard_shift_id,destination:row.destination,revision:Number(row.mapping_revision),active:true};
 validateProjectedDashboardObservation(value,mapping);
 if(value.delivery_id!==row.delivery_id)throw Error('Received observation attribution failed');
 validateDashboardReceipt(row.receipt,{id:row.delivery_id,hash:row.payload_sha256,body:row.raw_body});
 return value;
}
const columns=`delivery_id,payload_sha256,raw_body,receipt,assignment_id,guard_id,vendor_id,site_id,destination,mapping_revision,dashboard_shift_id,to_char(received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS received_at`;
const noMedia=()=>({state:'not_applicable',path:null,sha256:null,bytes:null});
const pending=(meta=null)=>({state:'pending',path:null,sha256:meta?.sha256??null,bytes:meta?.bytes??null});
function photoFor(observation,photos){
 if(observation.observation.kind==='photo_evidence')return observation;
 if(observation.observation.kind!=='check_in')return null;
 const data=observation.observation.data;
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(data.photo_event_id)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(data.evidence_id))return null;
 const id=hash(`mercury-one-observation-v1\n${observation.observation.device_thumbprint}\n${data.photo_event_id}`),row=photos.get(id);
 if(!row)return null;
 const photo=receivedObservation(row);
 if(photo.observation.kind!=='photo_evidence'||photo.observation.event_id!==data.photo_event_id||photo.observation.device_thumbprint!==observation.observation.device_thumbprint||photo.observation.data.evidence_id!==data.evidence_id||['destination','dashboard_shift_id','assignment_id','guard_id','vendor_id','site_id','mapping_revision'].some(key=>photo[key]!==observation[key]))return null;
 return photo;
}
function storedPhotoMetadata(photo,media){
 const meta=dashboardPhoto(photo);
 if(!media)return {meta,summary:pending(meta)};
 if(media.sha256!==meta.sha256||Number(media.byte_count)!==meta.bytes)throw Error('Received photo metadata integrity failed');
 validateDashboardMediaReceipt(media.receipt,JSON.stringify(photo));
 return {meta,summary:{state:'stored',path:'/v1/admin/media/'+meta.delivery_id,sha256:meta.sha256,bytes:meta.bytes}};
}
export async function receivedReportsCatalog(client,after=''){
 const position=parseReceivedReportCursor(after),rows=(await client.query(`SELECT ${columns} FROM mercury_guard_receiver.observations o ${position?'WHERE (o.received_at,o.delivery_id)<($1::timestamptz,$2) ':''}ORDER BY o.received_at DESC,o.delivery_id DESC LIMIT 51`,position??[])).rows,visible=rows.slice(0,50),values=visible.map(receivedObservation),photoIds=new Set();
 for(const value of values){if(value.observation.kind==='photo_evidence')photoIds.add(value.delivery_id);else if(value.observation.kind==='check_in')photoIds.add(hash(`mercury-one-observation-v1\n${value.observation.device_thumbprint}\n${value.observation.data.photo_event_id}`));}
 const ids=[...photoIds],photos=new Map(visible.map(row=>[row.delivery_id,row])),media=new Map();
 if(ids.length){
  for(const row of (await client.query(`SELECT ${columns} FROM mercury_guard_receiver.observations WHERE delivery_id=ANY($1::text[])`,[ids])).rows)photos.set(row.delivery_id,row);
  // Catalogs include only integrity-bound metadata, never the private bytes.
  for(const row of (await client.query('SELECT delivery_id,sha256,octet_length(bytes) AS byte_count,receipt FROM mercury_guard_receiver.media WHERE delivery_id=ANY($1::text[])',[ids])).rows)media.set(row.delivery_id,row);
 }
 const items=values.map((value,index)=>{
  const photo=photoFor(value,photos),summary=photo?storedPhotoMetadata(photo,media.get(photo.delivery_id)).summary:value.observation.kind==='check_in'?pending():noMedia();
  return {...Object.fromEntries(['delivery_id','destination','mapping_revision','dashboard_shift_id','assignment_id','guard_id','vendor_id','site_id','observation'].map(key=>[key,value[key]])),received_at:visible[index].received_at,media:summary};
 });
 return {kind:'received_reports',items,next_cursor:rows.length>50?receivedReportCursor(visible.at(-1).received_at,visible.at(-1).delivery_id):null};
}
export async function receivedReportMedia(client,deliveryId){
 if(!digest(deliveryId))throw Error('Private photo delivery required');
 const row=(await client.query(`SELECT ${columns} FROM mercury_guard_receiver.observations WHERE delivery_id=$1`,[deliveryId])).rows[0];
 if(!row)return null;
 const photo=receivedObservation(row);if(photo.observation.kind!=='photo_evidence')return null;
 const media=(await client.query('SELECT delivery_id,sha256,octet_length(bytes) AS byte_count,receipt,bytes FROM mercury_guard_receiver.media WHERE delivery_id=$1',[deliveryId])).rows[0];
 if(!media)return null;
 const {meta}=storedPhotoMetadata(photo,media),bytes=media.bytes;
 if(!Buffer.isBuffer(bytes)||bytes.length!==meta.bytes||hash(bytes)!==meta.sha256||bytes.length<5||bytes[0]!==0xff||bytes[1]!==0xd8||bytes[2]!==0xff||bytes.at(-2)!==0xff||bytes.at(-1)!==0xd9)throw Error('Received photo bytes integrity failed');
 return {bytes,sha256:meta.sha256};
}
