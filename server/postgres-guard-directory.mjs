import {createPostgresLoginLimiter} from './postgres-login-limiter.mjs';
// Server-side read adapter. Client owns connection lifecycle and transport security.
// Database-backed shared throttling is the default; no implicit unlimited login.
export class PostgresGuardDirectory{
 constructor({client,consumeLoginAttempt=createPostgresLoginLimiter(client)}){
  if(typeof client?.query!=='function'||typeof consumeLoginAttempt!=='function')throw Error('Database client and login limiter required');
  this.client=client;this.consumeAttempt=consumeLoginAttempt;
 }
 async loadGuardsForSubject(subject){
  const {rows}=await this.client.query('SELECT guard_id,auth_subject,vendor_id,active FROM mercury_guard.guards WHERE auth_subject=$1::uuid',[subject]);
  return rows.map(r=>({guardId:r.guard_id,authSubject:r.auth_subject,vendorId:r.vendor_id,active:r.active}));
 }
 async loadVendor(vendorId){
  const {rows}=await this.client.query('SELECT vendor_id,kind,active FROM mercury_guard.vendors WHERE vendor_id=$1',[vendorId]);
  return rows.length===1?{vendorId:rows[0].vendor_id,kind:rows[0].kind,active:rows[0].active}:null;
 }
 async loginAccount(guardId){
  const {rows}=await this.client.query('SELECT g.auth_subject,l.email FROM mercury_guard.guard_login l JOIN mercury_guard.guards g USING(guard_id) JOIN mercury_guard.vendors v USING(vendor_id) WHERE g.guard_id=$1 AND g.active AND v.active',[guardId]);
  return rows.length===1?{subject:rows[0].auth_subject,email:rows[0].email}:null;
 }
 async consumeLoginAttempt(bucket,now){return (await this.consumeAttempt(bucket,now))===true;}
}
