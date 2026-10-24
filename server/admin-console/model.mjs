const id=(key,label)=>({key,label,type:'text',max:200,pattern:'[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}'});
const status={key:'active',label:'Status',type:'select',options:[['true','Active'],['false','Inactive']]};
const revision={key:'revision',label:'Approval revision',type:'number',min:1,max:2147483647,value:1};
const guard=id('guardId','Guard ID'),vendor=id('vendorId','Vendor ID'),site=id('siteId','Site ID'),assignment=id('assignmentId','Assignment ID');
const subject={key:'authSubject',label:'Individual account ID',type:'text',max:36,pattern:'[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}',hint:'The individual’s existing Auth account UUID. A company Vendor ID cannot identify a person.'};
export const actions={
 'escalation.acknowledge':{label:'Acknowledge escalation',help:'Record that an operator has received this escalation. Your reason is shown to the guard. This acknowledgement does not resolve the event or confirm an external notification.',fields:[{key:'escalationId',label:'Escalation ID',type:'text',max:36,pattern:'[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}'}]},
 'vendor.create':{label:'Add vendor',help:'A vendor can be a company or an individual. Company guards each need their own account.',fields:[vendor,{key:'kind',label:'Vendor type',type:'select',options:[['company','Company'],['individual','Individual']]},status]},
 'vendor.status':{label:'Change vendor access',help:'Deactivating a vendor blocks all guards linked to that vendor.',fields:[vendor,status]},
 'site.create':{label:'Add site',help:'Register a site before approving site phones and assignments.',fields:[site,status]},
 'site.status':{label:'Change site access',help:'Deactivating a site prevents its phones and assignments from authorizing new work.',fields:[site,status]},
 'guard.link':{label:'Link guard account',help:'Link an existing individual account to a vendor. Active accounts require a confirmed email.',fields:[guard,vendor,subject,{key:'email',label:'Account email',type:'email',max:254},status]},
 'guard.status':{label:'Change guard access',help:'Activation verifies the individual account again. Deactivation blocks the existing session.',fields:[guard,status]},
 'device.enroll':{label:'Enroll phone',help:'Approve the public enrollment key exported by the phone. Private keys stay on the phone.',fields:[id('deviceId','Device ID'),{key:'mode',label:'Phone use',type:'select',options:[['site','Shared site phone'],['personal','Individual guard phone']]},{...site,optional:true},{...guard,optional:true},{key:'publicKeySpki',label:'Phone public enrollment key',type:'textarea',max:512,hint:'Paste the public enrollment value from Mercury One.'}]},
 'device.revoke':{label:'Revoke phone',help:'Revocation blocks new requests from this enrollment. Historical records remain.',fields:[id('deviceId','Device ID')]},
 'ops_binding.approve':{label:'Approve Ops assignment link',help:'Approve an exact Ops shift and individually authenticated guard. A running refresh worker imports approved shifts; withdrawal cancels the imported assignment. Continuous location stays disabled unless its reviewed policy and notice are explicitly included.',fields:[id('opsShiftId','Ops shift ID'),guard,vendor,site,subject,revision,status],route:true,policy:true,locationPolicy:true},
 'dashboard_mapping.approve':{label:'Approve Dashboard delivery link',help:'Map one Guard assignment to its receiving Dashboard shift and destination. A destination label alone does not enable a transport.',fields:[assignment,guard,vendor,site,id('dashboardShiftId','Dashboard shift ID'),id('destination','Approved destination'),revision,status]},
 'dispatch.publish':{label:'Publish assignment message',help:'Publish or retract a versioned message for one assignment. The phone receives it on its next authorized refresh.',fields:[assignment,guard,vendor,site,id('messageId','Message ID'),{...revision,key:'version',label:'Message version'},{key:'state',label:'Message status',type:'select',options:[['active','Active'],['retracted','Retracted']]},{key:'title',label:'Title',type:'text',max:200,optional:true},{key:'body',label:'Message',type:'textarea',max:8000,optional:true},{key:'due',label:'Due at (your local time)',type:'datetime-local',optional:true}]}
};
export const catalogs={
 escalations:{label:'Escalations',columns:['urgency','description','status','guard_id','site_id','received_at_ms','acknowledgement','escalation_id'],action:'escalation.acknowledge'},
 received_reports:{label:'Reports',columns:[]},
 administrators:{label:'Administrators',columns:['auth_subject','email','active']},access_audit:{label:'Access audit',columns:['request_id','email','active','operator_label','reason','recorded_at','receipt']},
 vendors:{label:'Vendors',columns:['vendor_id','kind','active'],action:'vendor.status'},guards:{label:'Guards',columns:['guard_id','vendor_id','email','active','auth_subject'],action:'guard.status'},
 sites:{label:'Sites',columns:['site_id','active'],action:'site.status'},devices:{label:'Phones',columns:['device_id','mode','site_id','guard_id','active','revoked','revocation_version','thumbprint'],action:'device.revoke'},
 assignments:{label:'Assignments',columns:['assignment_id','guard_id','vendor_id','site_id','starts_at_ms','ends_at_ms','active','patrol_route','check_in_policy','location_policy'],action:'dispatch.publish'},
 ops_bindings:{label:'Ops links',columns:['source_id','revision','body'],action:'ops_binding.approve'},dashboard_bindings:{label:'Delivery links',columns:['assignment_id','dashboard_shift_id','destination','revision','active'],action:'dashboard_mapping.approve'},
  outbox:{label:'Delivery queue',columns:['id','status','attempts','next_at','lease_until','destination','assignment_id']},audit:{label:'Audit',columns:['request_id','actor_subject','action','status','recorded_at','reason','receipt']}
};
export const labels={escalation_id:'Escalation ID',received_at_ms:'Received',acknowledgement:'Operator response',urgency:'Priority',description:'Request',vendor_id:'Vendor ID',guard_id:'Guard ID',site_id:'Site ID',auth_subject:'Account ID',actor_subject:'Administrator',device_id:'Device ID',assignment_id:'Assignment ID',source_id:'Ops shift ID',dashboard_shift_id:'Dashboard shift ID',starts_at_ms:'Starts',ends_at_ms:'Ends',next_at:'Next attempt',lease_until:'Lease ends',recorded_at:'Recorded',publicKeySpki:'Public enrollment key',opsShiftId:'Ops shift ID',authSubject:'Account ID',vendorId:'Vendor ID',guardId:'Guard ID',siteId:'Site ID',deviceId:'Device ID',assignmentId:'Assignment ID',dashboardShiftId:'Dashboard shift ID',patrol_route:'Patrol route',check_in_policy:'Check-in policy',revocation_version:'Revocation version',thumbprint:'Enrollment fingerprint',request_id:'Request ID'};
export const label=key=>labels[key]??key.replaceAll('_',' ').replace(/^./,x=>x.toUpperCase());
export const formatValue=(key,value)=>value===null||value===undefined?'—':typeof value==='boolean'?(value?'Yes':'No'):['starts_at_ms','ends_at_ms','next_at','lease_until','received_at_ms'].includes(key)&&Number(value)>0?new Date(Number(value)).toLocaleString():key==='status'&&value==='received_by_guard_service'?'Service received':key==='status'&&value==='operator_acknowledged'?'Operator acknowledged':typeof value==='object'?JSON.stringify(value,null,2):String(value);
const stable=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
const integer=(value,min,max,name)=>{const n=Number(value);if(!String(value??'').trim()||!Number.isSafeInteger(n)||n<min||n>max)throw Error(`${name} must be a whole number between ${min} and ${max}.`);return n;};
const decimal=(value,min,max,name,exclusiveMin=false)=>{const raw=String(value??'').trim(),n=Number(raw);if(!raw||!Number.isFinite(n)||(exclusiveMin?n<=min:n<min)||n>max)throw Error(`${name} must be ${exclusiveMin?'greater than '+min:'at least '+min} and no more than ${max}.`);return n;};
function reviewedLocationNotice(values){
 const notice=String(values.locationNotice??'').trim();
 if(!notice||notice.length>2000||new TextEncoder().encode(notice).length>6000||/[\u0000-\u0009\u000b-\u001f\u007f]/.test(notice))throw Error('Enter the complete reviewed location notice: up to 2,000 characters, with line breaks and no other control characters.');
 for(let i=0;i<notice.length;i++){const code=notice.charCodeAt(i);if(code>=0xd800&&code<=0xdbff){const next=notice.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))throw Error('The location notice contains an invalid character.');}else if(code>=0xdc00&&code<=0xdfff)throw Error('The location notice contains an invalid character.');}
 return notice;
}
function locationPolicyPayload(values,noticeSha256){
 const notice=reviewedLocationNotice(values);if(!/^[a-f0-9]{64}$/.test(noticeSha256??''))throw Error('Review the location notice before preparing its fingerprint.');
 const policy={version:1,revision:integer(values.locationRevision,1,Number.MAX_SAFE_INTEGER,'Location policy revision'),notice_revision:integer(values.locationNoticeRevision,1,Number.MAX_SAFE_INTEGER,'Location notice revision'),notice_text:notice,notice_sha256:noticeSha256,
  sample_interval_ms:integer(values.locationInterval,1000,3600000,'Location sample interval (milliseconds)'),min_distance_m:decimal(values.locationDistance,0,10000,'Minimum displacement (metres)'),max_fix_age_ms:integer(values.locationFreshness,1000,300000,'Location freshness (milliseconds)'),max_accuracy_m:decimal(values.locationAccuracy,0,1000,'Maximum GPS uncertainty (metres)',true),max_capture_lease_ms:integer(values.locationLease,1000,900000,'Location capture lease (milliseconds)'),geofence:null};
 if(values.locationCircleEnabled==='on'){
  const fenceId=String(values.locationFenceId??'').trim();if(!stable(fenceId))throw Error('Enter the approved geofence ID.');
  policy.geofence={type:'circle',id:fenceId,revision:integer(values.locationFenceRevision,1,Number.MAX_SAFE_INTEGER,'Geofence revision'),latitude:decimal(values.locationLatitude,-90,90,'Approved circle latitude'),longitude:decimal(values.locationLongitude,-180,180,'Approved circle longitude'),radius_m:decimal(values.locationRadius,0,100000,'Approved circle radius (metres)',true)};
 }
 return policy;
}
export async function buildReviewedPayload(action,values,now=Date.now()){
 values={...values};
 let digest;
 if(action==='ops_binding.approve'&&values.locationPolicyEnabled==='on'){
  const notice=reviewedLocationNotice(values),bytes=new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(notice)));
  digest=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
 }
 return buildPayload(action,values,now,digest);
}
export function buildPayload(action,values,now=Date.now(),locationNoticeSha256){
 const schema=actions[action];if(!schema)throw Error('Choose an action.');const p={};
 for(const f of schema.fields){const raw=String(values[f.key]??'').trim();if(!raw&&f.optional)continue;if(!raw)throw Error(`${f.label} is required.`);
  if(raw.length>(f.max??(f.type==='number'?20:10000))&&f.type!=='number')throw Error(`${f.label} is too long.`);
  if(f.type==='number')p[f.key]=integer(raw,f.min,f.max,f.label);
  else if(f.type==='select'){if(!f.options.some(([key])=>key===raw))throw Error(`Choose ${f.label.toLowerCase()}.`);p[f.key]=f.key==='active'?raw==='true':raw;}
  else if(f.type==='email'){if(!/^\S+@\S+\.\S+$/.test(raw))throw Error('Enter a valid account email.');p[f.key]=raw.toLowerCase();}
  else{if(f.pattern&&!new RegExp('^(?:'+f.pattern+')$').test(raw))throw Error(`${f.label} has an invalid format.`);p[f.key]=raw;}
 }
 if(action==='guard.link'||action==='ops_binding.approve')p.authSubject=p.authSubject.toLowerCase();
 if(action==='device.enroll'){
  if(p.mode==='site'&&(!p.siteId||p.guardId)||p.mode==='personal'&&(!p.guardId||p.siteId))throw Error('Site phones require only a Site ID. Individual phones require only a Guard ID.');
  if(!/^[A-Za-z0-9_-]{100,512}$/.test(p.publicKeySpki))throw Error('Paste the phone’s public enrollment value.');p.active=true;p.revoked=false;
 }
 if(action==='ops_binding.approve'){
  if(values.routeEnabled==='on'){
   const routeId=String(values.routeId??'').trim(),checkpoints=String(values.checkpoints??'').trim().split('\n').map(line=>{const split=line.indexOf('|');if(split<1)throw Error('Use one “ID | Label” checkpoint per line.');return {id:line.slice(0,split).trim(),label:line.slice(split+1).trim()};});
   if(!stable(routeId)||!checkpoints.length||checkpoints.length>100||checkpoints.some(c=>!stable(c.id)||!c.label||c.label.length>200)||new Set(checkpoints.map(c=>c.id)).size!==checkpoints.length)throw Error('Use a route ID and unique checkpoints, one “ID | Label” per line.');
   p.patrolRoute={routeId,revision:integer(values.routeRevision,1,2147483647,'Route revision'),checkpoints};
   if(values.routeGpsRequired==='true')p.patrolRoute.gps_required=true;
   else if(values.routeGpsRequired!==undefined&&values.routeGpsRequired!=='')throw Error('Choose legacy manual patrol or require an approved GPS fix.');
   const roundText=String(values.rounds??'').trim();
   if(roundText){
    const rounds=roundText.split('\n').map(line=>{const split=line.indexOf('|');if(split<1)throw Error('Use one “ID | Label” patrol round per line.');return {id:line.slice(0,split).trim(),label:line.slice(split+1).trim()};});
    if(roundText.length>26000||rounds.length>100||rounds.some(round=>!stable(round.id)||!round.label||round.label.length>200)||new Set(rounds.map(round=>round.id)).size!==rounds.length||new Set(rounds.map(round=>round.label.toLowerCase())).size!==rounds.length)throw Error('Use up to 100 patrol rounds with unique IDs and labels, one “ID | Label” per line.');
    p.patrolRoute.rounds=rounds;
   }
  }
  if(values.policyEnabled==='on'){
   const interval=integer(values.interval,1,1440,'Check-in interval')*60000,window=integer(values.window,1,86400,'Check-in window')*1000,age=integer(values.evidenceAge,1,300,'Evidence freshness')*1000,accuracy=Number(values.accuracy);
   if(window>interval||age>window||!Number.isFinite(accuracy)||accuracy<=0||accuracy>1000)throw Error('The check-in window must fit the interval, evidence freshness must fit the window, and GPS accuracy must be 1–1000 metres.');
   p.checkInPolicy={revision:integer(values.policyRevision,1,2147483647,'Policy revision'),interval_ms:interval,window_ms:window,max_evidence_age_ms:age,max_accuracy_m:accuracy};
   if(values.attentionProfile!==undefined&&values.attentionProfile!==''){
    if(values.attentionProfile!=='calm_progressive_v1')throw Error('Choose the existing single reminder or the calm progressive attention profile.');
    p.checkInPolicy.attention={version:1,profile:'calm_progressive_v1'};
   }
  }
  if(values.locationPolicyEnabled==='on')p.locationPolicy=locationPolicyPayload(values,locationNoticeSha256);
  if(p.patrolRoute?.gps_required===true&&!p.locationPolicy)throw Error('GPS-required checkpoints need the complete approved location policy and notice covering checkpoint fixes.');
 }
 if(action==='dispatch.publish'){
  const {assignmentId,guardId,vendorId,siteId,messageId,version,state,title='',body='',due}=p;
  if(state==='active'&&(!title||!body))throw Error('An active message needs a title and message.');
  if(state==='retracted'&&(title||body))throw Error('Clear the title and message when retracting.');
  const dueAt=due?new Date(due).getTime():null;if(dueAt!==null&&(!Number.isSafeInteger(dueAt)||dueAt<now))throw Error('Message due time must be in the future.');
  return {scope:{assignmentId,guardId,vendorId,siteId},message:{message_id:messageId,version,state,title,body,issued_at:now,due_at:dueAt}};
 }
 return action==='escalation.acknowledge'?{escalation_id:p.escalationId.toLowerCase()}:p;
}
export function valuesForRow(kind,row){
 const values=Object.fromEntries(Object.entries(row).map(([key,value])=>[key.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),value]));
 if(kind==='ops_bindings')return {...row.body,revision:Number(row.revision)+1};
 if(kind==='dashboard_bindings')values.revision=Number(row.revision)+1;
 if(kind==='assignments')Object.assign(values,{messageId:'',version:1,state:'active'});
 return values;
}
export class ApiError extends Error{constructor(message,status=0){super(message);this.status=status;}}
const errors={401:'Sign in again to continue.',403:'Administrator access is unavailable. Contact the owner.',409:'This request ID has different saved contents. Check the audit before submitting another change.',429:'Too many sign-in attempts. Wait a few minutes and try again.',400:'The server rejected this change. Check the IDs, approval revision, account status, and required fields.',503:'The service is temporarily unavailable. Try again.'};
export class AdminClient{
 constructor({fetchImpl=(...args)=>globalThis.fetch(...args),now=Date.now,onSessionLost=()=>{}}={}){this.fetch=fetchImpl;this.now=now;this.onSessionLost=onSessionLost;this.session=null;this.generation=0;}
 clear(){this.session=null;this.generation++;}
 async logout(){
  const session=this.session;this.clear();const generation=this.generation,finish=result=>generation===this.generation?result:null;
  if(!session)return finish('session_unavailable');
  try{
   const response=await this.fetch('/v1/session/logout',{method:'POST',cache:'no-store',credentials:'omit',redirect:'error',mode:'same-origin',signal:AbortSignal.timeout(15000),headers:{authorization:'Bearer '+session.token}});
   if(response.status===401){await response.body?.cancel();return finish('session_unavailable');}
   if(response.status!==200){await response.body?.cancel();return finish('unconfirmed');}
   const result=await response.json();return finish(result&&Object.keys(result).join()==='status'&&result.status==='signed_out'?'signed_out':'unconfirmed');
  }catch{return finish('unconfirmed');}
 }
 async send(path,{method='GET',body,token,signal}={}){
  if(!/^\/v1\/admin\/(login|me|catalog(?:\?[^#]*)?|actions|resolve)$/.test(path))throw Error('Invalid administration path');
  let response;try{response=await this.fetch(path,{method,cache:'no-store',credentials:'omit',redirect:'error',mode:'same-origin',signal:signal??AbortSignal.timeout(15000),headers:{...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}catch{throw new ApiError('Connection interrupted. Keep this tab open and retry the same request.');}
  if(!response.ok)throw new ApiError(errors[response.status]??'The service could not complete this request.',response.status);
  try{return await response.json();}catch{throw new ApiError('The response could not be confirmed. Keep this tab open and retry the same request.');}
 }
 async login(email,password){
  this.clear();const generation=this.generation;
  const result=await this.send('/v1/admin/login',{method:'POST',body:{email:email.trim().toLowerCase(),password}});
  if(typeof result.access_token!=='string'||!result.access_token||!Number.isSafeInteger(result.expires_at)||result.expires_at*1000<=this.now())throw new ApiError('The sign-in response was incomplete.');
  const me=await this.send('/v1/admin/me',{token:result.access_token});
  if(generation!==this.generation)throw new ApiError('Sign-in cancelled.');
  if(typeof me.subject!=='string'||me.role!=='guard_os_admin'||!Number.isSafeInteger(me.expires_at)||me.expires_at*1000<=this.now())throw new ApiError('Administrator access was not confirmed.');
  this.session={token:result.access_token,subject:me.subject,expiresAt:Math.min(result.expires_at,me.expires_at)};return {subject:me.subject,expiresAt:this.session.expiresAt};
 }
 async request(path,options={}){
  const session=this.session,generation=this.generation;
  if(!session||session.expiresAt*1000<=this.now()){this.clear();this.onSessionLost();throw new ApiError(errors[401],401);}
  try{const result=await this.send(path,{...options,token:session.token});if(generation!==this.generation)throw new ApiError('Session changed. Refresh before continuing.');return result;}
  catch(error){if([401,403].includes(error.status)&&generation===this.generation){this.clear();this.onSessionLost();}throw error;}
 }
 async media(media,{signal}={}){
  validateReportMedia(media);
  media={state:media.state,path:media.path,sha256:media.sha256,bytes:media.bytes};
  const session=this.session,generation=this.generation;
  if(!session||session.expiresAt*1000<=this.now()){this.clear();this.onSessionLost();throw new ApiError(errors[401],401);}
  try{
   const timeout=AbortSignal.timeout(30000),requestSignal=signal?AbortSignal.any([signal,timeout]):timeout;
   const current=()=>{
    if(generation!==this.generation)throw new ApiError('Session changed. Reload the photo after signing in.');
    if(session.expiresAt*1000<=this.now()){this.clear();this.onSessionLost();throw new ApiError(errors[401],401);}
    if(requestSignal.aborted)throw new ApiError('The private photo transfer was interrupted. Try again.');
   };
   const fetchPhoto=async range=>{
    current();let response;
    try{response=await this.fetch(media.path,{method:'GET',cache:'no-store',credentials:'omit',redirect:'error',mode:'same-origin',signal:requestSignal,headers:{authorization:'Bearer '+session.token,...(range?{range}:{})}});}catch{throw new ApiError('The private photo could not be loaded. Try again.');}
    if(!response.ok){await response.body?.cancel();throw new ApiError(errors[response.status]??'The private photo is unavailable.',response.status);}
    try{current();}catch(error){await response.body?.cancel();throw error;}
    return response;
   };
   let blob;
   if(media.bytes<=reportPhotoRangeBytes)blob=await readReportJpeg(await fetchPhoto(),media);
   else{
    const bytes=new Uint8Array(media.bytes);
    for(let start=0;start<media.bytes;start+=reportPhotoRangeBytes){
     const end=Math.min(media.bytes,start+reportPhotoRangeBytes)-1,response=await fetchPhoto('bytes='+start+'-'+end);
     const part=await readReportJpegRange(response,media,start,end);current();bytes.set(part,start);
    }
    blob=await checkedReportJpeg(bytes,media);
   }
   current();
   return blob;
  }catch(error){if([401,403].includes(error.status)&&generation===this.generation){this.clear();this.onSessionLost();}throw error;}
 }
}
export const maxReportPhotoBytes=20*1024*1024;
export const reportPhotoRangeBytes=1024*1024;
export function validateReportMedia(media){
 if(media?.state!=='stored'||!/^\/v1\/admin\/media\/[a-f0-9]{64}$/.test(media.path)||!/^[a-f0-9]{64}$/.test(media.sha256)||!Number.isSafeInteger(media.bytes)||media.bytes<4||media.bytes>maxReportPhotoBytes)throw new ApiError('The saved photo reference is incomplete. Refresh the report.');
}
export async function readReportJpeg(response,media){
 validateReportMedia(media);
 const fail=async()=>{await response.body?.cancel();throw new ApiError('The private photo failed validation. Refresh the report before trying again.');};
 if(response.headers.get('content-type')?.toLowerCase()!=='image/jpeg')return fail();
 const length=response.headers.get('content-length');if(length!==null&&(!/^[0-9]+$/.test(length)||Number(length)!==media.bytes))return fail();
 return checkedReportJpeg(await readReportPhotoBytes(response,media.bytes),media);
}
async function readReportJpegRange(response,media,start,end){
 const fail=async()=>{await response.body?.cancel();throw new ApiError('The private photo range failed validation. Refresh the report before trying again.');};
 if(response.status!==206||response.headers.get('content-type')?.toLowerCase()!=='image/jpeg'||response.headers.get('content-range')!=='bytes '+start+'-'+end+'/'+media.bytes||response.headers.get('content-length')!==String(end-start+1)||response.headers.get('etag')!=='"'+media.sha256+'"')return fail();
 return readReportPhotoBytes(response,end-start+1);
}
async function readReportPhotoBytes(response,expectedBytes){
 const reader=response.body?.getReader();if(!reader)throw new ApiError('The private photo has no contents.');
 const chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>expectedBytes||size>maxReportPhotoBytes){await reader.cancel();throw new ApiError('The private photo exceeded its saved size.');}chunks.push(value);}}
 catch(error){if(error instanceof ApiError)throw error;throw new ApiError('The private photo transfer was interrupted. Try again.');}finally{reader.releaseLock();}
 if(size!==expectedBytes)throw new ApiError('The private photo transfer was incomplete. Try again.');
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return bytes;
}
async function checkedReportJpeg(bytes,media){
 const size=bytes.length;
 if(bytes[0]!==255||bytes[1]!==216||bytes[2]!==255||bytes[size-2]!==255||bytes[size-1]!==217)throw new ApiError('The saved photo is not a JPEG image.');
 const digest=Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
 if(digest!==media.sha256)throw new ApiError('The private photo does not match its saved fingerprint.');
 return new Blob([bytes],{type:'image/jpeg'});
}
// One private object URL per visible report. A cleared or replaced request may
// finish, but it cannot create a new URL or restore an image in the old view.
export class ReportPhotoPreview{
 constructor({client,createObjectURL=blob=>URL.createObjectURL(blob),revokeObjectURL=url=>URL.revokeObjectURL(url)}){this.client=client;this.createObjectURL=createObjectURL;this.revokeObjectURL=revokeObjectURL;this.version=0;this.url=null;this.controller=null;}
 clear(){this.version++;this.controller?.abort();this.controller=null;if(this.url)this.revokeObjectURL(this.url);this.url=null;}
 async load(media){
  this.clear();const version=this.version,controller=new AbortController();this.controller=controller;
  try{const blob=await this.client.media(media,{signal:controller.signal});if(version!==this.version)return null;this.url=this.createObjectURL(blob);return this.url;}
  catch(error){if(version!==this.version)return null;throw error;}
  finally{if(version===this.version)this.controller=null;}
 }
}
const reportTitles={incident:'Incident report',location:'Location observation',check_in:'Timed check-in',patrol_checkpoint:'Patrol checkpoint',shift_start:'Shift started',shift_end:'Shift ended',dispatch_ack:'Message acknowledged',photo_evidence:'Photo evidence',check_in_miss_reason:'Missed check-in explanation',check_in_delivery_missing:'Check-in delivery overdue'};
export const reportDate=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString():'Unavailable';};
const positiveSafe=value=>Number.isSafeInteger(value)&&value>0;
const reportUuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const fingerprint=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const finiteRange=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
export function locationReportPresentation(data={}){
 const validation=data.server_validation,fence=validation?.geofence,states={inside:'Inside configured circle',outside:'Outside configured circle',uncertain:'Uncertain relative to configured circle',not_configured:'Geofence not configured'};
 const sample=reportUuid(data.capture_grant_id)&&reportUuid(data.consent_id)&&positiveSafe(data.policy_revision)&&fingerprint(data.policy_sha256)&&positiveSafe(data.fix_at_ms)&&finiteRange(data.latitude,-90,90)&&finiteRange(data.longitude,-180,180)&&finiteRange(data.accuracy_m,0,1000)&&data.accuracy_m>0&&data.mock===false;
 const geometry=fence&&Object.hasOwn(states,fence.state)&&(fence.state==='not_configured'?fence.fence_id===null&&fence.fence_revision===null&&fence.distance_m===null:stable(fence.fence_id)&&positiveSafe(fence.fence_revision)&&finiteRange(fence.distance_m,0,Number.MAX_VALUE));
 const validated=!!(sample&&validation?.version===1&&validation.status==='validated_device_observation'&&validation.policy_revision===data.policy_revision&&validation.policy_sha256===data.policy_sha256&&validation.consent_id===data.consent_id&&fingerprint(validation.notice_sha256)&&geometry);
 const assessment=validated?states[fence.state]:'Validation unavailable';
 const typed=(value,predicate)=>predicate(value)?value:'Unavailable';
 const rows=[['Server assessment',assessment],['Meaning','Device-reported observation only. This does not prove physical presence or trigger a geofence alert.'],['Fix recorded',positiveSafe(data.fix_at_ms)?reportDate(data.fix_at_ms):'Unavailable'],['Latitude',typed(data.latitude,x=>finiteRange(x,-90,90))],['Longitude',typed(data.longitude,x=>finiteRange(x,-180,180))],['GPS uncertainty',finiteRange(data.accuracy_m,0,1000)&&data.accuracy_m>0?data.accuracy_m+' metres':'Unavailable'],['Original capture grant',typed(data.capture_grant_id,reportUuid)],['Original consent ID',typed(data.consent_id,reportUuid)],['Original policy revision',typed(data.policy_revision,positiveSafe)],['Original policy fingerprint',typed(data.policy_sha256,fingerprint)],['Original notice fingerprint',validated?validation.notice_sha256:'Unavailable']];
 if(validated&&fence.state!=='not_configured')rows.push(['Configured geofence ID',fence.fence_id],['Configured geofence revision',fence.fence_revision],['Server distance to circle centre',String(fence.distance_m)+' metres']);
 return {summary:'Location sample · '+assessment,rows,validated};
}
export function reportPresentation(report){
 const observation=report?.observation??{},data=observation.data??{},title=reportTitles[observation.kind]??'Received observation',rows=[];
 let summary='Observation received.';
 switch(observation.kind){
  case 'location':{const view=locationReportPresentation(data);summary=view.summary;rows.push(...view.rows);break;}
  case 'incident':summary=String(data.description??'');rows.push(['Description',summary]);break;
  case 'patrol_checkpoint':{
   const location=data.location,view=location?locationReportPresentation({...location,capture_grant_id:'00000000-0000-0000-0000-000000000000'}):null;
   const validated=!!(view?.validated&&positiveSafe(location.requested_at_ms)&&location.requested_at_ms<=location.fix_at_ms&&positiveSafe(location.notice_revision)&&location.server_validation?.notice_revision===location.notice_revision&&location.notice_sha256===location.server_validation?.notice_sha256);
   const method=location?(validated?'GPS device observation':'GPS validation unavailable'):'Manual checkpoint';
   summary=method+' · Checkpoint '+String(data.checkpoint_id??'')+' · Route '+String(data.route_id??'')+(data.round_id?' · Round '+String(data.round_id):'');rows.push(['Checkpoint method',method],['Checkpoint',data.checkpoint_id],['Route',data.route_id],['Route revision',data.route_revision],['Patrol round',data.round_id??'Single pass (no declared round)']);
   if(view){const detail=validated?view:locationReportPresentation({...location,capture_grant_id:'00000000-0000-0000-0000-000000000000',server_validation:undefined});rows.push(['Fix requested',positiveSafe(location.requested_at_ms)?reportDate(location.requested_at_ms):'Unavailable'],['Original notice revision',validated?location.notice_revision:'Unavailable'],...detail.rows.filter(([title])=>title!=='Original capture grant'));}
   break;
  }
  case 'check_in':summary='Slot '+String(data.slot??'')+' · GPS and local biometric recorded';rows.push(['Check-in slot',data.slot],['Policy revision',data.policy_revision],['Local biometric','Recorded on this device; individual identity comes from the signed-in guard account.'],['Biometric recorded',reportDate(data.biometric?.at)],['GPS recorded',reportDate(data.location?.at)],['Latitude',data.location?.latitude],['Longitude',data.location?.longitude],['GPS uncertainty',String(data.location?.accuracy_m??'—')+' metres'],['Evidence ID',data.evidence_id]);break;
  case 'shift_start':summary='Clocked in '+reportDate(data.clocked_in_at_ms);rows.push(['Clocked in',reportDate(data.clocked_in_at_ms)]);break;
  case 'shift_end':summary=(data.early_exit?'Early clock-out':'Clocked out')+' · '+reportDate(data.clocked_out_at_ms);rows.push(['Clocked in',reportDate(data.clocked_in_at_ms)],['Clocked out',reportDate(data.clocked_out_at_ms)],['Early exit',data.early_exit?'Yes':'No'],['Reason',data.reason||'No reason recorded']);break;
  case 'dispatch_ack':summary='Message '+String(data.message_id??'')+' · Version '+String(data.message_version??'');rows.push(['Message ID',data.message_id],['Message version',data.message_version]);break;
  case 'photo_evidence':summary='Camera evidence recorded';rows.push(['Evidence ID',data.evidence_id],['Dimensions',String(data.width??'—')+' × '+String(data.height??'—')],['Photo fingerprint',data.sha256]);break;
  case 'check_in_miss_reason':summary=String(data.reason??'');rows.push(['Check-in slot',data.slot],['Policy revision',data.policy_revision],['Explanation',data.reason]);break;
  case 'check_in_delivery_missing':summary='No complete delivery by '+reportDate(data.deadline_at);rows.push(['Check-in slot',data.slot],['Policy revision',data.policy_revision],['Delivery deadline',reportDate(data.deadline_at)],['Detected',reportDate(data.detected_at)]);break;
 }
 return {title,summary,rows,photoLabel:report.media?.state==='stored'?'Private photo stored':report.media?.state==='pending'?'Photo pending':'No photo attached'};
}
export class PendingChange{
 constructor({owner,action,reason,payload,requestId}){if(!owner||!actions[action]||!reason.trim()||reason.trim().length>500||/[\u0000-\u001f]/.test(reason))throw Error('Enter a clear reason of up to 500 characters.');this.owner=owner;this.body=JSON.stringify({request_id:requestId,action,reason:reason.trim(),payload});this.attempted=false;this.uncertain=false;}
 request(owner){if(owner!==this.owner)throw Error('Sign in with the administrator who prepared this change.');this.attempted=true;return JSON.parse(this.body);}
 confirm(receipt){const sent=JSON.parse(this.body);if(receipt?.request_id!==sent.request_id||receipt?.action!==sent.action||!['applied','not_applied'].includes(receipt?.status))throw new ApiError('The receipt did not match this request. Retry the same request.');return receipt;}
}
