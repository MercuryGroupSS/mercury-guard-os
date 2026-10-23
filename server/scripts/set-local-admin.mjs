import {Pool} from 'pg';import {readFileSync} from 'node:fs';
import {OwnerAdminMembership,membershipRequest} from '../owner-admin-membership.mjs';
import {createAdminAuthAccountReader} from '../admin-auth-account.mjs';
const args=process.argv.slice(2),options={};
if(args.includes('--help')){console.log('Owner-only local administrator setup. No passwords are accepted.\nUsage: node server/scripts/set-local-admin.mjs --email EMAIL --active true|false --operator LABEL --reason REASON --request-id UUID [--subject UUID] [--apply]\nWithout --apply, verifies the exact account and prints a review plan. Reuse the same request ID to recover an uncertain result.');process.exit(0);}
for(let i=0;i<args.length;i++){const key=args[i];if(key==='--apply'){if(options.apply)throw Error('Duplicate apply flag');options.apply=true;continue;}if(!['--email','--active','--operator','--reason','--request-id','--subject'].includes(key)||Object.hasOwn(options,key)||!args[i+1]||args[i+1].startsWith('--'))throw Error('Use --help for explicit owner options');options[key]=args[++i];}
if(!['true','false'].includes(options['--active']))throw Error('Explicit true or false status required');
const root=new URL('../../',import.meta.url),config=JSON.parse(readFileSync(new URL('supabase-start.log',root),'utf8').split('\n').findLast(l=>l.startsWith('{')&&l.includes('API_URL'))),url=new URL(config.DB_URL);
if(config.API_URL!=='http://127.0.0.1:55321'||!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.port!=='55322'||url.search||url.hash)throw Error('Isolated local owner environment required');
const pool=new Pool({connectionString:config.DB_URL,max:2,connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:10000});pool.on('error',()=>{});
try{
 if((await pool.query('SELECT current_user AS role')).rows[0]?.role!=='postgres')throw Error('Local owner role required');
 const email=String(options['--email']??'').trim().toLowerCase();let subject=options['--subject'];
 if(!subject){const matches=(await pool.query('SELECT id FROM auth.users WHERE lower(email)=$1 AND deleted_at IS NULL LIMIT 2',[email])).rows;if(matches.length!==1)throw Error('Exactly one existing individual Auth account is required; provide --subject if email is ambiguous');subject=matches[0].id;}
 const request=membershipRequest({requestId:options['--request-id'],subject,email,active:options['--active']==='true',operator:options['--operator'],reason:options['--reason']});
 const loadAuthAccount=createAdminAuthAccountReader({url:config.API_URL,serverKey:config.SERVICE_ROLE_KEY,allowLocal:true});
 if(!options.apply){const account=await loadAuthAccount(request.subject);if(request.active&&(!account||account.email!==request.email||!account.confirmed||!account.enabled))throw Error('Confirmed active account required before applying');console.log(JSON.stringify({mode:'review',...request,notice:'No membership changed. Add --apply with the identical request to execute.'}));}
 else{const owner=new OwnerAdminMembership({pool,loadAuthAccount});console.log(JSON.stringify(await owner.set(request)));}
}finally{await pool.end();}
