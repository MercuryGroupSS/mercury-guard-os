import {test} from 'node:test';import assert from 'node:assert/strict';
import {createPostgresAuthSessionReader} from './postgres-auth-session.mjs';
test('private session lookup uses only a parameterized subject, session ID and live expiry',async()=>{
 const subject='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',session='11111111-2222-3333-4444-555555555555';let calls=0,active=true;
 const reader=createPostgresAuthSessionReader({query:async(sql,values)=>{calls++;assert.deepEqual(values,[session,subject]);assert.match(sql,/not_after>clock_timestamp\(\)/);assert.doesNotMatch(sql,/SELECT \*|refresh_token/);return {rows:[{active}]};}});
 assert.equal(await reader(subject,session),true);active=false;assert.equal(await reader(subject,session),false);assert.equal(await reader(subject,'invalid'),false);assert.equal(await reader('not-a-subject',session),false);assert.equal(calls,2);
});
