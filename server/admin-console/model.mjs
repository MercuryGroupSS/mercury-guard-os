const id=(key,label)=>({key,label,type:'text',max:200,pattern:'[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}'});
const status={key:'active',label:'Status',type:'select',options:[['true','Active'],['false','Inactive']]};
const revision={key:'revision',label:'Approval revision',type:'number',min:1,max:2147483647,value:1};
const guard=id('guardId','Guard ID'),vendor=id('vendorId','Vendor ID'),site=id('siteId','Site ID'),assignment=id('assignmentId','Assignment ID');
const subject={key:'authSubject',label:'Individual account ID',type:'text',max:36,pattern:'[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}',hint:'The individual’s existing Auth account UUID. A company Vendor ID cannot identify a person.'};
export const actions={
 'vendor.create':{label:'Add vendor',help:'A vendor can be a company or an individual. Company guards each need their own account.',fields:[vendor,{key:'kind',label:'Vendor type',type:'select',options:[['company','Company'],['individual','Individual']]},status]},
 'vendor.status':{label:'Change vendor access',help:'Deactivating a vendor blocks all guards linked to that vendor.',fields:[vendor,status]},
 'site.create':{label:'Add site',help:'Register a site before approving site phones and assignments.',fields:[site,status]},
 'site.status':{label:'Change site access',help:'Deactivating a site prevents its phones and assignments from authorizing new work.',fields:[site,status]},
 'guard.link':{label:'Link guard account',help:'Link an existing individual account to a vendor. Active accounts require a confirmed email.',fields:[guard,vendor,subject,{key:'email',label:'Account email',type:'email',max:254},status]},
 'guard.status':{label:'Change guard access',help:'Activation verifies the individual account again. Deactivation blocks the existing session.',fields:[guard,status]},
 'device.enroll':{label:'Enroll phone',help:'Approve the public enrollment key exported by the phone. Private keys stay on the phone.',fields:[id('deviceId','Device ID'),{key:'mode',label:'Phone use',type:'select',options:[['site','Shared site phone'],['personal','Individual guard phone']]},{...site,optional:true},{...guard,optional:true},{key:'publicKeySpki',label:'Phone public enrollment key',type:'textarea',max:512,hint:'Paste the public enrollment value from Mercury One.'}]},
 'device.revoke':{label:'Revoke phone',help:'Revocation blocks new requests from this enrollment. Historical records remain.',fields:[id('deviceId','Device ID')]},
 'ops_binding.approve':{label:'Approve Ops assignment link',help:'Approve an exact Ops shift and individually authenticated guard. A running refresh worker imports approved shifts; withdrawal cancels the imported assignment.',fields:[id('opsShiftId','Ops shift ID'),guard,vendor,site,subject,revision,status],route:true,policy:true},
 'dashboard_mapping.approve':{label:'Approve Dashboard delivery link',help:'Map one Guard assignment to its receiving Dashboard shift and destination. A destination label alone does not enable a transport.',fields:[assignment,guard,vendor,site,id('dashboardShiftId','Dashboard shift ID'),id('destination','Approved destination'),revision,status]},
 'dispatch.publish':{label:'Publish assignment message',help:'Publish or retract a versioned message for one assignment. The phone receives it on its next authorized refresh.',fields:[assignment,guard,vendor,site,id('messageId','Message ID'),{...revision,key:'version',label:'Message version'},{key:'state',label:'Message status',type:'select',options:[['active','Active'],['retracted','Retracted']]},{key:'title',label:'Title',type:'text',max:200,optional:true},{key:'body',label:'Message',type:'textarea',max:8000,optional:true},{key:'due',label:'Due at (your local time)',type:'datetime-local',optional:true}]}
};
export const catalogs={
 vendors:{label:'Vendors',columns:['vendor_id','kind','active'],action:'vendor.status'},guards:{label:'Guards',columns:['guard_id','vendor_id','email','active','auth_subject'],action:'guard.status'},
 sites:{label:'Sites',columns:['site_id','active'],action:'site.status'},devices:{label:'Phones',columns:['device_id','mode','site_id','guard_id','active','revoked','revocation_version','thumbprint'],action:'device.revoke'},
 assignments:{label:'Assignments',columns:['assignment_id','guard_id','vendor_id','site_id','starts_at_ms','ends_at_ms','active','patrol_route','check_in_policy'],action:'dispatch.publish'},
 ops_bindings:{label:'Ops links',columns:['source_id','revision','body'],action:'ops_binding.approve'},dashboard_bindings:{label:'Delivery links',columns:['assignment_id','dashboard_shift_id','destination','revision','active'],action:'dashboard_mapping.approve'},
  outbox:{label:'Delivery queue',columns:['id','status','attempts','next_at','lease_until','destination','assignment_id']},audit:{label:'Audit',columns:['request_id','actor_subject','action','status','recorded_at','reason','receipt']}
};
export const labels={vendor_id:'Vendor ID',guard_id:'Guard ID',site_id:'Site ID',auth_subject:'Account ID',actor_subject:'Administrator',device_id:'Device ID',assignment_id:'Assignment ID',source_id:'Ops shift ID',dashboard_shift_id:'Dashboard shift ID',starts_at_ms:'Starts',ends_at_ms:'Ends',next_at:'Next attempt',lease_until:'Lease ends',recorded_at:'Recorded',publicKeySpki:'Public enrollment key',opsShiftId:'Ops shift ID',authSubject:'Account ID',vendorId:'Vendor ID',guardId:'Guard ID',siteId:'Site ID',deviceId:'Device ID',assignmentId:'Assignment ID',dashboardShiftId:'Dashboard shift ID',patrol_route:'Patrol route',check_in_policy:'Check-in policy',revocation_version:'Revocation version',thumbprint:'Enrollment fingerprint',request_id:'Request ID'};
export const label=key=>labels[key]??key.replaceAll('_',' ').replace(/^./,x=>x.toUpperCase());
export const formatValue=(key,value)=>value===null||value===undefined?'—':typeof value==='boolean'?(value?'Yes':'No'):['starts_at_ms','ends_at_ms','next_at','lease_until'].includes(key)&&Number(value)>0?new Date(Number(value)).toLocaleString():typeof value==='object'?JSON.stringify(value,null,2):String(value);
const stable=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
const integer=(value,min,max,name)=>{const n=Number(value);if(!String(value).trim()||!Number.isSafeInteger(n)||n<min||n>max)throw Error(`${name} must be a whole number between ${min} and ${max}.`);return n;};
export function buildPayload(action,values,now=Date.now()){
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
  }
  if(values.policyEnabled==='on'){
   const interval=integer(values.interval,1,1440,'Check-in interval')*60000,window=integer(values.window,1,86400,'Check-in window')*1000,age=integer(values.evidenceAge,1,300,'Evidence freshness')*1000,accuracy=Number(values.accuracy);
   if(window>interval||age>window||!Number.isFinite(accuracy)||accuracy<=0||accuracy>1000)throw Error('The check-in window must fit the interval, evidence freshness must fit the window, and GPS accuracy must be 1–1000 metres.');
   p.checkInPolicy={revision:integer(values.policyRevision,1,2147483647,'Policy revision'),interval_ms:interval,window_ms:window,max_evidence_age_ms:age,max_accuracy_m:accuracy};
  }
 }
 if(action==='dispatch.publish'){
  const {assignmentId,guardId,vendorId,siteId,messageId,version,state,title='',body='',due}=p;
  if(state==='active'&&(!title||!body))throw Error('An active message needs a title and message.');
  if(state==='retracted'&&(title||body))throw Error('Clear the title and message when retracting.');
  const dueAt=due?new Date(due).getTime():null;if(dueAt!==null&&(!Number.isSafeInteger(dueAt)||dueAt<now))throw Error('Message due time must be in the future.');
  return {scope:{assignmentId,guardId,vendorId,siteId},message:{message_id:messageId,version,state,title,body,issued_at:now,due_at:dueAt}};
 }
 return p;
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
}
export class PendingChange{
 constructor({owner,action,reason,payload,requestId}){if(!owner||!actions[action]||!reason.trim()||reason.trim().length>500||/[\u0000-\u001f]/.test(reason))throw Error('Enter a clear reason of up to 500 characters.');this.owner=owner;this.body=JSON.stringify({request_id:requestId,action,reason:reason.trim(),payload});this.attempted=false;this.uncertain=false;}
 request(owner){if(owner!==this.owner)throw Error('Sign in with the administrator who prepared this change.');this.attempted=true;return JSON.parse(this.body);}
 confirm(receipt){const sent=JSON.parse(this.body);if(receipt?.request_id!==sent.request_id||receipt?.action!==sent.action||!['applied','not_applied'].includes(receipt?.status))throw new ApiError('The receipt did not match this request. Retry the same request.');return receipt;}
}
