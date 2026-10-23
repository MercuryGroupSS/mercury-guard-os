import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {scopeKey,prepareDispatchVersion,stable} from './dispatch-input.mjs';
export class DispatchCursorError extends Error {}
export class DispatchFeed {
 constructor(path){this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS dispatch_changes(sequence INTEGER PRIMARY KEY AUTOINCREMENT,scope TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,UNIQUE(scope,id,version));
 CREATE INDEX IF NOT EXISTS dispatch_latest ON dispatch_changes(scope,id,sequence);
 CREATE TABLE IF NOT EXISTS dispatch_cursors(token TEXT PRIMARY KEY,scope TEXT NOT NULL,sequence INTEGER NOT NULL,expires INTEGER NOT NULL,UNIQUE(scope,sequence));`);}
 publish(scope,value){
  const {key,body}=prepareDispatchVersion(scope,value);
  this.db.exec('BEGIN IMMEDIATE');try{
   const old=this.db.prepare('SELECT body FROM dispatch_changes WHERE scope=? AND id=? AND version=?').get(key,value.message_id,value.version);
   if(old){if(old.body!==body)throw Error('Message version content conflict');this.db.exec('COMMIT');return;}
   const last=this.db.prepare('SELECT max(version) AS version FROM dispatch_changes WHERE scope=? AND id=?').get(key,value.message_id).version??0;
   if(value.version!==last+1)throw Error('Message versions must advance one step');
   this.db.prepare('INSERT INTO dispatch_changes(scope,id,version,body) VALUES(?,?,?,?)').run(key,value.message_id,value.version,body);
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 read(scope,cursor,now=Date.now()){
  const key=scopeKey(scope);
  if(!Number.isSafeInteger(now)||now<=0||!/^[a-f0-9]{64}$/.test(scope.deviceThumbprint)||!Number.isSafeInteger(scope.revocationVersion)||scope.revocationVersion<0)throw Error('Verified device scope required');
  const owner=createHash('sha256').update(JSON.stringify([key,scope.deviceThumbprint,scope.revocationVersion])).digest('hex');
  this.db.exec('BEGIN IMMEDIATE');try{
   this.db.prepare('DELETE FROM dispatch_cursors WHERE expires<=?').run(now);
   let after=0;
   if(cursor!==null){
    if(typeof cursor!=='string'||cursor.length>100)throw new DispatchCursorError('Cursor unavailable');
    const saved=this.db.prepare('SELECT sequence FROM dispatch_cursors WHERE token=? AND scope=?').get(cursor,owner);
    if(!saved)throw new DispatchCursorError('Cursor unavailable');after=saved.sequence;
   }
   const max=this.db.prepare('SELECT coalesce(max(sequence),0) AS n FROM dispatch_changes').get().n;
   if(after<0||after>max)throw new DispatchCursorError('Cursor unavailable');
   const rows=this.db.prepare('SELECT c.sequence,c.body FROM dispatch_changes c WHERE c.scope=? AND c.sequence>? AND NOT EXISTS (SELECT 1 FROM dispatch_changes n WHERE n.scope=c.scope AND n.id=c.id AND n.sequence>c.sequence) ORDER BY c.sequence LIMIT 26').all(key,after);
   const selected=[];let bytes=0;
   for(const row of rows){const size=Buffer.byteLength(row.body);if(selected.length===25||bytes+size>220000)break;selected.push(row);bytes+=size;}
   const more=selected.length<rows.length,next=more?selected.at(-1).sequence:max;
   let token=this.db.prepare('SELECT token FROM dispatch_cursors WHERE scope=? AND sequence=?').get(owner,next)?.token;
   if(!token){token=randomUUID();this.db.prepare('INSERT INTO dispatch_cursors VALUES(?,?,?,?)').run(token,owner,next,now+86400000);}
   else this.db.prepare('UPDATE dispatch_cursors SET expires=? WHERE token=?').run(now+86400000,token);
   this.db.exec('COMMIT');
   return {scope:{guard_id:scope.guardId,vendor_id:scope.vendorId,site_id:scope.siteId,assignment_id:scope.assignmentId,device_thumbprint:scope.deviceThumbprint,revocation_version:scope.revocationVersion},changes:selected.map(r=>JSON.parse(r.body)),next_cursor:token,has_more:more,server_time_ms:now};
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 // A delayed acknowledgement retains its exact historical version. It never
 // acknowledges a newer version or a retraction and does not prove comprehension.
 validateAcknowledgement(scope,event){
  const d=event?.data;
  if(event?.kind!=='dispatch_ack'||!Number.isSafeInteger(event.at)||event.at<=0||!d||Object.keys(d).sort().join()!=='capture_grant_id,message_id,message_version'||!stable(d.message_id)||!Number.isSafeInteger(d.message_version)||d.message_version<1)throw Error('Invalid acknowledgement');
  const row=this.db.prepare('SELECT body FROM dispatch_changes WHERE scope=? AND id=? AND version=?').get(scopeKey(scope),d.message_id,d.message_version);
  if(!row)throw Error('Message version unavailable');
  const message=JSON.parse(row.body);
  if(message.state!=='active'||message.issued_at>event.at)throw Error('Message not acknowledgeable');
  return {message_id:message.message_id,message_version:message.version};
 }
 close(){this.db.close();}
}
