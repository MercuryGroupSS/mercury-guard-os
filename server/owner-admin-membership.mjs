import {createHash} from 'node:crypto';
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
export function membershipRequest(value){
 const fields=['requestId','subject','email','active','operator','reason'];
 if(!value||Object.keys(value).length!==fields.length||fields.some(k=>!Object.hasOwn(value,k))||!uuid(value.requestId)||!uuid(value.subject)||typeof value.active!=='boolean'||typeof value.email!=='string'||value.email!==value.email.toLowerCase()||value.email.length>254||!/^\S+@\S+\.\S+$/.test(value.email)||typeof value.operator!=='string'||!value.operator.trim()||value.operator.length>100||typeof value.reason!=='string'||!value.reason.trim()||value.reason.length>500||/[\u0000-\u001f]/.test(value.operator+value.reason))throw Error('Explicit owner membership request required');
 return {requestId:value.requestId.toLowerCase(),subject:value.subject.toLowerCase(),email:value.email,active:value.active,operator:value.operator.trim(),reason:value.reason.trim()};
}
// This module is deliberately absent from the HTTP service. A local owner pool
// is required; the ordinary service role cannot change membership or its audit.
export class OwnerAdminMembership{
 constructor({pool,loadAuthAccount,now=Date.now}){if(typeof pool?.connect!=='function'||typeof loadAuthAccount!=='function')throw Error('Owner pool and trusted Auth reader required');this.pool=pool;this.loadAuthAccount=loadAuthAccount;this.now=now;}
 async set(value){
  const request=membershipRequest(value),input={subject:request.subject,email:request.email,active:request.active,operator:request.operator,reason:request.reason},digest=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const preflight=await this.pool.connect();let prior;
  try{if((await preflight.query('SELECT current_user AS role')).rows[0]?.role!=='postgres')throw Error('Local database owner required');prior=(await preflight.query('SELECT request_id FROM mercury_guard.admin_membership_audit WHERE request_id=$1',[request.requestId])).rowCount>0;}finally{preflight.release();}
  let account;
  if(request.active&&!prior){account=await this.loadAuthAccount(request.subject);if(!account||account.subject!==request.subject||account.email!==request.email||!account.confirmed||!account.enabled)throw Error('Confirmed active individual Auth account required');}
  const client=await this.pool.connect();
  try{await client.query('BEGIN');if((await client.query('SELECT current_user AS role')).rows[0]?.role!=='postgres')throw Error('Local database owner required');
   await client.query("SELECT pg_advisory_xact_lock(hashtextextended('mercury-owner-membership',0))");
   const old=(await client.query('SELECT request_digest,receipt FROM mercury_guard.admin_membership_audit WHERE request_id=$1',[request.requestId])).rows[0];
   if(old){if(old.request_digest!==digest)throw Error('Owner request ID conflict');await client.query('COMMIT');return old.receipt;}
   const before=(await client.query('SELECT email,active FROM mercury_guard.admin_accounts WHERE auth_subject=$1 FOR UPDATE',[request.subject])).rows[0]??null;
   if(request.active){
    const current=(await client.query('SELECT email,email_confirmed_at,banned_until,deleted_at FROM auth.users WHERE id=$1 FOR SHARE',[request.subject])).rows[0];
    if(!account||!current||current.email?.toLowerCase()!==request.email||!current.email_confirmed_at||current.deleted_at||current.banned_until&&new Date(current.banned_until).getTime()>this.now())throw Error('Account changed before membership commit');
    await client.query('INSERT INTO mercury_guard.admin_accounts(auth_subject,email,active) VALUES($1,$2,true) ON CONFLICT(auth_subject) DO UPDATE SET email=excluded.email,active=true',[request.subject,request.email]);
   }else{if(!before||before.email!==request.email)throw Error('Existing membership email required for revocation');await client.query('UPDATE mercury_guard.admin_accounts SET active=false WHERE auth_subject=$1',[request.subject]);}
   const receipt={request_id:request.requestId,subject:request.subject,email:request.email,active:request.active,status:'applied',previous:before,active_administrators:(await client.query('SELECT count(*)::int n FROM mercury_guard.admin_accounts WHERE active')).rows[0].n,server_time_ms:this.now()};
   await client.query('INSERT INTO mercury_guard.admin_membership_audit(request_id,auth_subject,email,active,operator_label,reason,request_digest,receipt) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[request.requestId,request.subject,request.email,request.active,request.operator,request.reason,digest,receipt]);await client.query('COMMIT');return receipt;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
}
