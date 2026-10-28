import {fixtureAuthSession} from './fixture-auth-session.mjs';
import assert from 'node:assert/strict';
import {Client,Pool} from 'pg';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {PostgresDeviceAssignments} from '../postgres-device-assignments.mjs';
import {PostgresShiftLifecycle} from '../postgres-shift-lifecycle.mjs';
import {ShiftTransitionRejected} from '../shift-lifecycle.mjs';

// An actual upgrade starts with old indexes and existing unclosed attendance.
// The unique child database prevents scans/constraints from touching other tests.
export async function verifyPostgresShiftWindows(connectionString,owner){
 const url=new URL(connectionString);if(!['127.0.0.1','localhost'].includes(url.hostname)||!['55322','5432'].includes(url.port)||url.search||url.hash)throw Error('Disposable loopback PostgreSQL required');
 const name='mercury_shift_windows_'+randomUUID().replaceAll('-','');let created=false,fixture,pool;
 try{
  await owner.query('CREATE DATABASE '+name);created=true;url.pathname='/'+name;fixture=new Client({connectionString:url.toString(),connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:12000});await fixture.connect();
  await fixture.query('CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),not_after timestamptz);');
  const files=readdirSync(new URL('../../supabase/migrations/',import.meta.url)).filter(x=>/^\d+.*\.sql$/.test(x)).sort(),windowFiles=files.filter(x=>x.endsWith('_guard_shift_capture_windows.sql'));assert.equal(windowFiles.length,1);
  for(const file of files.filter(f=>!windowFiles.includes(f)))await fixture.query(readFileSync(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
  pool=new Pool({connectionString:url.toString(),max:6,options:'-c role=service_role',connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:12000});const devices=new PostgresDeviceAssignments(pool),shifts=new PostgresShiftLifecycle(devices),base=Date.now(),prefix='windows-'+randomUUID(),vendor=prefix+'-company',site=prefix+'-site';
  await fixture.query('INSERT INTO mercury_guard.vendors VALUES($1,$2,true)',[vendor,'company']);await fixture.query('INSERT INTO mercury_guard.sites VALUES($1,true)',[site]);
  const identities=[],phones=[];
  for(let i=0;i<3;i++){
   const subject=randomUUID(),guardId=prefix+'-guard-'+i;await fixture.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[subject,prefix+i+'@example.invalid']);await fixture.query('INSERT INTO mercury_guard.guards VALUES($1,$2,$3,true)',[guardId,subject,vendor]);identities.push({subject,guardId,vendorId:vendor,session:await fixtureAuthSession(fixture,subject)});
   const key=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({type:'spki',format:'der'}).toString('base64url'),deviceId=prefix+'-phone-'+i;await devices.enroll({deviceId,mode:'site',siteId:site,active:true,revoked:false,publicKeySpki:key});phones.push((await devices.device(deviceId)).thumbprint);
  }
  const make=async(id,person,phone,starts,ends)=>{const assignment={assignmentId:prefix+'-'+id,guardId:identities[person].guardId,vendorId:vendor,siteId:site,startsAt:starts,endsAt:ends,active:true};await devices.assign(assignment);return {identity:identities[person],session:identities[person].session,assignment,deviceThumbprint:phones[phone]};};
  const action=(action,requestId=randomUUID(),reason='')=>({action,request_id:requestId,confirmed:true,reason}),start=(scope,now,request=action('start'))=>shifts.transition({...scope,request,now}),scope=s=>({...s.identity,siteId:site,assignmentId:s.assignment.assignmentId,deviceThumbprint:s.deviceThumbprint});
  const original=await make('old',0,0,base,base+5000),originalRequest=action('start'),originalReceipt=await start(original,base+1000,originalRequest);
  const originalRow=(await fixture.query('SELECT row_to_json(h)::text AS raw FROM mercury_guard.shift_sessions h WHERE assignment=$1',[original.assignment.assignmentId])).rows[0].raw,originalRaw=(await fixture.query('SELECT receipt::text AS raw FROM mercury_guard.shift_transitions WHERE request=$1',[originalRequest.request_id])).rows[0].raw;
  assert.equal((await fixture.query("SELECT count(*) n FROM pg_indexes WHERE schemaname='mercury_guard' AND indexname IN ('one_active_guard','one_active_phone') AND indexdef LIKE 'CREATE UNIQUE%'")).rows[0].n,'2');
  await fixture.query(readFileSync(new URL('../../supabase/migrations/'+windowFiles[0],import.meta.url),'utf8'));
  assert.equal((await fixture.query('SELECT row_to_json(h)::text AS raw FROM mercury_guard.shift_sessions h WHERE assignment=$1',[original.assignment.assignmentId])).rows[0].raw,originalRow);
  const boundary=original.assignment.endsAt,next=await make('boundary',0,0,boundary,boundary+5000);const nextRequest=action('start');await start(next,boundary,nextRequest);
  assert.equal((await shifts.snapshot(scope(original))).state,'active');assert.equal((await shifts.snapshot(scope(original))).clocked_out_at_ms,null);
  assert.equal(await shifts.permitsCapture(scope(original),boundary-1),true);assert.equal(await shifts.permitsCapture(scope(original),boundary,{live:true}),false);assert.equal(await shifts.permitsCapture(scope(next),boundary,{live:true}),true);
  assert.deepEqual(await start(original,boundary+1,originalRequest),originalReceipt);assert.equal((await fixture.query('SELECT receipt::text AS raw FROM mercury_guard.shift_transitions WHERE request=$1',[originalRequest.request_id])).rows[0].raw,originalRaw);
  // Explicit late close-out remains valid inside the existing24h window and
  // affects only its original assignment, even with a newer confirmed shift.
  const explicit=await shifts.transition({...original,request:action('end'),now:boundary+1000});assert.equal(explicit.clocked_out_at_ms,boundary+1000);assert.equal(explicit.early_exit,false);assert.equal((await shifts.snapshot(scope(next))).clocked_out_at_ms,null);assert.equal(await shifts.permitsCapture(scope(next),boundary+1000,{live:true}),true);
  const nextRaw=(await fixture.query('SELECT row_to_json(h)::text AS raw FROM mercury_guard.shift_sessions h WHERE assignment=$1',[next.assignment.assignmentId])).rows[0].raw,nextStartRaw=(await fixture.query('SELECT receipt::text AS raw FROM mercury_guard.shift_transitions WHERE request=$1',[nextRequest.request_id])).rows[0].raw;
  const tomorrow=next.assignment.endsAt+86400001,dayGuard=await make('day-guard-new-phone',0,1,tomorrow,tomorrow+5000),dayPhone=await make('day-shared-phone-new-guard',1,0,tomorrow,tomorrow+5000);await start(dayGuard,tomorrow);await start(dayPhone,tomorrow);
  assert.equal((await fixture.query('SELECT row_to_json(h)::text AS raw FROM mercury_guard.shift_sessions h WHERE assignment=$1',[next.assignment.assignmentId])).rows[0].raw,nextRaw);assert.equal((await fixture.query('SELECT receipt::text AS raw FROM mercury_guard.shift_transitions WHERE request=$1',[nextRequest.request_id])).rows[0].raw,nextStartRaw);
  await assert.rejects(shifts.transition({...next,request:action('end'),now:tomorrow}),e=>e instanceof ShiftTransitionRejected&&e.receipt.code==='shift_cannot_end');
  const liveGuard=await make('live-guard-conflict',0,2,tomorrow,tomorrow+5000),livePhone=await make('live-phone-conflict',2,1,tomorrow,tomorrow+5000);
  for(const s of [liveGuard,livePhone])await assert.rejects(start(s,tomorrow),e=>e instanceof ShiftTransitionRejected&&e.receipt.code==='active_shift_conflict');
  const racingAt=tomorrow+5000,raceGuard=await Promise.all([make('race-guard-a',0,0,racingAt,racingAt+5000),make('race-guard-b',0,2,racingAt,racingAt+5000)]),racePhone=await Promise.all([make('race-phone-a',1,1,racingAt,racingAt+5000),make('race-phone-b',2,1,racingAt,racingAt+5000)]);
  for(const candidates of [raceGuard,racePhone]){const results=await Promise.allSettled(candidates.map(s=>start(s,racingAt)));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason instanceof ShiftTransitionRejected&&r.reason.receipt.code==='active_shift_conflict').length,1);}
  assert.equal((await fixture.query('SELECT receipt::text AS raw FROM mercury_guard.shift_transitions WHERE request=$1',[originalRequest.request_id])).rows[0].raw,originalRaw);
  assert.equal((await fixture.query("SELECT count(*) n FROM pg_indexes WHERE schemaname='mercury_guard' AND indexname IN ('one_active_guard','one_active_phone')")).rows[0].n,'0');
  await assert.rejects(pool.query('DELETE FROM mercury_guard.shift_sessions'),/permission denied/);await assert.rejects(pool.query('UPDATE mercury_guard.shift_sessions SET ends_at=ends_at+1'),/permission denied/);
  console.log('PASS: actual shift-index upgrade, expired unconfirmed history/receipts retained, exact end boundary and next-day guard/phone reuse, live/concurrent conflicts, explicit late close and capture cutoff');
 }finally{await pool?.end();await fixture?.end();if(created){await owner.query('DROP DATABASE '+name);console.log('PASS: isolated shift-window verification database removed');}}
}
