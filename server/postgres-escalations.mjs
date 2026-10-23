import {createHash} from 'node:crypto';
import {AdminDeniedError,AdminConflictError} from './postgres-administration.mjs';
import {createPostgresAuthSessionReader} from './postgres-auth-session.mjs';
import {createPostgresEscalationProofAuthorizer,prepareEscalationProof} from './escalation-proof.mjs';
import {prepareEscalationIntent,escalationStatusPayload,prepareEscalationAcknowledgement,escalationDigest,escalationUuid,escalationStable,escalationCatalogCursor,parseEscalationCatalogCursor,EscalationAuthError,EscalationDeniedError,EscalationConflictError,EscalationNotFoundError,EscalationInputError} from './escalation-input.mjs';
const lock=value=>createHash('sha256').update(value).digest().readBigInt64BE().toString();
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
function adminRequest(value,subject){const request=prepareEscalationAcknowledgement(value),input={action:'escalation.acknowledge',reason:request.reason,payload:{escalation_id:request.escalation_id}},digest=escalationDigest(JSON.stringify(canonical({actor:subject,...input})));return {request,input,digest};}
const scopeKeys=['subject','guard_id','vendor_id','device_id','device_thumbprint','revocation_version','site_id','assignment_id'];
const receiptKeys=['version','escalation_id','intent_sha256','status','received_at_ms'];
function receiptFor(id,hash,at){return {version:1,escalation_id:id,intent_sha256:hash,status:'received_by_guard_service',received_at_ms:at};}
function storedRow(row){
 if(!row)return null;
 const prepared=prepareEscalationIntent(Buffer.from(row.intent_raw,'utf8').toString('base64url')),at=Number(row.received_at_ms),intent=prepared.intent;
 if(prepared.hash!==row.intent_sha256||intent.escalation_id!==row.escalation_id||intent.guard_id!==row.guard_id||intent.vendor_id!==row.vendor_id||intent.assignment_id!==row.assignment_id||!Number.isSafeInteger(at)||at<=0)throw Error('Immutable escalation attribution failed');
 const expected=receiptFor(intent.escalation_id,prepared.hash,at);
 if(!row.receipt||Object.keys(row.receipt).sort().join()!==[...receiptKeys].sort().join()||receiptKeys.some(k=>row.receipt[k]!==expected[k]))throw Error('Immutable escalation receipt failed');
 return {row,intent,receipt:expected};
}
function acknowledgement(row){
 if(!row)return null;
 const at=Number(row.acknowledged_at_ms);if(!escalationUuid(row.actor_subject)||!Number.isSafeInteger(at)||at<=0||typeof row.note!=='string'||!row.note.trim()||row.note.length>2000)throw Error('Escalation acknowledgement integrity failed');
 return {operator_subject:row.actor_subject,acknowledged_at_ms:at,note:row.note};
}
const snapshot=(record,ack)=>({...record.receipt,status:ack?'operator_acknowledged':'received_by_guard_service',acknowledgement:ack});
/** Private inbox only. Receipt and human acknowledgement never claim an
 * external contact was notified, an emergency call occurred or an issue resolved. */
