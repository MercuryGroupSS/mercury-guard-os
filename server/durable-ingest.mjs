import {photoMetadata} from './photo-metadata.mjs';
import {PHOTO_CHUNK_TTL_MS,photoChunkReceipt,validatePhotoChunk,assemblePhotoChunks,validateWholePhoto} from './photo-chunks.mjs';
import {patrolRoundKey} from './patrol-route.mjs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { verifyScopedBatch } from './verify-batch.mjs';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Local synthetic-data store. Plaintext SQLite: do not put real guard data here.
export class DurableIngest {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS events(device TEXT, id TEXT, sequence INTEGER, digest TEXT, body TEXT,
        PRIMARY KEY(device,id), UNIQUE(device,sequence));
      CREATE TABLE IF NOT EXISTS receipts(device TEXT, id TEXT, digest TEXT, body TEXT, PRIMARY KEY(device,id));
      CREATE TABLE IF NOT EXISTS checkpoints(guard TEXT,assignment TEXT,route TEXT,revision INTEGER,checkpoint TEXT,event_id TEXT,round TEXT NOT NULL DEFAULT '',PRIMARY KEY(guard,assignment,route,revision,round,checkpoint));
      CREATE TABLE IF NOT EXISTS check_in_alert_outbox(guard TEXT,assignment TEXT,revision INTEGER,slot INTEGER,body TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending')),PRIMARY KEY(guard,assignment,revision,slot));
      CREATE TABLE IF NOT EXISTS missed_check_ins(guard TEXT,assignment TEXT,revision INTEGER,slot INTEGER,deadline INTEGER,detected_at INTEGER,PRIMARY KEY(guard,assignment,revision,slot));
      CREATE TABLE IF NOT EXISTS check_ins(guard TEXT,assignment TEXT,revision INTEGER,slot INTEGER,event_id TEXT,PRIMARY KEY(guard,assignment,revision,slot));
      CREATE TABLE IF NOT EXISTS media(device TEXT,event_id TEXT,sha256 TEXT NOT NULL,bytes BLOB NOT NULL,PRIMARY KEY(device,event_id));`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS evidence_chunks(device TEXT,event_id TEXT,chunk_index INTEGER CHECK(chunk_index BETWEEN 0 AND 19),sha256 TEXT NOT NULL,bytes BLOB NOT NULL CHECK(length(bytes) BETWEEN 1 AND 1048576),received_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(device,event_id,chunk_index));CREATE INDEX IF NOT EXISTS evidence_chunks_expiry ON evidence_chunks(expires_at);`);
    this.db.exec('CREATE INDEX IF NOT EXISTS events_id ON events(id)');
    if(!this.db.prepare('PRAGMA table_info(checkpoints)').all().some(column=>column.name==='round')){
      try{this.db.exec(`BEGIN IMMEDIATE;
       ALTER TABLE checkpoints RENAME TO checkpoints_before_rounds;
       CREATE TABLE checkpoints(guard TEXT,assignment TEXT,route TEXT,revision INTEGER,checkpoint TEXT,event_id TEXT,round TEXT NOT NULL DEFAULT '',PRIMARY KEY(guard,assignment,route,revision,round,checkpoint));
       INSERT INTO checkpoints(guard,assignment,route,revision,checkpoint,event_id) SELECT guard,assignment,route,revision,checkpoint,event_id FROM checkpoints_before_rounds;
       DROP TABLE checkpoints_before_rounds;
       COMMIT;`);}catch(error){this.db.exec('ROLLBACK');throw error;}
    }
    for(const table of ['events','media'])if(!this.db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name==='received_at'))this.db.exec(`ALTER TABLE ${table} ADD COLUMN received_at INTEGER NOT NULL DEFAULT 0`);
  }
  ingest(raw, trustedContext, now) {
    // Revalidate even retries: a stored receipt cannot bypass revocation/expiry.
    const verified = verifyScopedBatch(raw,trustedContext,now);
    const batch=verified.batch;
    if(batch.events.some(event=>event.kind==='location'))throw Error('Location requires transactional current PostgreSQL consent');
    const payloadHash=trustedContext.vendorId?digest({hash:verified.payloadHash,vendorId:trustedContext.vendorId}):verified.payloadHash;
    const device = trustedContext.thumbprint;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old = this.db.prepare('SELECT digest,body FROM receipts WHERE device=? AND id=?').get(device,batch.batch_id);
      if (old) {
        if (old.digest !== payloadHash) throw new Error('Batch ID content conflict');
        this.db.exec('COMMIT'); return JSON.parse(old.body);
      }
      let last = this.db.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM events WHERE device=?').get(device).n;
      for (const event of batch.events) {
        const record={scope:batch.scope,event,...(trustedContext.vendorId?{vendor_id:trustedContext.vendorId}:{})};
        const body = JSON.stringify(record);
        const hash = digest(record);
        const prior = this.db.prepare('SELECT digest FROM events WHERE device=? AND id=?').get(device,event.event_id);
        if (prior) {
          if (prior.digest !== hash) throw new Error('Event ID content or scope conflict');
          continue;
        }
        if (event.sequence <= last && trustedContext.allowHistoricalSequence !== true) throw new Error('Device sequence rollback');
        if(event.kind==='check_in'&&trustedContext.allowHistoricalSequence===true){
          this.db.prepare('INSERT INTO check_ins VALUES(?,?,?,?,?)').run(trustedContext.guardId,trustedContext.assignmentId,event.data.policy_revision,event.data.slot,event.event_id);
        }
        if(event.kind==='patrol_checkpoint'&&trustedContext.allowHistoricalSequence===true){
          this.db.prepare('INSERT INTO checkpoints(guard,assignment,route,revision,checkpoint,event_id,round) VALUES(?,?,?,?,?,?,?)').run(trustedContext.guardId,trustedContext.assignmentId,event.data.route_id,event.data.route_revision,event.data.checkpoint_id,event.event_id,patrolRoundKey(event.data));
        }
        this.db.prepare('INSERT INTO events(device,id,sequence,digest,body,received_at) VALUES(?,?,?,?,?,?)').run(device,event.event_id,event.sequence,hash,body,trustedContext.receivedAtMs??now*1000);
        last = event.sequence;
      }
      const receipt = {batch_id:batch.batch_id,event_ids:batch.events.map(e=>e.event_id),status:'accepted_local_only'};
      this.db.prepare('INSERT INTO receipts VALUES(?,?,?,?)').run(device,batch.batch_id,payloadHash,JSON.stringify(receipt));
      this.db.exec('COMMIT'); return receipt;
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  photoForGuard(guardId,eventId){
    const rows=this.db.prepare("SELECT body FROM events WHERE id=? AND json_extract(body,'$.scope.guard_id')=?").all(eventId,guardId);
    if(rows.length!==1)return null;
    const record=JSON.parse(rows[0].body);return record.event.kind==='photo_evidence'?record:null;
  }
  retainPhoto(record,bytes,receivedAt=Date.now()){
    if(!Number.isSafeInteger(receivedAt)||receivedAt<=0)throw Error('Trusted receipt time required');
    const meta=photoMetadata(record.event.data);
    if(bytes.length!==meta.bytes||createHash('sha256').update(bytes).digest('hex')!==meta.sha256)throw Error('Evidence mismatch');
    const device=record.scope.device_thumbprint,eventId=record.event.event_id;
    const prior=this.db.prepare('SELECT sha256,length(bytes) AS size FROM media WHERE device=? AND event_id=?').get(device,eventId);
    if(prior){if(prior.sha256!==meta.sha256||prior.size!==bytes.length)throw Error('Evidence conflict');}
    else this.db.prepare('INSERT INTO media(device,event_id,sha256,bytes,received_at) VALUES(?,?,?,?,?)').run(device,eventId,meta.sha256,bytes,receivedAt);
    return {event_id:eventId,evidence_id:meta.evidence_id,sha256:meta.sha256,bytes:meta.bytes,status:'evidence_accepted_local_only'};
  }
  retainPhotoChunk(record,index,bytes,receivedAt=Date.now()){
    const meta=photoMetadata(record.event.data),sha=validatePhotoChunk(meta,index,bytes),device=record.scope.device_thumbprint,eventId=record.event.event_id;
    if(!Number.isSafeInteger(receivedAt)||receivedAt<=0)throw Error('Trusted receipt time required');
    this.db.exec('BEGIN IMMEDIATE');try{
      this.requirePhotoRecord(record);
      const accepted=this.db.prepare('SELECT sha256,bytes FROM media WHERE device=? AND event_id=?').get(device,eventId);
      if(accepted){const original=Buffer.from(accepted.bytes);validateWholePhoto(meta,original);if(accepted.sha256!==meta.sha256||!original.subarray(index*1048576,index*1048576+bytes.length).equals(bytes))throw Error('Immutable photo conflict');}
      else{
        this.db.prepare('DELETE FROM evidence_chunks WHERE device=? AND event_id=? AND expires_at<?').run(device,eventId,receivedAt);
        const prior=this.db.prepare('SELECT sha256,bytes FROM evidence_chunks WHERE device=? AND event_id=? AND chunk_index=?').get(device,eventId,index);
        if(prior){if(prior.sha256!==sha||!Buffer.from(prior.bytes).equals(bytes))throw Error('Immutable photo chunk conflict');}
        else this.db.prepare('INSERT INTO evidence_chunks VALUES(?,?,?,?,?,?,?)').run(device,eventId,index,sha,bytes,receivedAt,receivedAt+PHOTO_CHUNK_TTL_MS);
      }
      this.db.exec('COMMIT');return photoChunkReceipt(eventId,meta,index,bytes);
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  requirePhotoRecord(record){const row=this.db.prepare('SELECT body FROM events WHERE device=? AND id=?').get(record.scope.device_thumbprint,record.event.event_id);if(!row||JSON.stringify(JSON.parse(row.body))!==JSON.stringify(record)||record.event.kind!=='photo_evidence')throw Error('Original photo event unavailable');}
  finalizePhotoChunks(record,receivedAt=Date.now()){
    if(!Number.isSafeInteger(receivedAt)||receivedAt<=0)throw Error('Trusted receipt time required');
    const meta=photoMetadata(record.event.data),device=record.scope.device_thumbprint,eventId=record.event.event_id;
    this.db.exec('BEGIN IMMEDIATE');try{
      this.requirePhotoRecord(record);
      const prior=this.db.prepare('SELECT sha256,bytes FROM media WHERE device=? AND event_id=?').get(device,eventId);
      if(prior){if(prior.sha256!==meta.sha256)throw Error('Immutable photo conflict');validateWholePhoto(meta,Buffer.from(prior.bytes));}
      else{
        const rows=this.db.prepare('SELECT chunk_index,sha256,bytes,expires_at FROM evidence_chunks WHERE device=? AND event_id=? ORDER BY chunk_index').all(device,eventId).map(row=>({...row,bytes:Buffer.from(row.bytes)}));
        if(rows.some(row=>row.expires_at<receivedAt))throw Error('Incomplete photo fragments expired');
        const bytes=assemblePhotoChunks(meta,rows);this.db.prepare('INSERT INTO media(device,event_id,sha256,bytes,received_at) VALUES(?,?,?,?,?)').run(device,eventId,meta.sha256,bytes,receivedAt);
      }
      this.db.prepare('DELETE FROM evidence_chunks WHERE device=? AND event_id=?').run(device,eventId);this.db.exec('COMMIT');return {event_id:eventId,evidence_id:meta.evidence_id,sha256:meta.sha256,bytes:meta.bytes,status:'evidence_accepted_local_only'};
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  cleanupPhotoChunks(now=Date.now(),limit=40){if(!Number.isSafeInteger(now)||now<=0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('Bounded cleanup required');return this.db.prepare('DELETE FROM evidence_chunks WHERE rowid IN (SELECT rowid FROM evidence_chunks WHERE expires_at<? ORDER BY expires_at LIMIT ?)').run(now,limit).changes;}
  hasMissedCheckIn(guard,assignment,revision,slot){return !!this.db.prepare('SELECT 1 FROM missed_check_ins WHERE guard=? AND assignment=? AND revision=? AND slot=?').get(guard,assignment,revision,slot);}
  eventsAfter(cursor,limit){return this.db.prepare('SELECT rowid AS cursor,body FROM events WHERE rowid>? ORDER BY rowid LIMIT ?').all(cursor,limit);}
  alertsAfter(cursor,limit){return this.db.prepare('SELECT rowid AS cursor,body FROM check_in_alert_outbox WHERE rowid>? ORDER BY rowid LIMIT ?').all(cursor,limit);}
  count() { return this.db.prepare('SELECT COUNT(*) AS n FROM events').get().n; }
  close() { this.db.close(); }
}
