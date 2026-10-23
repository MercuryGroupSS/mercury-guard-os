import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {PostgresDeviceAssignments} from '../postgres-device-assignments.mjs';
import {PostgresDispatchFeed} from '../postgres-dispatch-feed.mjs';
import {DispatchCursorError} from '../dispatch-feed.mjs';
export async function verifyPostgresDispatch(connectionString,admin){
 const pool=new Pool({connectionString,max:4,options:'-c role=service_role'});
 try{
  const devices=new PostgresDeviceAssignments(pool),first=new PostgresDispatchFeed(devices),second=new PostgresDispatchFeed(devices),now=Date.now();
  const a={assignmentId:'dispatch-test',guardId:'device-other',vendorId:'device-vendor',siteId:'device-site',active:true,startsAt:now-1000,endsAt:now+172800000};await devices.assign(a);await devices.assign({...a,assignmentId:'dispatch-other',guardId:'device-guard'});
  const scope={guardId:a.guardId,vendorId:a.vendorId,siteId:a.siteId,assignmentId:a.assignmentId,deviceThumbprint:(await devices.device('check-in-phone')).thumbprint,revocationVersion:1};
  const message=(id='m',version=1)=>({message_id:id,version,state:'active',title:'Synthetic dispatch',body:'Synthetic instruction',issued_at:now,due_at:null});
  await Promise.all([first.publish(scope,message()),second.publish(scope,message())]);
  assert.equal((await admin.query('SELECT count(*)::int n FROM mercury_guard.dispatch_changes')).rows[0].n,1);
  const page=await first.read(scope,null,now+1);assert.equal(page.changes.length,1);assert.equal((await second.read(scope,page.next_cursor,now+2)).changes.length,0);
  await assert.rejects(second.publish(scope,{...message(),body:'conflict'}));await assert.rejects(second.publish(scope,message('m',3)));
  await first.publish(scope,{...message('m',2),body:'Updated instruction'});await second.publish(scope,{...message('m',3),state:'retracted',title:'',body:''});
  assert.equal((await first.read(scope,page.next_cursor,now+3)).changes[0].state,'retracted');
  const ack={kind:'dispatch_ack',at:now,data:{capture_grant_id:'synthetic',message_id:'m',message_version:1}};
  assert.equal((await second.validateAcknowledgement(scope,ack)).message_version,1);
  await assert.rejects(second.validateAcknowledgement(scope,{...ack,at:now-1}));await assert.rejects(second.validateAcknowledgement(scope,{...ack,data:{...ack.data,message_version:3}}));
  const otherScope={...scope,assignmentId:'dispatch-other',guardId:'device-guard'};await first.publish(otherScope,message('foreign'));
  await assert.rejects(second.read(otherScope,page.next_cursor,now+4),DispatchCursorError);
  await assert.rejects(second.read({...scope,deviceThumbprint:(await devices.device('events-phone')).thumbprint},page.next_cursor,now+4),DispatchCursorError);
  for(let i=0;i<30;i++)await first.publish(scope,message('batch-'+i));
  for(let i=0;i<10;i++)await second.publish(scope,{...message('large-'+i),body:'\u0001'.repeat(7999)+'x'});
  let cursor=null,more=true,seen=0;
  while(more){const p=await new PostgresDispatchFeed(devices).read(scope,cursor,now+10);assert.ok(Buffer.byteLength(JSON.stringify(p))<262144);assert.ok(p.changes.length>0);seen+=p.changes.length;cursor=p.next_cursor;more=p.has_more;}
  assert.equal(seen,41);await assert.rejects(second.read(scope,cursor,now+86400011),DispatchCursorError);
  await assert.rejects(pool.query("UPDATE mercury_guard.dispatch_changes SET body='changed'"),/permission denied/);await assert.rejects(pool.query('DELETE FROM mercury_guard.dispatch_changes'),/permission denied/);
  await devices.cancel(a.assignmentId);await assert.rejects(second.read(scope,null,now+20));
  await devices.revoke('check-in-phone');await assert.rejects(second.read(otherScope,null,now+20));
  console.log('PASS: shared dispatch versions, cursor scoping/expiry, bounded pages, historical acknowledgements and revocation');
 }finally{await pool.end();}
}
