import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {PostgresDeviceAssignments} from '../postgres-device-assignments.mjs';
import {PostgresDispatchFeed} from '../postgres-dispatch-feed.mjs';
import {DispatchCursorError} from '../dispatch-feed.mjs';
import {randomUUID} from 'node:crypto';
export async function verifyPostgresDispatch(connectionString,admin){
 const pool=new Pool({connectionString,max:4,options:'-c role=service_role'});
 try{
  const devices=new PostgresDeviceAssignments(pool),first=new PostgresDispatchFeed(devices),second=new PostgresDispatchFeed(devices),now=Date.now();
  const principals=(await admin.query("SELECT guard_id,auth_subject FROM mercury_guard.guards WHERE guard_id IN ('device-other','device-guard')")).rows,subjects=new Map(principals.map(row=>[row.guard_id,row.auth_subject])),sessions=new Map();
  for(const row of principals){const session={subject:row.auth_subject,sessionId:randomUUID(),active:true,expiresAt:Math.floor(now/1000)+259200};sessions.set(row.guard_id,session);await admin.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)',[session.sessionId,session.subject]);await admin.query('INSERT INTO mercury_guard.guard_login(guard_id,email) VALUES($1,$2)',[row.guard_id,row.guard_id+'-dispatch@example.invalid']);}
  const a={assignmentId:'dispatch-test',guardId:'device-other',vendorId:'device-vendor',siteId:'device-site',active:true,startsAt:now-1000,endsAt:now+172800000};await devices.assign(a);await devices.assign({...a,assignmentId:'dispatch-other',guardId:'device-guard'});
  const scope={subject:subjects.get(a.guardId),session:sessions.get(a.guardId),guardId:a.guardId,vendorId:a.vendorId,siteId:a.siteId,assignmentId:a.assignmentId,deviceThumbprint:(await devices.device('check-in-phone')).thumbprint,revocationVersion:1};
  const message=(id='m',version=1)=>({message_id:id,version,state:'active',title:'Synthetic dispatch',body:'Synthetic instruction',issued_at:now,due_at:null});
  await Promise.all([first.publish(scope,message()),second.publish(scope,message())]);
  assert.equal((await admin.query('SELECT count(*)::int n FROM mercury_guard.dispatch_changes')).rows[0].n,1);
  // An assigned device may read instructions before clock-in. Only challenge
  // and cursor bookkeeping may change; no shift, event or capture grant exists.
  const futureGuard='dispatch-prestart-'+randomUUID(),futureSubject=randomUUID(),futureSession={...scope.session,subject:futureSubject,sessionId:randomUUID()};await admin.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[futureSubject,futureGuard+'@example.invalid']);await admin.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)',[futureSession.sessionId,futureSubject]);await admin.query('INSERT INTO mercury_guard.guards(guard_id,auth_subject,vendor_id,active) VALUES($1,$2,$3,true)',[futureGuard,futureSubject,a.vendorId]);await admin.query('INSERT INTO mercury_guard.guard_login VALUES($1,$2)',[futureGuard,futureGuard+'-dispatch@example.invalid']);
  const future={...a,assignmentId:'dispatch-future',guardId:futureGuard,startsAt:now+3600000},futureScope={...scope,subject:futureSubject,session:futureSession,guardId:futureGuard,assignmentId:future.assignmentId};await devices.assign(future);await first.publish(futureScope,message('before-start'));
  const protectedCounts=async()=> (await admin.query('SELECT (SELECT count(*)::int FROM mercury_guard.shift_sessions) AS shifts,(SELECT count(*)::int FROM mercury_guard.shift_transitions) AS transitions,(SELECT count(*)::int FROM mercury_guard.capture_grants) AS grants,(SELECT count(*)::int FROM mercury_guard.ingested_events) AS events')).rows[0],unchanged=await protectedCounts();
  const prestart=await first.read(futureScope,null,now);assert.equal(prestart.changes[0].message_id,'before-start');assert.deepEqual(await protectedCounts(),unchanged);
  await assert.rejects(first.read({...futureScope,session:undefined},null,now));await assert.rejects(first.read({...futureScope,subject:subjects.get('device-guard')},null,now));await assert.rejects(first.read({...futureScope,session:{...futureScope.session,sessionId:sessions.get('device-guard').sessionId}},null,now));await assert.rejects(first.read({...futureScope,session:{...futureScope.session,expiresAt:Math.floor(now/1000)}},null,now));
  // Deletion after page/cursor work is observed by the final same-client Auth
  // check. Both a newly inserted cursor and expired-cursor cleanup roll back.
  await first.publish(futureScope,{...message('before-start',2),body:'New synthetic prestart revision'});
  await admin.query('INSERT INTO mercury_guard.dispatch_cursors(token,scope,sequence,expires) VALUES($1,$2,0,$3)',[randomUUID(),'e'.repeat(64),now-1]);
  const cursorRows=async()=>(await admin.query('SELECT token,scope,sequence,expires FROM mercury_guard.dispatch_cursors ORDER BY token')).rows,beforeRace=await cursorRows(),requireSession=first.requireSession.bind(first);let checks=0;
  first.requireSession=async(client,context,at)=>{if(++checks===2)await admin.query('DELETE FROM auth.sessions WHERE id=$1',[futureScope.session.sessionId]);return requireSession(client,context,at);};
  try{await assert.rejects(first.read(futureScope,null,now+2));}finally{first.requireSession=requireSession;await admin.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)',[futureScope.session.sessionId,futureScope.subject]);}
  assert.equal(checks,2);assert.deepEqual(await cursorRows(),beforeRace);assert.deepEqual(await protectedCounts(),unchanged);assert.equal((await first.read(futureScope,null,now+3)).changes[0].version,2);
  const loginEmail=futureScope.guardId+'-dispatch@example.invalid';await admin.query('DELETE FROM mercury_guard.guard_login WHERE guard_id=$1',[futureScope.guardId]);await assert.rejects(first.read(futureScope,null,now+4));await admin.query('INSERT INTO mercury_guard.guard_login VALUES($1,$2)',[futureScope.guardId,loginEmail]);
  const rebound=randomUUID(),reboundSession={...futureScope.session,subject:rebound,sessionId:randomUUID()};await admin.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[rebound,'dispatch-rebound@example.invalid']);await admin.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)',[reboundSession.sessionId,rebound]);await admin.query('UPDATE mercury_guard.guards SET auth_subject=$1 WHERE guard_id=$2',[rebound,futureScope.guardId]);await admin.query('UPDATE mercury_guard.guard_login SET email=$1 WHERE guard_id=$2',['dispatch-rebound@example.invalid',futureScope.guardId]);
  await assert.rejects(first.read(futureScope,null,now+5));const reboundScope={...futureScope,subject:rebound,session:reboundSession};await assert.rejects(first.read(reboundScope,prestart.next_cursor,now+5),DispatchCursorError);assert.equal((await first.read(reboundScope,null,now+5)).changes[0].version,2);
  await admin.query('UPDATE mercury_guard.guards SET auth_subject=$1 WHERE guard_id=$2',[futureScope.subject,futureScope.guardId]);await admin.query('UPDATE mercury_guard.guard_login SET email=$1 WHERE guard_id=$2',[loginEmail,futureScope.guardId]);
  const page=await first.read(scope,null,now+1);assert.equal(page.changes.length,1);assert.equal((await second.read(scope,page.next_cursor,now+2)).changes.length,0);
  await assert.rejects(second.publish(scope,{...message(),body:'conflict'}));await assert.rejects(second.publish(scope,message('m',3)));
  await first.publish(scope,{...message('m',2),body:'Updated instruction'});await second.publish(scope,{...message('m',3),state:'retracted',title:'',body:''});
  assert.equal((await first.read(scope,page.next_cursor,now+3)).changes[0].state,'retracted');
  const ack={kind:'dispatch_ack',at:now,data:{capture_grant_id:'synthetic',message_id:'m',message_version:1}};
  assert.equal((await second.validateAcknowledgement(scope,ack)).message_version,1);
  await assert.rejects(second.validateAcknowledgement(scope,{...ack,at:now-1}));await assert.rejects(second.validateAcknowledgement(scope,{...ack,data:{...ack.data,message_version:3}}));
  const otherScope={...scope,assignmentId:'dispatch-other',guardId:'device-guard',subject:subjects.get('device-guard'),session:sessions.get('device-guard')};await first.publish(otherScope,message('foreign'));
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
  console.log('PASS: shared dispatch prestart instructions without attendance/grant/event writes, same-transaction exact Auth session and current guard-login binding, post-cursor session-deletion rollback, principal-bound cursors, versions/expiry/bounded pages, historical acknowledgements and revocation');
 }finally{await pool.end();}
}
