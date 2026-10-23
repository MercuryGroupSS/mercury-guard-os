import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {DurableIngest} from './durable-ingest.mjs';
import {reconcileCheckIns} from './check-in-status.mjs';
const assignment={guardId:'g',assignmentId:'a',startsAt:1000,endsAt:130000,checkInPolicy:{revision:1,interval_ms:60000,window_ms:10000,max_evidence_age_ms:5000,max_accuracy_m:100}};
function record(store,received,mediaAt,slot=0){
 const record={scope:{guard_id:'g',assignment_id:'a',device_thumbprint:'key'},event:{data:{photo_event_id:`photo-${slot}`}}};
 store.db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?)').run('key',`event-${slot}`,slot+1,'synthetic',JSON.stringify(record),received);
 store.db.prepare('INSERT INTO check_ins VALUES(?,?,?,?,?)').run('g','a',1,slot,`event-${slot}`);
 if(mediaAt!==null)store.db.prepare('INSERT INTO media VALUES(?,?,?,?,?)').run('key',`photo-${slot}`,'synthetic',Buffer.from('test'),mediaAt);
}
test('check-in is evidence-received only after separate photo receipt; missing delivery persists',()=>{
 const dir=mkdtempSync(join(tmpdir(),'check-status-')),path=join(dir,'events.db');let store=new DurableIngest(path);
 try{
  assert.equal(reconcileCheckIns(store,assignment,999).total_due,0);
  assert.equal(reconcileCheckIns(store,assignment,1000).slots[0].status,'due');
  record(store,5000,null);
  assert.equal(reconcileCheckIns(store,assignment,6000).slots[0].status,'photo_delivery_pending');
  const missed=reconcileCheckIns(store,assignment,11000);assert.equal(missed.total_deadlines_missed,1);assert.equal(missed.slots[0].missing_detected_at,11000);
  store.db.prepare('INSERT INTO media VALUES(?,?,?,?,?)').run('key','photo-0','synthetic',Buffer.from('test'),12000);
  store.close();store=new DurableIngest(path);
  const late=reconcileCheckIns(store,assignment,13000).slots[0];assert.equal(late.status,'evidence_received_after_deadline');assert.equal(late.delivery_deadline_missed,true);assert.equal(late.missing_detected_at,11000);
  const other=reconcileCheckIns(store,{...assignment,guardId:'other'},13000);assert.equal(other.slots[0].status,'delivery_missing');
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('on-time receipt avoids a miss, but late first reconciliation still records the missed deadline',()=>{
 const store=new DurableIngest(':memory:');try{
  record(store,5000,6000);assert.equal(reconcileCheckIns(store,assignment,12000).slots[0].status,'evidence_received');assert.equal(reconcileCheckIns(store,assignment,12000).total_deadlines_missed,0);
  record(store,72000,73000,1);const late=reconcileCheckIns(store,assignment,80000);assert.equal(late.slots[1].status,'evidence_received_after_deadline');assert.equal(late.total_deadlines_missed,1);
  assert.equal(reconcileCheckIns(store,assignment,130000).slots[2].deadline_at,130000);
 }finally{store.close();}
});
test('legacy receipt timestamps stay unknown after schema migration',()=>{
 const dir=mkdtempSync(join(tmpdir(),'check-migrate-')),path=join(dir,'events.db');
 const old=new DatabaseSync(path);old.exec('CREATE TABLE events(device TEXT,id TEXT,sequence INTEGER,digest TEXT,body TEXT,PRIMARY KEY(device,id),UNIQUE(device,sequence)); CREATE TABLE media(device TEXT,event_id TEXT,sha256 TEXT,bytes BLOB,PRIMARY KEY(device,event_id));');old.close();
 const store=new DurableIngest(path);try{
  record(store,0,0);const status=reconcileCheckIns(store,assignment,12000);assert.equal(status.slots[0].status,'photo_delivery_pending');assert.equal(status.total_deadlines_missed,1);
  assert.equal(store.db.prepare('PRAGMA table_info(events)').all().filter(c=>c.name==='received_at').length,1);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
