export const MAX_PHOTO_BYTES=20*1024*1024;
export function photoMetadata(data){
 if(!data||typeof data!=='object'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(data.evidence_id??'')||! /^[a-f0-9]{64}$/.test(data.sha256??'')||!Number.isSafeInteger(data.bytes)||data.bytes<1||data.bytes>MAX_PHOTO_BYTES||!Number.isSafeInteger(data.width)||!Number.isSafeInteger(data.height)||data.width<1||data.height<1||data.width>50000||data.height>50000||data.width*data.height>100000000||data.capture!=='camera_intent')throw Error('Invalid photo metadata');
 return {evidence_id:data.evidence_id,sha256:data.sha256,bytes:data.bytes,width:data.width,height:data.height};
}
