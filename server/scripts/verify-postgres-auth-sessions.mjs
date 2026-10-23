import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {createPostgresAuthSessionReader} from '../postgres-auth-session.mjs';
export async function verifyPostgresAuthSessions(connectionString,owner){
 const pool=new Pool({connectionString,max:2,options:'-c role=service_role'}),subject=randomUUID(),other=randomUUID(),session=randomUUID();
 try{await owner.query('INSERT INTO auth.users VALUES($1,$2),($3,$4)',[subject,'session-a@example.invalid',other,'session-b@example.invalid']);await owner.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)',[session,subject]);const reader=createPostgresAuthSessionReader(pool);
  assert.equal(await reader(subject,session),true);assert.equal(await reader(other,session),false);assert.equal(await reader(subject,randomUUID()),false);
  await owner.query("UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 second' WHERE id=$1",[session]);assert.equal(await reader(subject,session),false);
  await owner.query("UPDATE auth.sessions SET not_after=clock_timestamp()+interval '1 hour' WHERE id=$1",[session]);assert.equal(await reader(subject,session),true);
  await owner.query('DELETE FROM auth.sessions WHERE id=$1',[session]);assert.equal(await reader(subject,session),false);
  await assert.rejects(pool.query('SELECT test_secret FROM auth.sessions'),/permission denied/);await assert.rejects(pool.query('DELETE FROM auth.sessions'),/permission denied/);await assert.rejects(pool.query('UPDATE auth.sessions SET not_after=NULL'),/permission denied/);
  const grants=(await owner.query("SELECT has_column_privilege('anon','auth.sessions','id','SELECT') AS anon,has_column_privilege('authenticated','auth.sessions','id','SELECT') AS authenticated")).rows[0];assert.equal(grants.anon,false);assert.equal(grants.authenticated,false);
  console.log('PASS: private current Auth sessions, subject binding, expiry/deletion denial and column-only read privileges');
 }finally{await pool.end();}
}
