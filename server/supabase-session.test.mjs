import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseSessionVerifier} from './supabase-session.mjs';
const token=c=>'header.'+Buffer.from(JSON.stringify(c)).toString('base64url')+'.signature';
function verifier(status=200,user={id:'subject'}){return createSupabaseSessionVerifier({url:'https://example.supabase.co',publishableKey:'synthetic',now:()=>100,fetchImpl:async()=>new Response(JSON.stringify(user),{status})});}
test('remote verification precedes trust and excludes editable metadata',async()=>{
 const result=await verifier()(token({sub:'subject',exp:200,user_metadata:{guardId:'attacker'}}));
 assert.deepEqual(result,{subject:'subject',active:true,expiresAt:200});
 assert.equal(await verifier(401)(token({sub:'subject',exp:200})),null);
});
test('subject mismatch, expiry and malformed token rejected',async()=>{
 for(const c of [{sub:'other',exp:200},{sub:'subject',exp:100},{sub:'subject',exp:'200'}])assert.equal(await verifier()(token(c)),null);
 assert.equal(await verifier()('invalid'),null);
});
test('insecure remote origins and implicit localhost are rejected',()=>{
 for(const url of ['http://example.com','http://127.0.0.1:55321','https://user:pass@example.com','https://example.com/path'])assert.throws(()=>createSupabaseSessionVerifier({url,publishableKey:'x'}));
});
