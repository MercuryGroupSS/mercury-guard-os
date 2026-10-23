import {DatabaseSync} from 'node:sqlite';
import {lstatSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';

// Local operator tool. Never creates a directory database or contacts a hosted service.
export function administerVendor({database,vendorId,action='inspect',reason,operator}){
 if(typeof database!=='string'||!isAbsolute(database)||!lstatSync(database).isFile())throw Error('Existing absolute database path required');
 if(typeof vendorId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(vendorId)||!['inspect','suspend','activate'].includes(action))throw Error('Invalid vendor operation');
 const changing=action!=='inspect';
 if(changing&&[reason,operator].some(x=>typeof x!=='string'||!x.trim()||x.length>500||/[\u0000-\u001f]/.test(x)))throw Error('Operator and reason required');
 const db=new DatabaseSync(database,{readOnly:!changing});
 try{
  db.exec('PRAGMA busy_timeout=5000');
  db.exec(changing?'BEGIN IMMEDIATE':'BEGIN');
  try{
   const vendor=db.prepare('SELECT vendor_id,kind,active FROM vendors WHERE vendor_id=?').get(vendorId);
   if(!vendor||!['company','individual'].includes(vendor.kind)||![0,1].includes(vendor.active))throw Error('Vendor unavailable');
   const counts=db.prepare('SELECT count(*) AS total,coalesce(sum(CASE WHEN active=1 THEN 1 ELSE 0 END),0) AS active FROM guards WHERE vendor_id=?').get(vendorId);
   const previous=vendor.active===1,next=changing?action==='activate':previous;
   let auditId=null;
   if(changing){
    db.exec(`CREATE TABLE IF NOT EXISTS vendor_access_audit(
     id TEXT PRIMARY KEY,vendor_id TEXT NOT NULL,at_ms INTEGER NOT NULL,
     operator_label TEXT NOT NULL,reason TEXT NOT NULL,previous_active INTEGER NOT NULL,
     requested_active INTEGER NOT NULL,linked_guards INTEGER NOT NULL)`);
    auditId=randomUUID();
    db.prepare('INSERT INTO vendor_access_audit VALUES(?,?,?,?,?,?,?,?)').run(auditId,vendorId,Date.now(),operator.trim(),reason.trim(),Number(previous),Number(next),counts.total);
    db.prepare('UPDATE vendors SET active=? WHERE vendor_id=?').run(Number(next),vendorId);
   }
   db.exec('COMMIT');
   return {vendorId,kind:vendor.kind,previousActive:previous,active:next,linkedGuards:counts.total,individuallyActiveGuards:counts.active,eligibleGuards:next?counts.active:0,changed:previous!==next,auditId,status:changing?'local_access_updated':'inspected'};
  }catch(e){db.exec('ROLLBACK');throw e;}
 }finally{db.close();}
}
