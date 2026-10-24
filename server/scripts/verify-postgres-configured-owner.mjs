import assert from 'node:assert/strict';
import {Client,Pool} from 'pg';
import {createServer as tcpServer,connect as tcpConnect} from 'node:net';
import {createServer as httpsServer,request as httpsRequest} from 'node:https';
import {createSecureContext,TLSSocket} from 'node:tls';
import {readFileSync,readdirSync,writeFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {configuredFixture} from '../fixtures/configured-service.mjs';
import {readConfiguredOwnerInput,loadConfiguredOwnerMaterials} from '../configured-owner-input.mjs';
import {openConfiguredOwner} from '../configured-owner-membership.mjs';
const settings={connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:12000};
const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve(server.address().port);});});
const close=server=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
// Own a fresh child, including when called after other canonical verifier groups.
// Both the DB owner connection and synthetic Auth use real verified TLS. The
// database TLS proxy terminates only on loopback and forwards to this local DB;
// it is fixture transport, never a production launcher or a TLS bypass flag.
export async function verifyPostgresConfiguredOwner(connectionString,owner){
 const url=new URL(connectionString);if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.port!=='55322'||url.search||url.hash)throw Error('Owned loopback PostgreSQL required');
 const run=randomUUID(),name='mercury_owner_verify_'+run.replaceAll('-',''),marker='mercury-owner-verifier:'+run,record=new URL('../../.local-backend/configured-owner-verify-'+run+'.json',import.meta.url);let attempted=false,created=false,marked=false,fixture,role,absent=false;
 mkdirSync(new URL('../../.local-backend/',import.meta.url),{recursive:true,mode:0o700});writeFileSync(record,'{}',{flag:'wx',mode:0o600});
 const save=()=>writeFileSync(record,JSON.stringify({run,database:name,marker,owner:role??null,create_attempted:attempted,create_confirmed:created,marker_confirmed:marked,cleanup_absent:absent})+'\n',{mode:0o600});
 try{
  role=(await owner.query('SELECT current_user AS role,session_user AS session_role')).rows[0];assert.deepEqual(role,{role:'postgres',session_role:'postgres'});role=role.role;attempted=true;save();await owner.query('CREATE DATABASE '+name);created=true;save();await owner.query("COMMENT ON DATABASE "+name+" IS '"+marker+"'");marked=true;save();url.pathname='/'+name;
  fixture=new Client({connectionString:url.toString(),...settings});await fixture.connect();await fixture.query('CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,banned_until timestamptz,deleted_at timestamptz);CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),not_after timestamptz);');
  for(const file of readdirSync(new URL('../../supabase/migrations/',import.meta.url)).filter(x=>/^\d+.*\.sql$/.test(x)).sort())await fixture.query(readFileSync(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
  await verifyFixture(url,fixture,run);
 }finally{
  await fixture?.end();if(attempted){const db=(await owner.query("SELECT pg_get_userbyid(datdba) AS owner,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=$1",[name])).rows[0];if(db){if(!created||!marked||db.owner!==role||db.marker!==marker)throw Error('Configured owner child cleanup ownership uncertain; private recovery record retained');await owner.query('DROP DATABASE '+name);}assert.equal((await owner.query('SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname=$1) AS present',[name])).rows[0].present,false);}absent=true;save();unlinkSync(record);console.log('PASS: exact configured-owner child database and private recovery record removed');
 }
}
async function verifyFixture(childUrl,owner,run){
 const f=configuredFixture(),sockets=new Set(),ownerCommands=[],subject=randomUUID(),email='synthetic-owner-'+run+'@example.invalid',serverKey='sb_secret_synthetic_owner_fixture_only',certificate=readFileSync(f.config.tls.certificate_path),tlsKey=readFileSync(f.config.tls.private_key_path),context=createSecureContext({cert:certificate,key:tlsKey});let dbTls,auth,authGets=0,providerPatch={},flip=false;
 const remember=socket=>{sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>sockets.delete(socket));return socket;};
 try{
  // PostgreSQL's SSLRequest is answered before wrapping the existing socket.
  dbTls=tcpServer(socket=>{remember(socket);socket.setTimeout(15000,()=>socket.destroy());socket.once('data',bytes=>{
   if(!bytes.equals(Buffer.from('0000000804d2162f','hex'))){socket.destroy();return;}socket.write('S');const secure=remember(new TLSSocket(socket,{isServer:true,secureContext:context})),upstream=remember(tcpConnect({host:'127.0.0.1',port:55322}));secure.once('error',()=>upstream.destroy());upstream.once('error',()=>secure.destroy());secure.once('close',()=>upstream.destroy());upstream.once('close',()=>secure.destroy());secure.pipe(upstream);upstream.pipe(secure);
  });});const dbPort=await listen(dbTls);
  auth=httpsServer({cert:certificate,key:tlsKey},(request,response)=>{
   if(request.method!=='GET'||request.url!=='/auth/v1/admin/users/'+subject||request.headers.apikey!==serverKey){response.writeHead(403);response.end();return;}authGets++;response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({id:subject,email,email_confirmed_at:new Date().toISOString(),banned_until:null,...providerPatch}));
  });auth.on('connection',remember);const authPort=await listen(auth),authOrigin='https://localhost:'+authPort;
  const identity={deployment_id:randomUUID(),auth_origin:authOrigin,public_origin:'https://synthetic-guard.example.invalid',issuer:'https://synthetic-guard.example.invalid',audience:'synthetic-owner',issuer_key_id:'synthetic-owner',issuer_spki_sha256:'a'.repeat(64)};
  const db=new URL(childUrl);db.hostname='localhost';db.port=String(dbPort);const config={version:1,expected_deployment:identity,database:{url:db.toString(),ca_path:f.save('database-ca.pem',certificate)},auth:{origin:authOrigin,server_key:serverKey},request:{requestId:randomUUID(),subject,email,active:true,operator:'Synthetic owner verifier',reason:'Disposable configured administrator acceptance'}};
  const input=f.save('owner-request.json',JSON.stringify(config)),validated=readConfiguredOwnerInput(input),materials=loadConfiguredOwnerMaterials(validated);
  const fetchImpl=(url,options)=>new Promise((resolve,reject)=>{assert.equal(new URL(url).origin,authOrigin);assert.equal(options.redirect,'error');const request=httpsRequest({hostname:'127.0.0.1',servername:'localhost',port:authPort,path:new URL(url).pathname,method:'GET',headers:options.headers,ca:certificate,rejectUnauthorized:true,signal:options.signal},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode})));});request.on('error',reject);request.end();});
  const poolFactory=options=>{assert.equal(options.ssl.rejectUnauthorized,true);assert.deepEqual(options.ssl.ca,certificate);assert.equal(options.max,1);const pool=new Pool(options);pool.on('connect',client=>{const query=client.query.bind(client);client.query=async(sql,values)=>{const result=await query(sql,values);if(flip&&typeof sql==='string'&&sql.startsWith('INSERT INTO mercury_guard.admin_membership_audit')){flip=false;await query("UPDATE mercury_guard.deployment_identity SET issuer='https://different.example.invalid'");}return result;};});return pool;};
  const open=async(c=validated,options={})=>{const command=await openConfiguredOwner(c,materials,{fetchImpl,poolFactory,...options});ownerCommands.push(command);return command;};
  await assert.rejects(open());assert.equal(authGets,0);
  await owner.query('INSERT INTO mercury_guard.deployment_identity(singleton,deployment_id,auth_origin,public_origin,issuer,audience,issuer_key_id,issuer_spki_sha256,approved_by,reason) VALUES(true,$1,$2,$3,$4,$5,$6,$7,$8,$9)',[...Object.values(identity),'Synthetic owner verifier','Disposable configured owner fixture']);
  await owner.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,clock_timestamp())',[subject,email]);
  for(const field of Object.keys(identity)){const changed=field==='deployment_id'?randomUUID():field==='issuer_spki_sha256'?'b'.repeat(64):field==='auth_origin'?'https://other-auth.example.invalid':field==='public_origin'?'https://other.example.invalid':'different';await assert.rejects(open({...validated,expected_deployment:{...identity,[field]:changed},...(field==='auth_origin'?{auth:{...validated.auth,origin:changed}}:{})}));}
  const command=await open(),review=await command.review();assert.equal(review.changed,false);assert.equal(review.mode,'review');assert.equal((await owner.query('SELECT count(*)::int n FROM mercury_guard.admin_accounts')).rows[0].n,0);assert.equal((await owner.query('SELECT count(*)::int n FROM mercury_guard.admin_membership_audit')).rows[0].n,0);
  for(const patch of [{email:'different@example.invalid'},{email_confirmed_at:null},{banned_until:new Date(Date.now()+3600000).toISOString()}]){providerPatch=patch;await assert.rejects(command.apply());}providerPatch={};
  await owner.query('UPDATE auth.users SET email_confirmed_at=NULL WHERE id=$1',[subject]);await assert.rejects(command.apply());await owner.query('UPDATE auth.users SET email_confirmed_at=clock_timestamp(),deleted_at=clock_timestamp() WHERE id=$1',[subject]);await assert.rejects(command.apply());await owner.query('UPDATE auth.users SET deleted_at=NULL WHERE id=$1',[subject]);
  flip=true;await assert.rejects(command.apply());assert.equal(flip,false);assert.equal((await owner.query('SELECT count(*)::int n FROM mercury_guard.admin_accounts')).rows[0].n,0);assert.equal((await owner.query('SELECT count(*)::int n FROM mercury_guard.admin_membership_audit')).rows[0].n,0);assert.equal((await owner.query('SELECT issuer FROM mercury_guard.deployment_identity')).rows[0].issuer,identity.issuer);
  const receipt=await command.apply(),gets=authGets;assert.equal(receipt.active,true);assert.deepEqual(await command.apply(),receipt);assert.equal(authGets,gets);assert.deepEqual((await command.review()).previous_receipt,receipt);
  const conflict=await open({...validated,request:{...validated.request,reason:'Different body for the original UUID'}});await assert.rejects(conflict.apply());
  await owner.query("UPDATE mercury_guard.deployment_identity SET audience='different'");await assert.rejects(command.apply());await owner.query('UPDATE mercury_guard.deployment_identity SET audience=$1',[identity.audience]);
  const revoke=await open({...validated,request:{...validated.request,requestId:randomUUID(),active:false,reason:'Explicit synthetic membership revocation'}});const beforeRevokeAuth=authGets;assert.equal((await revoke.review()).changed,false);assert.equal((await revoke.apply()).active,false);assert.equal(authGets,beforeRevokeAuth);assert.equal((await owner.query('SELECT active FROM mercury_guard.admin_accounts WHERE auth_subject=$1',[subject])).rows[0].active,false);assert.equal((await owner.query('SELECT count(*)::int n FROM mercury_guard.admin_membership_audit')).rows[0].n,2);
  await command.close();await assert.rejects(command.review(),/closed/);await assert.rejects(command.apply(),/closed/);
  console.log('PASS: configured owner actual verified PostgreSQL STARTTLS and synthetic trusted Auth HTTPS, exact owner+marker, review zero writes, remote and locked Auth confirmation/deletion denial, marker drift rollback, audited exact UUID retry/conflict and explicit revocation; no hosted account, credential discovery or messages');
 }finally{for(const command of ownerCommands)await command.close();for(const socket of sockets)socket.destroy();if(auth?.listening)await close(auth);if(dbTls?.listening)await close(dbTls);f.close();}
}
