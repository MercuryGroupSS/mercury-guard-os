import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ShiftLifecycle} from './shift-lifecycle.mjs';
const context={identity:{subject:'user',guardId:'guard',vendorId:'company'},assignment:{assignmentId:'shift',guardId:'guard',vendorId:'company',siteId:'site',startsAt:1000,endsAt:5000,active:true},deviceThumbprint:'a'.repeat(64)};
const request=(action,id=action,reason='')=>({action,request_id:id,reason,confirmed:true});
test('scheduled end is an explicit transition, with durable exact replay',()=>{
 const dir=mkdtempSync(join(tmpdir(),'shift-state-')),path=join(dir,'state.db');let ledger=new ShiftLifecycle(path);
 try{
  const start=ledger.transition({...context,request:request('start'),now:1000});
  ledger.close();ledger=new ShiftLifecycle(path);
  assert.deepEqual(ledger.transition({...context,request:request('start'),now:2000}),start);
  assert.equal(ledger.db.prepare('SELECT clocked_out FROM shift_sessions').get().clocked_out,null);
  const end=ledger.transition({...context,request:request('end'),now:5000});assert.equal(end.early_exit,false);assert.equal(end.clocked_out_at_ms,5000);
  assert.deepEqual(ledger.transition({...context,request:request('end'),now:6000}),end);
  assert.throws(()=>ledger.transition({...context,request:request('end','end','changed'),now:6000}));
  assert.throws(()=>ledger.transition({...context,request:request('start','restart'),now:2000}));
 }finally{ledger.close();rmSync(dir,{recursive:true,force:true});}
});
test('early exit needs confirmation and reason; denial leaves active shift intact',()=>{
 const ledger=new ShiftLifecycle(':memory:');try{
  for(const now of [999,5000])assert.throws(()=>ledger.transition({...context,request:request('start','invalid-'+now),now}));
  ledger.transition({...context,request:request('start'),now:1000});
  for(const req of [request('end'),request('end','end','  '),{...request('end','end','Test reason'),confirmed:false}])assert.throws(()=>ledger.transition({...context,request:req,now:2000}));
  assert.equal(ledger.db.prepare('SELECT clocked_out FROM shift_sessions').get().clocked_out,null);
  const end=ledger.transition({...context,request:request('end','valid-end','Synthetic early exit'),now:2000});assert.equal(end.early_exit,true);assert.equal(end.reason,'Synthetic early exit');
 }finally{ledger.close();}
});
test('shared vendor grants no shared identity or simultaneous phone shift',()=>{
 const ledger=new ShiftLifecycle(':memory:');try{
  ledger.transition({...context,request:request('start'),now:1000});
  const other={...context,identity:{subject:'other',guardId:'other',vendorId:'company'},assignment:{...context.assignment,guardId:'other',assignmentId:'other'}};
  assert.throws(()=>ledger.transition({...other,request:request('start','other-start'),now:2000}));
  assert.throws(()=>ledger.transition({...context,assignment:{...context.assignment,assignmentId:'second'},deviceThumbprint:'b'.repeat(64),request:request('start','second-start'),now:2000}));
  for(const patch of [{deviceThumbprint:'b'.repeat(64)},{assignment:{...context.assignment,active:false}},{identity:{...context.identity,guardId:'other'}}])assert.throws(()=>ledger.transition({...context,...patch,request:request('end'),now:5000}));
  assert.equal(ledger.db.prepare('SELECT count(*) AS n FROM shift_sessions').get().n,1);
 }finally{ledger.close();}
});

test('capture authority closes at confirmed end but retains historical observations',()=>{
 const ledger=new ShiftLifecycle(':memory:');const scope={guardId:'guard',vendorId:'company',siteId:'site',assignmentId:'shift',deviceThumbprint:context.deviceThumbprint};
 try{
  assert.equal(ledger.permitsCapture(scope,2000),false);
  ledger.transition({...context,request:request('start'),now:1500});
  assert.equal(ledger.permitsCapture(scope,1499),false);assert.equal(ledger.permitsCapture(scope,1500,{live:true}),true);assert.equal(ledger.permitsCapture(scope,5000),false);
  for(const key of Object.keys(scope))assert.equal(ledger.permitsCapture({...scope,[key]:'other'},2000),false);
  ledger.transition({...context,request:request('end','end','Synthetic reason'),now:3000});
  assert.equal(ledger.permitsCapture(scope,2999),true);assert.equal(ledger.permitsCapture(scope,3000),false);assert.equal(ledger.permitsCapture(scope,2999,{live:true}),false);
 }finally{ledger.close();}
});


