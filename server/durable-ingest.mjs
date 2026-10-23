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
      CREATE TABLE IF NOT EXISTS checkpoints(guard TEXT,assignment TEXT,route TEXT,revision INTEGER,checkpoint TEXT,event_id TEXT,PRIMARY KEY(guard,assignment,route,revision,checkpoint));`);
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
        if(event.kind==='patrol_checkpoint'&&trustedContext.allowHistoricalSequence===true){
          this.db.prepare('INSERT INTO checkpoints VALUES(?,?,?,?,?,?)').run(trustedContext.guardId,trustedContext.assignmentId,event.data.route_id,event.data.route_revision,event.data.checkpoint_id,event.event_id);
        }
        this.db.prepare('INSERT INTO events VALUES(?,?,?,?,?)').run(device,event.event_id,event.sequence,hash,body);
        last = event.sequence;
      }
      const receipt = {batch_id:batch.batch_id,event_ids:batch.events.map(e=>e.event_id),status:'accepted_local_only'};
      this.db.prepare('INSERT INTO receipts VALUES(?,?,?,?)').run(device,batch.batch_id,payloadHash,JSON.stringify(receipt));
      this.db.exec('COMMIT'); return receipt;
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  count() { return this.db.prepare('SELECT COUNT(*) AS n FROM events').get().n; }
  close() { this.db.close(); }
}
