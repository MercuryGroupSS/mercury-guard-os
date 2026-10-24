import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {configuredFixture} from './fixtures/configured-service.mjs';
import {validateConfiguredServiceConfig,configuredPublicConfiguration,configuredDeploymentIdentity,loadConfiguredMaterials} from './configured-service-config.mjs';
import {readConfiguredReceiver,createConfiguredReceiver} from './configured-receiver.mjs';
import {createConfiguredApplication} from './configured-service.mjs';

const f=configuredFixture({port:55453});test.after(()=>f.close());
const token='synthetic-receiver-only-0123456789abcdef',settings={version:1,destination:'synthetic-inbox',token};
function enabled(){return {...f.config,dashboard_receiver:{configuration_path:f.save('receiver.json',JSON.stringify(settings))}};}
test('configured receiver is explicitly opt-in, backward compatible and absent from public device/deployment identity',()=>{
 const c=enabled(),material=loadConfiguredMaterials(c);
 assert.deepEqual(validateConfiguredServiceConfig(f.config),f.config);assert.equal(readConfiguredReceiver(f.config),null);
 assert.equal(readConfiguredReceiver({...f.config,dashboard_receiver:null}),null);assert.deepEqual(readConfiguredReceiver(c),{destination:settings.destination,token});
 assert.deepEqual(Object.keys(configuredPublicConfiguration(c,material,'synthetic-phone')).sort(),['audience','device_id','endpoint','issuer','issuer_keys']);
 assert.equal(Object.keys(configuredDeploymentIdentity(c,material)).length,7);
 for(const value of [true,{},'on',{configuration_path:'relative.json'},{configuration_path:c.dashboard_receiver.configuration_path,token}])assert.throws(()=>validateConfiguredServiceConfig({...f.config,dashboard_receiver:value}));
});
test('receiver private settings require exact fields, separate bounded secret and owner-private regular file',()=>{
 const c=enabled(),file=c.dashboard_receiver.configuration_path;
 chmodSync(file,0o640);assert.throws(()=>readConfiguredReceiver(c),/^Error: Configured receiver private configuration invalid$/);chmodSync(file,0o600);
 const link=join(f.dir,'receiver-link.json');symlinkSync(file,link);assert.throws(()=>readConfiguredReceiver({...c,dashboard_receiver:{configuration_path:link}}));
 for(const value of [{...settings,extra:true},{...settings,version:2},{...settings,destination:'bad/name'},{...settings,token:'short'},{...settings,token:'x'.repeat(4097)},{...settings,token:' secret receiver token with whitespace '},...['\0','\x7f','🚀'].map(end=>({...settings,token:'x'.repeat(31)+end})),{...settings,token:c.auth.server_key},{...settings,token:c.auth.publishable_key}]){
  const path=f.save('receiver-bad.json',JSON.stringify(value));assert.throws(()=>readConfiguredReceiver({...c,dashboard_receiver:{configuration_path:path}}),e=>e.message==='Configured receiver private configuration invalid'&&!e.message.includes(value.token));
 }
 const ops={origin:'https://ops.invalid',server_key:'sb_secret_'+'ops'.repeat(15),interval_ms:1000},path=f.save('receiver-ops-secret.json',JSON.stringify({...settings,token:ops.server_key}));assert.throws(()=>readConfiguredReceiver({...c,ops_refresh:ops,dashboard_receiver:{configuration_path:path}}));
});
function args(config,receiver=null){return {config,receiver,pool:{query(){throw Error('Unexpected session query');}},directory:{loadGuardsForSubject:async()=>[],loadVendor:async()=>null},devices:{audience:config.issuer.audience},grantIssuer:{issuer:config.issuer.issuer,audience:config.issuer.audience,keyId:config.issuer.key_id},store:{},dispatch:{},shiftLifecycle:{},admin:{},escalations:{audience:config.issuer.audience,receive(){},status(){}},locationConsents:{audience:config.issuer.audience,challenge(){},receive(){},status(){}},fetchImpl:async()=>{throw Error('Receiver integration token must not contact Auth');}};}
test('configured routes remain off without opt-in and cannot silently omit enabled receiver dependencies',async()=>{
 const app=createConfiguredApplication(args(f.config));for(const path of ['/v1/mercury-one/observations','/v1/mercury-one/media/'+'a'.repeat(64)])assert.equal((await app.handle(new Request(f.config.public_origin+path,{method:'POST',body:'{}'}))).status,404);
 const c=enabled();assert.throws(()=>createConfiguredApplication(args(c)),/Explicit configured receiver/);assert.throws(()=>createConfiguredApplication(args(f.config,{observations(){},media(){}})),/Explicit configured receiver/);
});
test('receiver credential is checked before reading a body; exact Host/Origin and private POST routes remain enforced',async()=>{
 const c=enabled(),pool={query(){throw Error('Unauthorized request must not query');},connect(){throw Error('Unauthorized request must not transact');}},receiver=createConfiguredReceiver({config:c,pool,identity:{}}),app=createConfiguredApplication(args(c,receiver));
 for(const bearer of ['',c.auth.server_key,c.auth.publishable_key,'synthetic-user-session']){
  let read=false;const request={url:c.public_origin+'/v1/mercury-one/observations',method:'POST',headers:new Headers({authorization:'Bearer '+bearer,'content-type':'application/json'}),get body(){read=true;throw Error('No unauthorized body read');}};
  assert.equal((await app.handle(request)).status,401);assert.equal(read,false);
 }
 assert.equal((await app.handle(new Request(c.public_origin+'/v1/mercury-one/observations',{method:'POST',headers:{origin:'https://foreign.invalid',authorization:'Bearer '+token},body:'{}'}))).status,403);
 assert.equal((await app.handle(new Request('https://foreign.invalid/v1/mercury-one/observations',{method:'POST',headers:{authorization:'Bearer '+token},body:'{}'}))).status,421);
 assert.equal((await app.handle(new Request(c.public_origin+'/v1/mercury-one/media/'+'a'.repeat(64),{headers:{authorization:'Bearer '+token}}))).status,405);
 assert.equal((await app.handle(new Request(c.public_origin+'/v1/mercury-one/media/bad-id',{method:'POST'}))).status,404);
});
