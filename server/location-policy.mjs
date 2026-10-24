import {createHash} from 'node:crypto';
const integer=(v,min,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const finite=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const stable=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export const locationDigest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function locationExact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!==[...keys].sort().join())throw Error('Exact location fields required');}
// These are protocol safety bounds, never an approved sampling default.
export function locationPolicy(value){
 locationExact(value,['version','revision','notice_revision','notice_text','notice_sha256','sample_interval_ms','min_distance_m','max_fix_age_ms','max_accuracy_m','max_capture_lease_ms','geofence']);
 if(value.version!==1||!integer(value.revision,1)||!integer(value.notice_revision,1)||typeof value.notice_text!=='string'||value.notice_text!==value.notice_text.trim()||value.notice_text.length<1||value.notice_text.length>2000||Buffer.byteLength(value.notice_text)>6000||new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(value.notice_text))!==value.notice_text||/[\x00-\x09\x0b-\x1f\x7f]/.test(value.notice_text)||!hex(value.notice_sha256)||locationDigest(value.notice_text)!==value.notice_sha256||!integer(value.sample_interval_ms,1000,3600000)||!finite(value.min_distance_m,0,10000)||!integer(value.max_fix_age_ms,1000,300000)||!finite(value.max_accuracy_m,Number.MIN_VALUE,1000)||!integer(value.max_capture_lease_ms,1000,900000))throw Error('Explicit approved location policy required');
 let geofence=null;
 if(value.geofence!==null){const g=value.geofence;locationExact(g,['type','id','revision','latitude','longitude','radius_m']);if(g.type!=='circle'||!stable(g.id)||!integer(g.revision,1)||!finite(g.latitude,-90,90)||!finite(g.longitude,-180,180)||!finite(g.radius_m,Number.MIN_VALUE,100000))throw Error('Explicit approved circle required');geofence={type:'circle',id:g.id,revision:g.revision,latitude:g.latitude,longitude:g.longitude,radius_m:g.radius_m};}
 const policy={version:1,revision:value.revision,notice_revision:value.notice_revision,notice_text:value.notice_text,notice_sha256:value.notice_sha256,sample_interval_ms:value.sample_interval_ms,min_distance_m:value.min_distance_m,max_fix_age_ms:value.max_fix_age_ms,max_accuracy_m:value.max_accuracy_m,max_capture_lease_ms:value.max_capture_lease_ms,geofence};
 if(Buffer.byteLength(JSON.stringify(policy))>7500)throw Error('Approved policy too large');return policy;
}
export function locationPolicySnapshot(value){const policy=locationPolicy(value),raw=Buffer.from(JSON.stringify(policy));return {policy,policy_sha256:locationDigest(raw),policy_payload:raw.toString('base64url')};}
export function decodeLocationPolicy(snapshot){
 if(!snapshot||!hex(snapshot.policy_sha256)||typeof snapshot.policy_payload!=='string'||snapshot.policy_payload.length>10000||!/^[A-Za-z0-9_-]+$/.test(snapshot.policy_payload))throw Error('Immutable location policy required');
 const raw=Buffer.from(snapshot.policy_payload,'base64url');if(raw.toString('base64url')!==snapshot.policy_payload||locationDigest(raw)!==snapshot.policy_sha256)throw Error('Location policy digest mismatch');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);if(!Buffer.from(text).equals(raw))throw Error('Exact UTF8 location policy required');const policy=locationPolicy(JSON.parse(text));if(JSON.stringify(policy)!==text)throw Error('Canonical location policy required');return policy;
}
export function locationAuthorization(value){locationExact(value,['consent_id','policy_sha256','policy_payload']);if(!uuid(value.consent_id))throw Error('Original location consent required');return {consent_id:value.consent_id,...locationPolicySnapshot(decodeLocationPolicy(value))};}
export function classifyLocation(policy,sample){
 const g=policy.geofence;if(g===null)return {state:'not_configured',fence_id:null,fence_revision:null,distance_m:null};
 const radians=x=>x*Math.PI/180,dLat=radians(sample.latitude-g.latitude),dLon=radians(sample.longitude-g.longitude),a=Math.sin(dLat/2)**2+Math.cos(radians(g.latitude))*Math.cos(radians(sample.latitude))*Math.sin(dLon/2)**2;
 const distance=6371008.8*2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,a))));
 return {state:distance+sample.accuracy_m<=g.radius_m?'inside':distance-sample.accuracy_m>g.radius_m?'outside':'uncertain',fence_id:g.id,fence_revision:g.revision,distance_m:distance};
}
export function validateLocationSample(authorization,event,grant,receivedAt){
 const snapshot=locationAuthorization(authorization),p=snapshot.policy,d=event?.data;
 locationExact(d,['capture_grant_id','consent_id','policy_revision','policy_sha256','fix_at_ms','latitude','longitude','accuracy_m','mock']);
 if(!uuid(d.capture_grant_id)||d.capture_grant_id!==grant.grant_id||d.consent_id!==snapshot.consent_id||d.policy_revision!==p.revision||d.policy_sha256!==snapshot.policy_sha256||!integer(event.at,1)||!integer(receivedAt,event.at)||!integer(grant.not_before_ms,1)||!integer(grant.expires_at_ms,grant.not_before_ms+1)||event.at<grant.not_before_ms||event.at>=grant.expires_at_ms||!integer(d.fix_at_ms,grant.not_before_ms,event.at)||event.at-d.fix_at_ms>p.max_fix_age_ms||!finite(d.latitude,-90,90)||!finite(d.longitude,-180,180)||!finite(d.accuracy_m,Number.MIN_VALUE,p.max_accuracy_m)||d.mock!==false)throw Error('Fresh policy-bound device location required');
 return {version:1,status:'validated_device_observation',policy_revision:p.revision,policy_sha256:snapshot.policy_sha256,consent_id:snapshot.consent_id,notice_sha256:p.notice_sha256,geofence:classifyLocation(p,d)};
}
export function projectLocationObservation(record){
 const d=record?.event?.data,v=record?.location_validation;
 locationExact(d,['capture_grant_id','consent_id','policy_revision','policy_sha256','fix_at_ms','latitude','longitude','accuracy_m','mock']);locationExact(v,['version','status','policy_revision','policy_sha256','consent_id','notice_sha256','geofence']);
 if(!uuid(d.capture_grant_id)||!uuid(d.consent_id)||!integer(d.policy_revision,1)||!hex(d.policy_sha256)||!integer(d.fix_at_ms,1,record.event.at)||!finite(d.latitude,-90,90)||!finite(d.longitude,-180,180)||!finite(d.accuracy_m,Number.MIN_VALUE,1000)||d.mock!==false||v.version!==1||v.status!=='validated_device_observation'||v.policy_revision!==d.policy_revision||v.policy_sha256!==d.policy_sha256||v.consent_id!==d.consent_id||!hex(v.notice_sha256))throw Error('Stored server-validated location required');
 const g=v.geofence;locationExact(g,['state','fence_id','fence_revision','distance_m']);if(g.state==='not_configured'){if(g.fence_id!==null||g.fence_revision!==null||g.distance_m!==null)throw Error('Unconfigured location geometry mismatch');}else if(!['inside','outside','uncertain'].includes(g.state)||!stable(g.fence_id)||!integer(g.fence_revision,1)||!finite(g.distance_m,0,21000000))throw Error('Stored geofence classification required');
 return {...d,server_validation:{...v,geofence:{...g}}};
}
