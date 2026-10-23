import {photoMetadata} from './photo-metadata.mjs';
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
// Cadence is an explicit administrator assignment policy, never a handset default.
export function checkInPolicy(value,startsAt,endsAt){
 if(!value||!integer(startsAt,1,Number.MAX_SAFE_INTEGER)||!integer(endsAt,startsAt+1,Number.MAX_SAFE_INTEGER)||
  !integer(value.revision,1,Number.MAX_SAFE_INTEGER)||!integer(value.interval_ms,60000,86400000)||
  !integer(value.window_ms,1000,value.interval_ms)||!integer(value.max_evidence_age_ms,1000,Math.min(300000,value.window_ms))||
  !Number.isFinite(value.max_accuracy_m)||value.max_accuracy_m<=0||value.max_accuracy_m>1000)throw Error('Invalid check-in policy');
 return {revision:value.revision,starts_at:startsAt,ends_at:endsAt,interval_ms:value.interval_ms,window_ms:value.window_ms,max_evidence_age_ms:value.max_evidence_age_ms,max_accuracy_m:value.max_accuracy_m};
}
export function validateCheckIn(policy,event,photo,scope){
 if(!policy)throw Error('Check-in schedule unavailable');
 const p=checkInPolicy(policy,policy.starts_at,policy.ends_at),d=event.data;
 if(!d||d.policy_revision!==p.revision||!integer(d.slot,0,Number.MAX_SAFE_INTEGER))throw Error('Check-in slot mismatch');
 const due=p.starts_at+d.slot*p.interval_ms,end=Math.min(due+p.window_ms,p.ends_at);
 if(!Number.isSafeInteger(due)||due>=p.ends_at||!integer(event.at,due,end-1))throw Error('Outside check-in window');
 const b=d.biometric,g=d.location;
 // This is a signed client observation, not biometric attestation or named-person proof.
 if(!b||b.method!=='android_local_biometric'||!integer(b.at,due,event.at)||event.at-b.at>p.max_evidence_age_ms)throw Error('Biometric observation unavailable');
 if(!g||!integer(g.at,b.at,event.at)||event.at-g.at>p.max_evidence_age_ms||g.mock!==false||
  !Number.isFinite(g.latitude)||g.latitude< -90||g.latitude>90||!Number.isFinite(g.longitude)||g.longitude< -180||g.longitude>180||
  !Number.isFinite(g.accuracy_m)||g.accuracy_m<=0||g.accuracy_m>p.max_accuracy_m)throw Error('Fresh location unavailable');
 if(!photo||photo.event.kind!=='photo_evidence'||photo.event.event_id!==d.photo_event_id||
  ['guard_id','site_id','assignment_id','device_thumbprint','revocation_version'].some(k=>photo.scope[k]!==scope[k])||
  !integer(photo.event.at,g.at,event.at)||event.at-photo.event.at>p.max_evidence_age_ms||
  photo.event.data.check_in_slot!==d.slot||photo.event.data.check_in_policy_revision!==p.revision)throw Error('Linked photo unavailable');
 const meta=photoMetadata(photo.event.data);if(meta.evidence_id!==d.evidence_id)throw Error('Photo identity mismatch');
 return {slot:d.slot,revision:p.revision,due_at:due};
}
