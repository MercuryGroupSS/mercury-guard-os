import {DatabaseSync} from 'node:sqlite';
// Local synthetic pilot only. Contains no passwords or biometric material.
export class LocalGuardDirectory {
 constructor(path) {
  this.db=new DatabaseSync(path);
  this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
   CREATE TABLE IF NOT EXISTS vendors(vendor_id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('company','individual')),active INTEGER NOT NULL CHECK(active IN (0,1)));
   CREATE TABLE IF NOT EXISTS guards(guard_id TEXT PRIMARY KEY,auth_subject TEXT NOT NULL UNIQUE,vendor_id TEXT NOT NULL REFERENCES vendors(vendor_id),active INTEGER NOT NULL CHECK(active IN (0,1)));`);
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
 close(){this.db.close();}
}
