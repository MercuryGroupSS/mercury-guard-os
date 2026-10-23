import {ShiftLifecycle} from '../shift-lifecycle.mjs';
import {DispatchFeed} from '../dispatch-feed.mjs';
// Test-only synthetic Auth adapter + actual Guard service, behind localhost TLS.
// Never run on production or expose beyond loopback. No real Supabase credentials.
import {createServer as httpServer} from 'node:http';
import {createServer as httpsServer} from 'node:https';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {LocalGuardDirectory} from '../local-guard-directory.mjs';
import {LocalDeviceAssignments} from '../local-device-assignments.mjs';
import {ShiftGrantIssuer} from '../shift-grant-issuer.mjs';
import {DurableIngest} from '../durable-ingest.mjs';
import {createLocalService} from '../local-service.mjs';
const dir=new URL('../../app/build/https-test/',import.meta.url);
for(const part of ['res/raw/','res/xml/','assets/','main-assets/'])mkdirSync(new URL(part,dir),{recursive:true});
const cert=new URL('res/raw/https_fixture_ca.pem',dir),key=new URL('tls-private.pem',dir);
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key.pathname,'-out',cert.pathname,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost','-addext','extendedKeyUsage=serverAuth'],{stdio:'ignore'});
writeFileSync(new URL('res/xml/https_test_network.xml',dir),'<network-security-config><base-config cleartextTrafficPermitted="false"/><domain-config cleartextTrafficPermitted="false"><domain>localhost</domain><trust-anchors><certificates src="@raw/https_fixture_ca"/></trust-anchors></domain-config></network-security-config>');
const rsa=generateKeyPairSync('rsa',{modulusLength:2048});
const grantIssuer=new ShiftGrantIssuer({path:':memory:',privateKey:rsa.privateKey,keyId:'https-fixture',issuer:'mercury-local',audience:'mercury-local'});
writeFileSync(new URL('assets/https-test-issuer.json',dir),JSON.stringify({public_key_spki:grantIssuer.publicKey()}));
writeFileSync(new URL('main-assets/guard-service.json',dir),JSON.stringify({endpoint:'https://localhost:55443',issuer:'mercury-local',audience:'mercury-local',device_id:'fixture-phone',issuer_keys:{'https-fixture':grantIssuer.publicKey()}}));
if(process.argv.includes('--prepare-only')){grantIssuer.close();console.log('Prepared isolated HTTPS test resources');process.exit(0);}
if(process.env.MERCURY_HTTPS_FIXTURE!=='synthetic-only')throw Error('Explicit synthetic fixture mode required');
const subject=randomUUID(),password='synthetic-password-only',email='https-fixture@example.invalid';
const sessions=new Set();
const auth=httpServer(async(req,res)=>{
 res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');
 const token=/^Bearer ([^\s]+)$/.exec(req.headers.authorization??'')?.[1];
 if(req.headers.apikey!=='fixture-only'){res.writeHead(401);res.end('{}');return;}
 if(req.url==='/auth/v1/user'&&req.method==='GET'&&sessions.has(token)){res.end(JSON.stringify({id:subject}));return;}
 if(req.url==='/auth/v1/logout?scope=local'&&req.method==='POST'&&sessions.has(token)){sessions.delete(token);res.writeHead(204);res.end();return;}
 if(req.url==='/auth/v1/token?grant_type=password'&&req.method==='POST'){
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096){res.writeHead(413);res.end('{}');return;}}
  try{const b=JSON.parse(raw);if(b.email===email&&b.password===password){const token='fixture.'+Buffer.from(JSON.stringify({sub:subject,exp:Math.floor(Date.now()/1000)+3600,session_id:randomUUID()})).toString('base64url')+'.fixture';sessions.add(token);res.end(JSON.stringify({access_token:token,refresh_token:'never-return-this'}));return;}}catch{}
 }
 res.writeHead(401);res.end('{}');
});
await new Promise((resolve,reject)=>{auth.once('error',reject);auth.listen(55321,'127.0.0.1',resolve);});
const dispatch=new DispatchFeed(':memory:');const shiftLifecycle=new ShiftLifecycle(':memory:');
const directory=new LocalGuardDirectory(':memory:'),devices=new LocalDeviceAssignments(':memory:'),store=new DurableIngest(':memory:');
directory.addVendor({vendorId:'fixture-vendor',kind:'company',active:true});directory.addGuard({guardId:'fixture-guard',authSubject:subject,vendorId:'fixture-vendor',active:true});directory.setLoginEmail('fixture-guard',email);
const service=createLocalService({config:{API_URL:'http://127.0.0.1:55321',PUBLISHABLE_KEY:'fixture-only',SERVICE_ROLE_KEY:'fixture-only'},directory,devices,store,grantIssuer,dispatch,shiftLifecycle});
const origin=await service.start();
const tls=httpsServer({key:readFileSync(key),cert:readFileSync(cert)},async(req,res)=>{
 try{
  if(req.url==='/test/health'){res.end('ready');return;}
  if(req.url==='/test/enroll'&&req.method==='POST'){
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)throw Error('large');}
   const body=JSON.parse(raw);
   devices.enroll({deviceId:'fixture-phone',mode:'site',siteId:'fixture-site',active:true,revoked:false,publicKeySpki:body.public_key_spki});
   devices.assign({assignmentId:'fixture-shift',guardId:'fixture-guard',vendorId:'fixture-vendor',siteId:'fixture-site',active:true,startsAt:Date.now()-1000,endsAt:Date.now()+600000,checkInPolicy:{revision:1,interval_ms:1800000,window_ms:600000,max_evidence_age_ms:120000,max_accuracy_m:100},patrolRoute:{routeId:'fixture-route',revision:1,checkpoints:[{id:'entrance',label:'Entrance'},{id:'perimeter',label:'Perimeter'}],rounds:[{id:'opening',label:'Opening patrol'},{id:'closing',label:'Closing patrol'}]}});
   dispatch.publish({guardId:'fixture-guard',vendorId:'fixture-vendor',siteId:'fixture-site',assignmentId:'fixture-shift'},{message_id:'fixture-message',version:1,state:'active',title:'Synthetic dispatch',body:'Inspect the test entrance.',issued_at:Date.now(),due_at:null});
   res.setHeader('content-type','application/json');res.end('{}');return;
  }
  if(req.url==='/test/receipts'){res.setHeader('content-type','application/json');res.end(JSON.stringify({count:store.count(),media_count:store.db.prepare('SELECT count(*) AS n FROM media').get().n}));return;}
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>(req.url.startsWith('/v1/evidence/')?20*1024*1024:360000))throw Error('large');chunks.push(chunk);}
  const response=await fetch(origin+req.url,{method:req.method,headers:{'content-type':req.headers['content-type']??'application/json',authorization:req.headers.authorization??''},...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(400);res.end('{}');}
});
await new Promise((resolve,reject)=>{tls.once('error',reject);tls.listen(55443,'127.0.0.1',resolve);});
console.log('Synthetic HTTPS fixture ready on localhost:55443');
let stopping=false;async function stop(){if(stopping)return;stopping=true;tls.closeAllConnections();auth.closeAllConnections();await service.stop();tls.close();auth.close();sessions.clear();directory.close();devices.close();store.close();grantIssuer.close();dispatch.close();shiftLifecycle.close();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
