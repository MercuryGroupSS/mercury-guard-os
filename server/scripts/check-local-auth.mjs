// Local-only smoke check. Reads startup credentials without printing them.
import {createSupabaseSessionVerifier} from '../supabase-session.mjs';
import {readFileSync} from 'node:fs';
import {randomUUID,randomBytes} from 'node:crypto';
const lines=readFileSync(new URL('../../supabase-start.log',import.meta.url),'utf8').trim().split('\n');
const config=JSON.parse(lines.findLast(line=>line.startsWith('{')&&line.includes('API_URL')));
if(config.API_URL!=='http://127.0.0.1:55321') throw Error('Local environment required');
const base=config.API_URL+'/auth/v1';
const admin={apikey:config.SERVICE_ROLE_KEY,authorization:'Bearer '+config.SERVICE_ROLE_KEY,'content-type':'application/json'};
const email=`mercury-test-${randomUUID()}@example.invalid`,password=randomBytes(32).toString('hex');
let id;
async function call(path,options){const r=await fetch(base+path,options);if(!r.ok)throw Error(`Local auth check failed: ${r.status}`);return r.json();}
try {
 const user=await call('/admin/users',{method:'POST',headers:admin,body:JSON.stringify({email,password,email_confirm:true})});id=user.id;
 if(!id)throw Error('Missing synthetic user ID');
 const session=await call('/token?grant_type=password',{method:'POST',headers:{apikey:config.ANON_KEY,'content-type':'application/json'},body:JSON.stringify({email,password})});
 const verifySession=createSupabaseSessionVerifier({url:config.API_URL,publishableKey:config.PUBLISHABLE_KEY,allowLocal:true});
 const checked=await verifySession(session.access_token);
 if(checked?.subject!==id)throw Error('Session provider failed');
 if(await verifySession('invalid')!==null)throw Error('Malformed token accepted');
 const verified=await call('/user',{headers:{apikey:config.ANON_KEY,authorization:'Bearer '+session.access_token}});
 if(verified.id!==id)throw Error('Identity mismatch');
 const invalid=await fetch(base+'/user',{headers:{apikey:config.ANON_KEY,authorization:'Bearer invalid'}});
 if(![401,403].includes(invalid.status))throw Error('Unexpected invalid-token status: '+invalid.status);
 console.log('PASS: synthetic sign-in, server-verified identity, invalid-token rejection');
} finally {
 if(id){await call('/admin/users/'+id,{method:'DELETE',headers:admin});console.log('PASS: synthetic account removed');}
}
