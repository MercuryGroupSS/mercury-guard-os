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
test('strict session checks follow remote verification and bind the exact subject and session ID',async()=>{
 const subject='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',session='11111111-2222-3333-4444-555555555555';let calls=0,active=true;
 const verify=createSupabaseSessionVerifier({url:'https://example.supabase.co',publishableKey:'synthetic',now:()=>100,fetchImpl:async()=>Response.json({id:subject}),loadSession:async(s,id)=>{calls++;assert.equal(s,subject);assert.equal(id,session);return active;}});
 assert.deepEqual(await verify(token({sub:subject,exp:200,session_id:session,user_metadata:{sessionId:'attacker'}})),{subject,active:true,expiresAt:200,sessionId:session});active=false;assert.equal(await verify(token({sub:subject,exp:200,session_id:session})),null);assert.equal(calls,2);
 for(const claims of [{sub:subject,exp:200},{sub:subject,exp:200,session_id:'invalid'},{sub:'other',exp:200,session_id:session}])assert.equal(await verify(token(claims)),null);assert.equal(calls,2);
});
test('remote failure cannot reach the session store, and session-store failure cannot authorize a token',async()=>{
 let calls=0;const options={url:'https://example.supabase.co',publishableKey:'synthetic',now:()=>100,loadSession:async()=>{calls++;throw Error('Unavailable');}},claims={sub:'subject',exp:200,session_id:'11111111-2222-3333-4444-555555555555'};
 assert.equal(await createSupabaseSessionVerifier({...options,fetchImpl:async()=>new Response(null,{status:401})})(token(claims)),null);assert.equal(calls,0);
 await assert.rejects(createSupabaseSessionVerifier({...options,fetchImpl:async()=>Response.json({id:'subject'})})(token(claims)),/Unavailable/);assert.equal(calls,1);
});