test('definitive rejection survives restart and cannot later execute the same intent',()=>{
 const dir=mkdtempSync(join(tmpdir(),'shift-rejection-')),path=join(dir,'state.db');let ledger=new ShiftLifecycle(path);
 try{
  let receipt;try{ledger.transition({...context,request:request('start'),now:999});assert.fail('Early start accepted');}catch(e){assert.equal(e.receipt?.code,'shift_cannot_start');receipt=e.receipt;}
  ledger.close();ledger=new ShiftLifecycle(path);
  try{ledger.transition({...context,request:request('start'),now:2000});assert.fail('Rejected intent executed');}catch(e){assert.deepEqual(e.receipt,receipt);}
  assert.equal(ledger.db.prepare('SELECT count(*) AS n FROM shift_sessions').get().n,0);
  assert.throws(()=>ledger.transition({...context,request:{...request('start'),reason:'changed'},now:2000}));
  const fresh=ledger.transition({...context,request:request('start','new-confirmation'),now:2000});assert.equal(fresh.clocked_in_at_ms,2000);
  assert.equal(ledger.dashboardAfter(0,10).length,1);
 }finally{ledger.close();rmSync(dir,{recursive:true,force:true});}
});
test('expired unconfirmed attendance releases only the scheduled window and preserves original receipts',()=>{
 const ledger=new ShiftLifecycle(':memory:'),oldScope={guardId:'guard',vendorId:'company',siteId:'site',assignmentId:'shift',deviceThumbprint:context.deviceThumbprint};
 try{
  const start=ledger.transition({...context,request:request('start'),now:1000}),raw=ledger.db.prepare("SELECT receipt FROM shift_transitions WHERE request='start'").get().receipt;
  const next={...context,assignment:{...context.assignment,assignmentId:'next-window',startsAt:5000,endsAt:9000}};
  ledger.transition({...next,request:request('start','next-start'),now:5000});
  assert.equal(ledger.db.prepare("SELECT clocked_out FROM shift_sessions WHERE assignment='shift'").get().clocked_out,null);
  assert.equal(ledger.snapshot(oldScope).state,'active');assert.equal(ledger.permitsCapture(oldScope,4999),true);assert.equal(ledger.permitsCapture(oldScope,5000,{live:true}),false);
  assert.equal(ledger.db.prepare("SELECT receipt FROM shift_transitions WHERE request='start'").get().receipt,raw);assert.deepEqual(ledger.transition({...context,request:request('start'),now:6000}),start);
  const lateEnd=ledger.transition({...context,request:request('end','old-explicit-end'),now:6000});assert.equal(lateEnd.clocked_out_at_ms,6000);assert.equal(lateEnd.early_exit,false);
  assert.equal(ledger.db.prepare("SELECT clocked_out FROM shift_sessions WHERE assignment='next-window'").get().clocked_out,null);
  assert.equal(ledger.permitsCapture({...oldScope,assignmentId:'next-window'},6000,{live:true}),true);
 }finally{ledger.close();}
});
test('next-day guard and shared-phone use survive legacy index upgrade without auto-closing history',()=>{
 const dir=mkdtempSync(join(tmpdir(),'shift-window-upgrade-')),path=join(dir,'state.db');let ledger=new ShiftLifecycle(path);
 try{
  ledger.transition({...context,request:request('start'),now:1000});
  // Reproduce the pre-upgrade reservation indexes over actual existing history.
  ledger.db.exec('CREATE UNIQUE INDEX one_active_guard ON shift_sessions(guard) WHERE clocked_out IS NULL;CREATE UNIQUE INDEX one_active_phone ON shift_sessions(device) WHERE clocked_out IS NULL;');
  const original=ledger.db.prepare("SELECT * FROM shift_sessions WHERE assignment='shift'").get(),raw=ledger.db.prepare("SELECT receipt FROM shift_transitions WHERE request='start'").get().receipt;
  ledger.close();ledger=new ShiftLifecycle(path);const now=5000+86400001;
  const a={...context,assignment:{...context.assignment,assignmentId:'next-day-a',startsAt:now,endsAt:now+5000},deviceThumbprint:'b'.repeat(64)};
  ledger.transition({...a,request:request('start','next-day-a-start'),now});
  const b={...context,identity:{subject:'other',guardId:'other',vendorId:'company'},assignment:{...a.assignment,assignmentId:'next-day-b',guardId:'other'}};
  ledger.transition({...b,request:request('start','next-day-b-start'),now});
  assert.deepEqual(ledger.db.prepare("SELECT * FROM shift_sessions WHERE assignment='shift'").get(),original);assert.equal(ledger.db.prepare("SELECT receipt FROM shift_transitions WHERE request='start'").get().receipt,raw);
  assert.throws(()=>ledger.transition({...context,request:request('end','too-late-end'),now}),e=>e.receipt?.code==='shift_cannot_end');
  assert.throws(()=>ledger.transition({...a,assignment:{...a.assignment,assignmentId:'live-guard-conflict'},deviceThumbprint:'c'.repeat(64),request:request('start','live-guard-conflict'),now}),e=>e.receipt?.code==='active_shift_conflict');
  assert.throws(()=>ledger.transition({...b,assignment:{...b.assignment,assignmentId:'live-phone-conflict',guardId:'third'},identity:{subject:'third',guardId:'third',vendorId:'company'},request:request('start','live-phone-conflict'),now}),e=>e.receipt?.code==='active_shift_conflict');
  assert.equal(ledger.db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='index' AND name IN ('one_active_guard','one_active_phone')").get().n,0);
  assert.equal(ledger.db.prepare('SELECT count(*) n FROM shift_sessions WHERE clocked_out IS NULL').get().n,3);
 }finally{ledger.close();rmSync(dir,{recursive:true,force:true});}
});
