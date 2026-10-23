import {ShiftGrantSigner} from './shift-grant-signer.mjs';
import {DatabaseSync} from 'node:sqlite';
// Server-side issuer. Private key stays outside APKs and API responses.
export class ShiftGrantIssuer extends ShiftGrantSigner {
 constructor({path,privateKey,keyId,issuer,audience}){
  super({privateKey,keyId,issuer,audience});
  this.db=new DatabaseSync(path);
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
   CREATE TABLE IF NOT EXISTS issued_grants(id TEXT PRIMARY KEY,subject TEXT NOT NULL,vendor_id TEXT NOT NULL,payload TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS grant_policies(id TEXT PRIMARY KEY,body TEXT NOT NULL);`);
 }
 issue({identity,assignment,device,sessionExpiresAt,allowedActions,now=Date.now()}){
  const {claims,policy,payload,response}=this.prepare({identity,assignment,device,sessionExpiresAt,allowedActions,now});
  this.db.exec('BEGIN IMMEDIATE');
  try{
   this.db.prepare('INSERT INTO issued_grants(id,subject,vendor_id,payload) VALUES(?,?,?,?)').run(claims.grant_id,identity.subject,identity.vendorId,payload);
   this.db.prepare('INSERT INTO grant_policies VALUES(?,?)').run(claims.grant_id,JSON.stringify(policy));
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e;}
  return response;
 }
 lookup(grantId){
  if(typeof grantId!=='string'||grantId.length>100)return null;
  const row=this.db.prepare('SELECT * FROM issued_grants WHERE id=?').get(grantId);
  if(!row||row.revoked)return null;
  const policy=this.db.prepare('SELECT body FROM grant_policies WHERE id=?').get(grantId);
  return {policy:policy?JSON.parse(policy.body):{},subject:row.subject,vendorId:row.vendor_id,claims:JSON.parse(Buffer.from(row.payload,'base64url').toString('utf8'))};
 }
 revoke(grantId){if(this.db.prepare('UPDATE issued_grants SET revoked=1 WHERE id=?').run(grantId).changes!==1)throw Error('Unknown grant');}
 close(){this.db.close();}
}
