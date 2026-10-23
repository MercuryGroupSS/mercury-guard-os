import {DatabaseSync} from 'node:sqlite';
// Local synthetic pilot only. Contains no passwords or biometric material.
export class LocalGuardDirectory {
 constructor(path) {
  this.db=new DatabaseSync(path);
  this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
   CREATE TABLE IF NOT EXISTS vendors(vendor_id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('company','individual')),active INTEGER NOT NULL CHECK(active IN (0,1)));
   CREATE TABLE IF NOT EXISTS guards(guard_id TEXT PRIMARY KEY,auth_subject TEXT NOT NULL UNIQUE,vendor_id TEXT NOT NULL REFERENCES vendors(vendor_id),active INTEGER NOT NULL CHECK(active IN (0,1)));
   CREATE TABLE IF NOT EXISTS guard_login(guard_id TEXT PRIMARY KEY REFERENCES guards(guard_id),email TEXT NOT NULL UNIQUE);
   CREATE TABLE IF NOT EXISTS login_attempts(bucket TEXT PRIMARY KEY,started INTEGER NOT NULL,count INTEGER NOT NULL);`);
 }
 // Administrative provisioning only, never exposed by an HTTP write endpoint.
 addVendor({vendorId,kind,active=false}) {
  if(typeof vendorId!=='string'||!vendorId.trim()||typeof active!=='boolean')throw Error('Invalid vendor');
  this.db.prepare('INSERT INTO vendors VALUES(?,?,?)').run(vendorId,kind,Number(active));
 }
 addGuard({guardId,authSubject,vendorId,active=false}) {
  if([guardId,authSubject,vendorId].some(v=>typeof v!=='string'||!v.trim())||typeof active!=='boolean')throw Error('Invalid guard');
  this.db.prepare('INSERT INTO guards VALUES(?,?,?,?)').run(guardId,authSubject,vendorId,Number(active));
 }
 setGuardActive(guardId,active) {
  if(typeof active!=='boolean')throw Error('Boolean required');
  if(this.db.prepare('UPDATE guards SET active=? WHERE guard_id=?').run(Number(active),guardId).changes!==1)throw Error('Guard not found');
 }
 loadGuardsForSubject(subject) {
  return this.db.prepare('SELECT * FROM guards WHERE auth_subject=?').all(subject).map(r=>({guardId:r.guard_id,authSubject:r.auth_subject,vendorId:r.vendor_id,active:r.active===1}));
 }
 loadVendor(id) {
  const r=this.db.prepare('SELECT * FROM vendors WHERE vendor_id=?').get(id);
  return r?{vendorId:r.vendor_id,kind:r.kind,active:r.active===1}:null;
 }
 setLoginEmail(guardId,email){
  if(typeof email!=='string'||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Valid account email required');
  this.db.prepare('INSERT INTO guard_login VALUES(?,?) ON CONFLICT(guard_id) DO UPDATE SET email=excluded.email').run(guardId,email.toLowerCase());
 }
 loginAccount(guardId){
  const row=this.db.prepare('SELECT g.auth_subject,l.email FROM guard_login l JOIN guards g USING(guard_id) JOIN vendors v USING(vendor_id) WHERE guard_id=? AND g.active=1 AND v.active=1').get(guardId);
  return row?{subject:row.auth_subject,email:row.email}:null;
 }
 consumeLoginAttempt(bucket,now){
  if(typeof bucket!=='string'||!Number.isSafeInteger(now))throw Error('Invalid throttle');
  this.db.exec('BEGIN IMMEDIATE');
  try{
   this.db.prepare('DELETE FROM login_attempts WHERE started<=?').run(now-300000);
   const consume=(key,limit,window)=>{
    let row=this.db.prepare('SELECT * FROM login_attempts WHERE bucket=?').get(key);
    if(!row||row.started+window<=now){this.db.prepare('INSERT INTO login_attempts VALUES(?,?,0) ON CONFLICT(bucket) DO UPDATE SET started=excluded.started,count=0').run(key,now);row={count:0};}
    if(row.count>=limit)return false;
    this.db.prepare('UPDATE login_attempts SET count=count+1 WHERE bucket=?').run(key);return true;
   };
   // Check global capacity before allocating an account bucket to bound storage growth.
   const allowed=consume('global',100,60000)&&consume('account:'+bucket,5,300000);
   this.db.exec('COMMIT');return allowed;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 close(){this.db.close();}
}
