import {locationExact,locationAuthorization,validateLocationSample,projectLocationObservation} from './location-policy.mjs';
import {permitsCheckpoint} from './patrol-route.mjs';
const integer=(v,min,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const fields=['requested_at_ms','fix_at_ms','consent_id','policy_revision','notice_revision','policy_sha256','notice_sha256','latitude','longitude','accuracy_m','mock'];
const sampleData=(event,location)=>({capture_grant_id:event.data.capture_grant_id,consent_id:location.consent_id,policy_revision:location.policy_revision,policy_sha256:location.policy_sha256,fix_at_ms:location.fix_at_ms,latitude:location.latitude,longitude:location.longitude,accuracy_m:location.accuracy_m,mock:location.mock});
export function validatePatrolCheckpoint(route,event,grant,receivedAt){
 if(!permitsCheckpoint(route,event?.data)||Object.hasOwn(route,'gps_required')&&route.gps_required!==true)throw Error('Original checkpoint policy required');
 if(route.gps_required!==true){if(Object.hasOwn(event.data,'location'))throw Error('Legacy manual checkpoint cannot claim GPS validation');return null;}
 const location=event.data.location;locationExact(location,fields);
 const snapshot=locationAuthorization(grant.location),policy=snapshot.policy;
 if(!grant.actions?.includes('location')||!integer(location.requested_at_ms,grant.not_before_ms,location.fix_at_ms)||location.notice_revision!==policy.notice_revision||location.notice_sha256!==policy.notice_sha256)throw Error('Original checkpoint location purpose and fresh request required');
 const validation=validateLocationSample(grant.location,{...event,data:sampleData(event,location)},grant,receivedAt);
 return {version:validation.version,status:validation.status,consent_id:validation.consent_id,policy_revision:validation.policy_revision,policy_sha256:validation.policy_sha256,notice_revision:policy.notice_revision,notice_sha256:validation.notice_sha256,geofence:validation.geofence};
}
export function projectPatrolLocation(record){
 const event=record?.event,location=event?.data?.location,validation=record?.checkpoint_location_validation;
 locationExact(location,fields);locationExact(validation,['version','status','consent_id','policy_revision','policy_sha256','notice_revision','notice_sha256','geofence']);
 if(!integer(location.requested_at_ms,1,location.fix_at_ms)||!integer(location.notice_revision,1)||validation.notice_revision!==location.notice_revision||validation.notice_sha256!==location.notice_sha256)throw Error('Stored checkpoint notice and request required');
 const {notice_revision,...ordinaryValidation}=validation;
 const projected=projectLocationObservation({event:{...event,data:sampleData(event,location)},location_validation:ordinaryValidation});
 return {...location,server_validation:{...validation,geofence:projected.server_validation.geofence}};
}
