import {createHash} from 'node:crypto';
import {createPostgresLoginLimiter} from './postgres-login-limiter.mjs';
import {PostgresOpsAssignmentSync} from './postgres-ops-assignment-sync.mjs';
import {PostgresOpsBindingStore} from './postgres-ops-binding-store.mjs';
import {PostgresDashboardBindings} from './postgres-dashboard-delivery.mjs';
import {PostgresDispatchFeed} from './postgres-dispatch-feed.mjs';
import {receivedReportsCatalog,receivedReportMedia} from './received-reports.mjs';
const stable=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
const exact=(x,keys,optional=[])=>{if(!x||typeof x!=='object'||Array.isArray(x)||keys.some(k=>!Object.hasOwn(x,k))||Object.keys(x).some(k=>![...keys,...optional].includes(k)))throw Error('Unexpected administration fields');};
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const bool=x=>{if(typeof x!=='boolean')throw Error('Explicit status required');};
const ids=(p,keys)=>{if(keys.some(k=>!stable(p[k])))throw Error('Stable identity required');};
function validate(action,p){
 switch(action){
  case 'vendor.create':exact(p,['vendorId','kind','active']);ids(p,['vendorId']);bool(p.active);if(!['company','individual'].includes(p.kind))throw Error('Vendor kind required');break;
  case 'vendor.status':exact(p,['vendorId','active']);ids(p,['vendorId']);bool(p.active);break;
  case 'site.create':case 'site.status':exact(p,['siteId','active']);ids(p,['siteId']);bool(p.active);break;
  case 'guard.link':exact(p,['guardId','vendorId','authSubject','email','active']);ids(p,['guardId','vendorId']);bool(p.active);if(!uuid(p.authSubject)||typeof p.email!=='string'||p.email!==p.email.toLowerCase()||p.email.length>254||!/^\S+@\S+\.\S+$/.test(p.email))throw Error('Verified individual account required');break;
  case 'guard.status':exact(p,['guardId','active']);ids(p,['guardId']);bool(p.active);break;
  case 'device.enroll':exact(p,['deviceId','mode','active','revoked','publicKeySpki'],['siteId','guardId']);ids(p,['deviceId']);break;
  case 'device.revoke':exact(p,['deviceId']);ids(p,['deviceId']);break;
  case 'ops_binding.approve':exact(p,['opsShiftId','guardId','vendorId','siteId','authSubject','revision','active'],['patrolRoute','checkInPolicy']);break;
  case 'dashboard_mapping.approve':exact(p,['assignmentId','guardId','vendorId','siteId','dashboardShiftId','destination','revision','active']);break;
  case 'dispatch.publish':exact(p,['scope','message']);exact(p.scope,['guardId','vendorId','siteId','assignmentId']);exact(p.message,['message_id','version','state','title','body','issued_at','due_at']);break;
  default:throw Error('Unknown administration action');
 }
}
export class AdminDeniedError extends Error{}
export class AdminConflictError extends Error{}
function prepareRequest(request,subject){
 exact(request,['request_id','action','reason','payload']);
 request={...request,request_id:typeof request.request_id==='string'?request.request_id.toLowerCase():request.request_id,payload:structuredClone(request.payload)};
 if(['guard.link','ops_binding.approve'].includes(request.action)&&typeof request.payload?.authSubject==='string')request.payload.authSubject=request.payload.authSubject.toLowerCase();
 if(!uuid(request.request_id)||typeof request.reason!=='string'||!request.reason.trim()||request.reason.length>500||/[\u0000-\u001f]/.test(request.reason))throw Error('Audited administration request required');
 validate(request.action,request.payload);const input={action:request.action,reason:request.reason.trim(),payload:request.payload};
 return {request,input,digest:createHash('sha256').update(JSON.stringify(canonical({actor:subject,...input}))).digest('hex')};
}
const requestLock=requestId=>createHash('sha256').update('mercury-admin:'+requestId).digest().readBigInt64BE().toString();
export class PostgresAdministration{
 constructor({devices,loadAuthAccount,now=Date.now}){if(typeof devices?.transaction!=='function'||typeof devices?.pool?.query!=='function')throw Error('Transactional PostgreSQL devices required');this.devices=devices;this.pool=devices.pool;this.loadAuthAccount=loadAuthAccount;this.now=now;this.consumeLoginAttempt=createPostgresLoginLimiter(this.pool);this.ops=new PostgresOpsBindingStore(this.pool);this.sync=new PostgresOpsAssignmentSync(devices);this.bindings=new PostgresDashboardBindings(devices);this.dispatch=new PostgresDispatchFeed(devices);}
 async member(session,client=this.pool,lock=false){
  if(!uuid(session?.subject)||session.active!==true||!Number.isSafeInteger(session.expiresAt)||session.expiresAt*1000<=this.now())return false;
  return (await client.query('SELECT auth_subject FROM mercury_guard.admin_accounts WHERE auth_subject=$1 AND active'+(lock?' FOR SHARE':''),[session.subject])).rowCount===1;
 }
 async loginAccount(email){const r=(await this.pool.query('SELECT auth_subject,email FROM mercury_guard.admin_accounts WHERE email=$1 AND active',[email])).rows[0];return r?{subject:r.auth_subject,email:r.email}:null;}
 async catalog(session,kind,after=''){
  if(kind==='received_reports')return this.devices.transaction(async client=>{if(!await this.member(session,client,true))throw new AdminDeniedError('Administrator unavailable');return receivedReportsCatalog(client,after);});
  const catalog={audit:['request_id',"SELECT request_id,actor_subject,action,recorded_at,input->>'reason' AS reason,receipt->>'status' AS status,receipt FROM mercury_guard.admin_audit WHERE request_id>COALESCE(NULLIF($1,'')::uuid,'00000000-0000-0000-0000-000000000000'::uuid) ORDER BY request_id LIMIT 51"],vendors:['vendor_id','SELECT vendor_id,kind,active FROM mercury_guard.vendors WHERE vendor_id>$1 ORDER BY vendor_id LIMIT 51'],
   administrators:['auth_subject',"SELECT auth_subject,email,active FROM mercury_guard.admin_accounts WHERE auth_subject>COALESCE(NULLIF($1,'')::uuid,'00000000-0000-0000-0000-000000000000'::uuid) ORDER BY auth_subject LIMIT 51"],
   access_audit:['request_id',"SELECT request_id,auth_subject,email,active,operator_label,reason,recorded_at,receipt FROM mercury_guard.admin_membership_audit WHERE request_id>COALESCE(NULLIF($1,'')::uuid,'00000000-0000-0000-0000-000000000000'::uuid) ORDER BY request_id LIMIT 51"],
   guards:['guard_id','SELECT g.guard_id,g.vendor_id,g.auth_subject,g.active,l.email FROM mercury_guard.guards g LEFT JOIN mercury_guard.guard_login l USING(guard_id) WHERE g.guard_id>$1 ORDER BY g.guard_id LIMIT 51'],
   sites:['site_id','SELECT site_id,active FROM mercury_guard.sites WHERE site_id>$1 ORDER BY site_id LIMIT 51'],
   devices:['device_id','SELECT device_id,mode,site_id,guard_id,thumbprint,active,revoked,revocation_version FROM mercury_guard.devices WHERE device_id>$1 ORDER BY device_id LIMIT 51'],
   assignments:['assignment_id','SELECT assignment_id,guard_id,vendor_id,site_id,starts_at_ms,ends_at_ms,active,patrol_route,check_in_policy FROM mercury_guard.assignments WHERE assignment_id>$1 ORDER BY assignment_id LIMIT 51'],
   ops_bindings:['source_id','SELECT source_id,revision,body FROM mercury_guard.ops_bindings WHERE source_id>$1 ORDER BY source_id LIMIT 51'],
   dashboard_bindings:['assignment_id','SELECT * FROM mercury_guard.dashboard_bindings WHERE assignment_id>$1 ORDER BY assignment_id LIMIT 51'],
   outbox:['id','SELECT id,status,attempts,next_at,lease_until,destination,assignment_id,guard_id,vendor_id,site_id FROM mercury_guard.dashboard_outbox WHERE id>$1 ORDER BY id LIMIT 51']};
  if(!Object.hasOwn(catalog,kind)||(after!==''&&!stable(after)))throw Error('Bounded catalog required');
  return this.devices.transaction(async client=>{if(!await this.member(session,client,true))throw new AdminDeniedError('Administrator unavailable');const [key,sql]=catalog[kind],rows=(await client.query(sql,[after])).rows,items=rows.slice(0,50);return {kind,items,next_cursor:rows.length>50?items.at(-1)[key]:null};});
 }
 async media(session,deliveryId){return this.devices.transaction(async client=>{if(!await this.member(session,client,true))throw new AdminDeniedError('Administrator unavailable');return receivedReportMedia(client,deliveryId);});}
 async settle(session,value){
  const {request,input,digest}=prepareRequest(value,session?.subject);
  return this.devices.transaction(async client=>{
   if(!await this.member(session,client,true))throw new AdminDeniedError('Administrator unavailable');
   await client.query('SELECT pg_advisory_xact_lock($1::bigint)',[requestLock(request.request_id)]);
   const old=(await client.query('SELECT actor_subject,request_digest,receipt FROM mercury_guard.admin_audit WHERE request_id=$1',[request.request_id])).rows[0];
   if(old){if(old.actor_subject!==session.subject||old.request_digest!==digest)throw new AdminConflictError('Request ID changed');return old.receipt;}
   // Reserve an immutable not-applied receipt. A delayed apply of this same ID
   // must observe it under the same lock and can never perform the mutation.
   const receipt={request_id:request.request_id,action:request.action,status:'not_applied',result:{},server_time_ms:this.now()};
   await client.query('INSERT INTO mercury_guard.admin_audit(request_id,actor_subject,action,request_digest,input,receipt) VALUES($1,$2,$3,$4,$5,$6)',[request.request_id,session.subject,request.action,digest,input,receipt]);return receipt;
  });
 }
 async apply(session,value){
  const {request,input,digest}=prepareRequest(value,session?.subject);if(!await this.member(session))throw new AdminDeniedError('Administrator unavailable');
  const prior=(await this.pool.query('SELECT request_id FROM mercury_guard.admin_audit WHERE request_id=$1',[request.request_id])).rows[0];
  let account=null,expectedGuard=null;
  if(!prior&&(request.action==='guard.link'||request.action==='guard.status'&&request.payload.active)){
   if(typeof this.loadAuthAccount!=='function')throw Error('Auth account verification unavailable');
   if(request.action==='guard.link')expectedGuard={auth_subject:request.payload.authSubject,email:request.payload.email};
   else expectedGuard=(await this.pool.query('SELECT g.auth_subject,l.email FROM mercury_guard.guards g JOIN mercury_guard.guard_login l USING(guard_id) WHERE g.guard_id=$1',[request.payload.guardId])).rows[0];
   if(!expectedGuard)throw Error('Guard account unavailable');account=await this.loadAuthAccount(expectedGuard.auth_subject);
   if(!account||account.subject!==expectedGuard.auth_subject||account.email!==expectedGuard.email||request.payload.active&&(!account.confirmed||!account.enabled))throw Error('Guard account verification failed');
  }
  return this.devices.transaction(async client=>{
   if(!await this.member(session,client,true))throw new AdminDeniedError('Administrator unavailable');
   await client.query('SELECT pg_advisory_xact_lock($1::bigint)',[requestLock(request.request_id)]);
   const old=(await client.query('SELECT actor_subject,request_digest,receipt FROM mercury_guard.admin_audit WHERE request_id=$1',[request.request_id])).rows[0];
   if(old){if(old.actor_subject!==session.subject||old.request_digest!==digest)throw new AdminConflictError('Request ID changed');return old.receipt;}
   const p=request.payload;let result;
   const update=async(sql,values)=>{if((await client.query(sql,values)).rowCount!==1)throw Error('Unknown administration target');};
   switch(request.action){
    case 'vendor.create':await client.query('INSERT INTO mercury_guard.vendors(vendor_id,kind,active) VALUES($1,$2,$3)',[p.vendorId,p.kind,p.active]);result={vendor_id:p.vendorId};break;
    case 'vendor.status':await update('UPDATE mercury_guard.vendors SET active=$1 WHERE vendor_id=$2',[p.active,p.vendorId]);result={vendor_id:p.vendorId,active:p.active};break;
    case 'site.create':await client.query('INSERT INTO mercury_guard.sites VALUES($1,$2)',[p.siteId,p.active]);result={site_id:p.siteId};break;
    case 'site.status':await update('UPDATE mercury_guard.sites SET active=$1 WHERE site_id=$2',[p.active,p.siteId]);result={site_id:p.siteId,active:p.active};break;
    case 'guard.link':if(!account)throw Error('Auth account verification required');await client.query('INSERT INTO mercury_guard.guards(guard_id,auth_subject,vendor_id,active) VALUES($1,$2,$3,$4)',[p.guardId,p.authSubject,p.vendorId,p.active]);await client.query('INSERT INTO mercury_guard.guard_login VALUES($1,$2)',[p.guardId,p.email]);result={guard_id:p.guardId,vendor_id:p.vendorId};break;
    case 'guard.status':if(p.active&&(!account||!expectedGuard))throw Error('Auth account verification required');await update('UPDATE mercury_guard.guards SET active=$1 WHERE guard_id=$2'+(p.active?' AND auth_subject=$3':''),p.active?[p.active,p.guardId,expectedGuard.auth_subject]:[p.active,p.guardId]);result={guard_id:p.guardId,active:p.active};break;
    case 'device.enroll':await this.devices.enroll(p,client);result={device_id:p.deviceId};break;
    case 'device.revoke':await this.devices.revoke(p.deviceId,client);result={device_id:p.deviceId,revoked:true};break;
    case 'ops_binding.approve':
     if(!uuid(p.authSubject)||(await client.query(`SELECT 1 FROM mercury_guard.guards g JOIN mercury_guard.vendors v ON v.vendor_id=g.vendor_id JOIN mercury_guard.sites s ON s.site_id=$1 WHERE g.guard_id=$2 AND g.vendor_id=$3 AND g.auth_subject=$4::uuid AND ($5=false OR(g.active AND v.active AND s.active)) FOR SHARE OF g,v,s`,[p.siteId,p.guardId,p.vendorId,p.authSubject,p.active])).rowCount!==1)throw Error('Individual Ops binding unavailable');
     result=await this.ops.approve(p,{operator:session.subject,reason:input.reason,now:this.now()},client);if(!p.active)result={...result,revocation:(await this.sync.revokeBinding(p,client)).status};break;
    case 'dashboard_mapping.approve':await this.bindings.approve(p,client);result={assignment_id:p.assignmentId,revision:p.revision};break;
    case 'dispatch.publish':await this.dispatch.publish(p.scope,p.message,client);result={message_id:p.message.message_id,version:p.message.version};break;
   }
   const receipt={request_id:request.request_id,action:request.action,status:'applied',result,server_time_ms:this.now()};
   await client.query('INSERT INTO mercury_guard.admin_audit(request_id,actor_subject,action,request_digest,input,receipt) VALUES($1,$2,$3,$4,$5,$6)',[request.request_id,session.subject,request.action,digest,input,receipt]);return receipt;
  });
 }
}
