import {photoMetadata} from './photo-metadata.mjs';
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
      CREATE TABLE IF NOT EXISTS checkpoints(guard TEXT,assignment TEXT,route TEXT,revision INTEGER,checkpoint TEXT,event_id TEXT,PRIMARY KEY(guard,assignment,route,revision,checkpoint));
      CREATE TABLE IF NOT EXISTS missed_check_ins(guard TEXT,assignment TEXT,revision INTEGER,slot INTEGER,deadline INTEGER,detected_at INTEGER,PRIMARY KEY(guard,assignment,revision,slot));
      CREATE TABLE IF NOT EXISTS check_ins(guard TEXT,assignment TEXT,revision INTEGER,slot INTEGER,event_id TEXT,PRIMARY KEY(guard,assignment,revision,slot));
      CREATE TABLE IF NOT EXISTS media(device TEXT,event_id TEXT,sha256 TEXT NOT NULL,bytes BLOB NOT NULL,PRIMARY KEY(device,event_id));`);
    this.db.exec('CREATE INDEX IF NOT EXISTS events_id ON events(id)');
    for(const table of ['events','media'])if(!this.db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name==='received_at'))this.db.exec(`ALTER TABLE ${table} ADD COLUMN received_at INTEGER NOT NULL DEFAULT 0`);
  }
  ingest(raw, trustedContext, now) {
    // Revalidate even retries: a stored receipt cannot bypass revocation/expiry.
    const verified = verifyScopedBatch(raw,trustedContext,now);
    const batch=verified.batch;
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
          this.db.prepare('INSERT INTO checkpoints VALUES(?,?,?,?,?,?)').run(trustedContext.guardId,trustedContext.assignmentId,event.data.route_id,event.data.route_revision,event.data.checkpoint_id,event.event_id);
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
  count() { return this.db.prepare('SELECT COUNT(*) AS n FROM events').get().n; }
  close() { this.db.close(); }
}
