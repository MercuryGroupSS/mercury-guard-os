import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseAuthority} from './supabase-authority.mjs';
const subject='00000000-0000-4000-8000-000000000001';
function loader(rows,status=200){return createSupabaseAuthority({url:'https://example.supabase.co',serviceKey:'synthetic',fetchImpl:async url=>{assert.equal(url.searchParams.get('subject'),'eq.'+subject);return new Response(JSON.stringify(rows),{status});}});}
test('authority cannot come from absent, ambiguous or failed server lookup',async()=>{
 assert.equal(await loader([])(subject),null);assert.equal(await loader([{},{}])(subject),null);
 await assert.rejects(()=>loader([],500)(subject));assert.equal(await loader([])('invalid'),null);
});
test('authority maps only server columns and drops extras',async()=>{
 const row={subject,active:true,guard_id:'guard',site_id:'site',assignment_id:'assignment',user_metadata:{guardId:'attacker'}};
 const a=await loader([row])(subject);assert.equal(a.guardId,'guard');assert.equal(a.subject,subject);assert.equal(a.user_metadata,undefined);
});
