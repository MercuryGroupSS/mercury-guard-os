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
  for(const now of [999,5000])assert.throws(()=>ledger.transition({...context,request:request('start'),now}));
  ledger.transition({...context,request:request('start'),now:1000});
  for(const req of [request('end'),request('end','end','  '),{...request('end','end','Test reason'),confirmed:false}])assert.throws(()=>ledger.transition({...context,request:req,now:2000}));
  assert.equal(ledger.db.prepare('SELECT clocked_out FROM shift_sessions').get().clocked_out,null);
  const end=ledger.transition({...context,request:request('end','end','Synthetic early exit'),now:2000});assert.equal(end.early_exit,true);assert.equal(end.reason,'Synthetic early exit');
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
