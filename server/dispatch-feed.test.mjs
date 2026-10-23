import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DispatchFeed,DispatchCursorError} from './dispatch-feed.mjs';
const scope={guardId:'g',vendorId:'v',siteId:'s',assignmentId:'a',deviceThumbprint:'a'.repeat(64),revocationVersion:1};
const message=(id='message',version=1)=>({message_id:id,version,state:'active',title:'Synthetic dispatch',body:'Test only',issued_at:1000,due_at:null});
test('feed is scoped to guard and device; cursors cannot cross assignment or enrollment',()=>{
 const feed=new DispatchFeed(':memory:');try{
  feed.publish(scope,message());feed.publish({...scope,guardId:'other'},message('private'));
  const page=feed.read(scope,null,2000);assert.deepEqual(page.changes.map(m=>m.message_id),['message']);
  for(const patch of [{guardId:'other'},{assignmentId:'other'},{deviceThumbprint:'b'.repeat(64)},{revocationVersion:2}])assert.throws(()=>feed.read({...scope,...patch},page.next_cursor,2001),DispatchCursorError);
  assert.equal(feed.read(scope,page.next_cursor,2001).changes.length,0);
 }finally{feed.close();}
});
test('immutable versions, retractions and replay never resurrect superseded text',()=>{
 const feed=new DispatchFeed(':memory:');try{
  const one=message();feed.publish(scope,one);feed.publish(scope,one);
  assert.throws(()=>feed.publish(scope,{...one,body:'different'}));assert.throws(()=>feed.publish(scope,message('message',3)));
  const cursor=feed.read(scope,null,2000).next_cursor;
  feed.publish(scope,{...message('message',2),state:'retracted',title:'',body:''});
  assert.equal(feed.read(scope,cursor,2001).changes[0].state,'retracted');
  const fresh=feed.read(scope,null,2001);assert.equal(fresh.changes.length,1);assert.equal(fresh.changes[0].body,'');
 }finally{feed.close();}
});
test('bounded pages and cursor state survive restart; expired cursors require explicit resync',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dispatch-')),path=join(dir,'feed.db');let feed=new DispatchFeed(path);
 try{
  for(let i=0;i<30;i++)feed.publish(scope,message('m'+i));
  const page=feed.read(scope,null,2000);assert.equal(page.changes.length,25);assert.equal(page.has_more,true);
  feed.close();feed=new DispatchFeed(path);const second=feed.read(scope,page.next_cursor,2001);assert.equal(second.changes.length,5);assert.equal(second.has_more,false);
  assert.throws(()=>feed.read(scope,second.next_cursor,2001+86400000),DispatchCursorError);
  assert.equal(feed.read(scope,null,2001+86400000).changes.length,25);
 }finally{feed.close();rmSync(dir,{recursive:true,force:true});}
});

test('UTF-8 and escaped content stay within the Android response budget across pages',()=>{
 const feed=new DispatchFeed(':memory:');try{
  for(let i=0;i<10;i++)feed.publish(scope,{...message('large'+i),body:'\u0001'.repeat(7999)+'x'});
  let cursor=null,seen=0,more=true;
  while(more){const page=feed.read(scope,cursor,2000);assert.ok(Buffer.byteLength(JSON.stringify(page))<262144);assert.ok(page.changes.length>0);seen+=page.changes.length;cursor=page.next_cursor;more=page.has_more;}
  assert.equal(seen,10);
 }finally{feed.close();}
});