export class PostgresEscalations{
 constructor({devices,audience='mercury-local',authorizeProof,now=Date.now}){
  if(typeof devices?.transaction!=='function'||typeof devices?.pool?.query!=='function'||typeof now!=='function'||typeof audience!=='string'||!/^[A-Za-z0-9._:/-]{1,128}$/.test(audience))throw Error('Transactional escalation store and fixed audience required');
  this.devices=devices;this.pool=devices.pool;this.audience=audience;this.authorizeProof=authorizeProof??createPostgresEscalationProofAuthorizer(audience);if(typeof this.authorizeProof!=='function')throw Error('Escalation proof authorizer required');this.now=now;
 }
 async requireSession(client,session){
  if(!session||session.active!==true||!escalationUuid(session.subject)||!escalationUuid(session.sessionId)||!Number.isSafeInteger(session.expiresAt)||session.expiresAt*1000<=this.now()||!await createPostgresAuthSessionReader(client)(session.subject,session.sessionId))throw new EscalationAuthError('Current individual session required');
 }
 async requireOperator(client,session){try{await this.requireSession(client,session);}catch(error){if(error instanceof EscalationAuthError)throw new AdminDeniedError('Current operator session required');throw error;}if((await client.query('SELECT auth_subject FROM mercury_guard.admin_accounts WHERE auth_subject=$1 AND active FOR SHARE',[session.subject])).rowCount!==1)throw new AdminDeniedError('Current operator approval required');}
 async lockGuard(client,session,authority){
  if(!authority||!escalationStable(authority.deviceId)||!/^[a-f0-9]{64}$/.test(authority.thumbprint)||typeof authority.publicKeySpki!=='string'||!Number.isSafeInteger(authority.revocationVersion)||authority.revocationVersion<1)throw new EscalationDeniedError('Verified escalation device required');
  const row=(await client.query(`SELECT g.guard_id,g.vendor_id,d.mode,d.site_id,d.guard_id AS device_guard_id FROM mercury_guard.guards g
   JOIN mercury_guard.vendors v ON v.vendor_id=g.vendor_id JOIN mercury_guard.devices d ON d.device_id=$2
   WHERE g.auth_subject=$1::uuid AND g.active AND v.active AND d.active AND NOT d.revoked
    AND d.thumbprint=$3 AND d.public_key_spki=$4 AND d.revocation_version=$5
    AND (d.mode='site' OR (d.mode='personal' AND d.guard_id=g.guard_id))
   FOR SHARE OF g,v,d`,[session.subject,authority.deviceId,authority.thumbprint,authority.publicKeySpki,authority.revocationVersion])).rows[0];
  if(!row)throw new EscalationDeniedError('Current guard, vendor and enrollment required');
  if(row.mode==='site')await this.lockSite(client,row.site_id);
  return row;
 }
 async lockSite(client,site){if(!escalationStable(site)||(await client.query('SELECT site_id FROM mercury_guard.sites WHERE site_id=$1 AND active FOR SHARE',[site])).rowCount!==1)throw new EscalationDeniedError('Current site approval required');}
 async receive(session,encodedIntent,proof){
  const prepared=prepareEscalationIntent(encodedIntent),p=prepareEscalationProof(proof,this.audience),intent=prepared.intent;
  return this.devices.transaction(async client=>{
   await this.requireSession(client,session);
   const at=this.now(),authority=await this.authorizeProof({client,session,operation:'create',payloadHash:prepared.hash,proof:p,now:at}),guard=await this.lockGuard(client,session,authority);
   if(guard.guard_id!==intent.guard_id||guard.vendor_id!==intent.vendor_id)throw new EscalationDeniedError('Original escalation guard identity required');
   if(intent.occurred_at_ms>at)throw new EscalationInputError('Escalation observation is in the future');
   let site=guard.mode==='site'?guard.site_id:null;
   if(intent.assignment_id!==null){const assignment=(await client.query('SELECT site_id FROM mercury_guard.assignments WHERE assignment_id=$1 AND guard_id=$2 AND vendor_id=$3 AND active FOR SHARE',[intent.assignment_id,guard.guard_id,guard.vendor_id])).rows[0];if(!assignment||site!==null&&assignment.site_id!==site)throw new EscalationDeniedError('Approved original assignment required');site=assignment.site_id;await this.lockSite(client,site);}
   const scope={subject:session.subject,guard_id:guard.guard_id,vendor_id:guard.vendor_id,device_id:authority.deviceId,device_thumbprint:authority.thumbprint,revocation_version:authority.revocationVersion,site_id:site,assignment_id:intent.assignment_id};
   await client.query('SELECT pg_advisory_xact_lock($1::bigint)',[lock('mercury-escalation:'+intent.escalation_id)]);
   const old=(await client.query('SELECT * FROM mercury_guard.escalations WHERE escalation_id=$1',[intent.escalation_id])).rows[0];
   if(old){const stored=storedRow(old);if(old.intent_raw!==prepared.raw||old.intent_sha256!==prepared.hash||scopeKeys.some(k=>k==='revocation_version'?Number(old[k])!==scope[k]:old[k]!==scope[k]))throw new EscalationConflictError('Escalation ID already has different contents or authority');await this.requireSession(client,session);return stored.receipt;}
   const receipt=receiptFor(intent.escalation_id,prepared.hash,at);
   await client.query('INSERT INTO mercury_guard.escalations(escalation_id,subject,guard_id,vendor_id,device_id,device_thumbprint,revocation_version,site_id,assignment_id,intent_raw,intent_sha256,received_at_ms,receipt) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[intent.escalation_id,...scopeKeys.map(k=>scope[k]),prepared.raw,prepared.hash,at,receipt]);
   await this.requireSession(client,session);return receipt;
  });
 }
 async status(session,escalationId,proof){
  const raw=escalationStatusPayload(escalationId),p=prepareEscalationProof(proof,this.audience);
  return this.devices.transaction(async client=>{
   await this.requireSession(client,session);const authority=await this.authorizeProof({client,session,operation:'status',payloadHash:escalationDigest(raw),proof:p,now:this.now()}),guard=await this.lockGuard(client,session,authority);
   const row=(await client.query('SELECT * FROM mercury_guard.escalations WHERE escalation_id=$1 AND subject=$2 AND guard_id=$3 AND vendor_id=$4 AND device_id=$5 AND device_thumbprint=$6 AND revocation_version=$7',[escalationId,session.subject,guard.guard_id,guard.vendor_id,authority.deviceId,authority.thumbprint,authority.revocationVersion])).rows[0];
   if(!row)return null;if(guard.mode==='site'&&row.site_id!==guard.site_id)throw new EscalationDeniedError('Original escalation site required');if(row.site_id!==null)await this.lockSite(client,row.site_id);
   const record=storedRow(row),ack=acknowledgement((await client.query('SELECT * FROM mercury_guard.escalation_acknowledgements WHERE escalation_id=$1',[escalationId])).rows[0]);await this.requireSession(client,session);return snapshot(record,ack);
  });
 }
 async catalog(session,after=''){
  const position=parseEscalationCatalogCursor(after);
  return this.devices.transaction(async client=>{
   await this.requireOperator(client,session);
   const rows=(await client.query(`SELECT * FROM mercury_guard.escalations ${position?'WHERE (received_at_ms,escalation_id)<($1::bigint,$2::uuid) ':''}ORDER BY received_at_ms DESC,escalation_id DESC LIMIT 51`,position??[])).rows,visible=rows.slice(0,50),ids=visible.map(row=>row.escalation_id),acks=new Map();
   if(ids.length)for(const ack of (await client.query('SELECT * FROM mercury_guard.escalation_acknowledgements WHERE escalation_id=ANY($1::uuid[])',[ids])).rows)acks.set(ack.escalation_id,acknowledgement(ack));
   const items=visible.map(row=>{const record=storedRow(row);return {...snapshot(record,acks.get(row.escalation_id)??null),guard_id:row.guard_id,vendor_id:row.vendor_id,device_id:row.device_id,device_thumbprint:row.device_thumbprint,revocation_version:Number(row.revocation_version),site_id:row.site_id,assignment_id:row.assignment_id,intent:record.intent};});
   await this.requireOperator(client,session);return {kind:'escalations',items,next_cursor:rows.length>50?escalationCatalogCursor(Number(visible.at(-1).received_at_ms),visible.at(-1).escalation_id):null};
  });
 }
 async acknowledge(session,value,existingClient=null){
  const {request,input,digest}=adminRequest(value,session?.subject);
  return this.devices.transaction(async client=>{
   await this.requireOperator(client,session);
   await client.query('SELECT pg_advisory_xact_lock($1::bigint)',[lock('mercury-admin:'+request.request_id)]);
   const previous=(await client.query('SELECT actor_subject,request_digest,receipt FROM mercury_guard.admin_audit WHERE request_id=$1',[request.request_id])).rows[0];
   if(previous){if(previous.actor_subject!==session.subject||previous.request_digest!==digest)throw new AdminConflictError('Acknowledgement request ID content or actor changed');await this.requireOperator(client,session);return previous.receipt;}
   await client.query('SELECT pg_advisory_xact_lock($1::bigint)',[lock('mercury-escalation:'+request.escalation_id)]);
   const row=(await client.query('SELECT * FROM mercury_guard.escalations WHERE escalation_id=$1',[request.escalation_id])).rows[0];if(!row)throw new EscalationNotFoundError('Escalation unavailable');storedRow(row);
   let saved=(await client.query('SELECT * FROM mercury_guard.escalation_acknowledgements WHERE escalation_id=$1',[request.escalation_id])).rows[0];const already=!!saved,at=this.now();
   if(!saved){saved={escalation_id:request.escalation_id,actor_subject:session.subject,acknowledged_at_ms:at,note:request.reason};await client.query('INSERT INTO mercury_guard.escalation_acknowledgements(escalation_id,actor_subject,acknowledged_at_ms,note) VALUES($1,$2,$3,$4)',[saved.escalation_id,saved.actor_subject,at,saved.note]);}
   const receipt={request_id:request.request_id,action:'escalation.acknowledge',status:'applied',result:{escalation_id:request.escalation_id,acknowledgement:acknowledgement(saved),already_acknowledged:already},server_time_ms:at};
   await client.query('INSERT INTO mercury_guard.admin_audit(request_id,actor_subject,action,request_digest,input,receipt) VALUES($1,$2,$3,$4,$5,$6)',[request.request_id,session.subject,input.action,digest,input,receipt]);await this.requireOperator(client,session);return receipt;
  },existingClient);
 }
 async settle(session,value,existingClient=null){
  const {request,input,digest}=adminRequest(value,session?.subject);
  return this.devices.transaction(async client=>{
   await this.requireOperator(client,session);await client.query('SELECT pg_advisory_xact_lock($1::bigint)',[lock('mercury-admin:'+request.request_id)]);
   const previous=(await client.query('SELECT actor_subject,request_digest,receipt FROM mercury_guard.admin_audit WHERE request_id=$1',[request.request_id])).rows[0];
   if(previous){if(previous.actor_subject!==session.subject||previous.request_digest!==digest)throw new AdminConflictError('Acknowledgement request ID content or actor changed');await this.requireOperator(client,session);return previous.receipt;}
   // A target need not exist to close an unresolved request permanently. A
   // delayed acknowledge of this exact UUID must return this immutable closure.
   const receipt={request_id:request.request_id,action:input.action,status:'not_applied',result:{escalation_id:request.escalation_id},server_time_ms:this.now()};
   await client.query('INSERT INTO mercury_guard.admin_audit(request_id,actor_subject,action,request_digest,input,receipt) VALUES($1,$2,$3,$4,$5,$6)',[request.request_id,session.subject,input.action,digest,input,receipt]);await this.requireOperator(client,session);return receipt;
  },existingClient);
 }
}
