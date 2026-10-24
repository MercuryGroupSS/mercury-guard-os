import {createHash} from 'node:crypto';
import {MAX_PHOTO_BYTES} from './photo-metadata.mjs';
export const PHOTO_CHUNK_BYTES=1024*1024;
export const PHOTO_CHUNK_TTL_MS=86400000;
export const photoHash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function photoChunkSize(meta,index){
 if(!Number.isSafeInteger(meta?.bytes)||meta.bytes<1||meta.bytes>MAX_PHOTO_BYTES||!Number.isSafeInteger(index)||index<0||index>=Math.ceil(meta.bytes/PHOTO_CHUNK_BYTES))throw Error('Original bounded photo chunk required');
 return Math.min(PHOTO_CHUNK_BYTES,meta.bytes-index*PHOTO_CHUNK_BYTES);
}
export function validatePhotoChunk(meta,index,bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length!==photoChunkSize(meta,index))throw Error('Photo chunk size mismatch');return photoHash(bytes);
}
export function photoChunkReceipt(eventId,meta,index,bytes){return {event_id:eventId,evidence_id:meta.evidence_id,sha256:meta.sha256,bytes:meta.bytes,chunk_index:index,chunk_sha256:validatePhotoChunk(meta,index,bytes),chunk_bytes:bytes.length,status:'evidence_chunk_retained'};}
export function evidenceChunkMessage(record,meta,index,sha,bytes,audience){
 if(!/^[A-Za-z0-9._:/-]{1,128}$/.test(audience??'')||!/^[a-f0-9]{64}$/.test(record?.scope?.device_thumbprint??'')||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(record?.event?.event_id??'')||!(/^[a-f0-9]{64}$/).test(sha??'')||bytes!==photoChunkSize(meta,index))throw Error('Original canonical chunk proof required');
 return ['mercury-evidence-chunk-v1',audience,record.scope.device_thumbprint,record.event.event_id,meta.evidence_id,meta.sha256,String(meta.bytes),String(index),sha,String(bytes)].join('\n');
}
export function validateWholePhoto(meta,bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length!==meta.bytes||photoHash(bytes)!==meta.sha256||bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255||bytes.at(-2)!==255||bytes.at(-1)!==217)throw Error('Original JPEG integrity mismatch');return bytes;
}
export function assemblePhotoChunks(meta,rows){
 if(!Array.isArray(rows)||rows.length!==Math.ceil(meta.bytes/PHOTO_CHUNK_BYTES))throw Error('Incomplete photo chunks');
 const ordered=rows.map((row,index)=>{if(Number(row.chunk_index)!==index||validatePhotoChunk(meta,index,row.bytes)!==row.sha256)throw Error('Original photo chunk mismatch');return row.bytes;});
 return validateWholePhoto(meta,Buffer.concat(ordered,meta.bytes));
}
export async function readPhotoBody(request,max){
 const reader=request.body?.getReader();if(!reader)throw Error('Body required');
 try{const chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Error('Photo request too large');}chunks.push(Buffer.from(value));}return Buffer.concat(chunks,size);}finally{reader.releaseLock();}
}
