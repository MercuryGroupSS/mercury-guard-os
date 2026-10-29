import {openSync,closeSync,fstatSync,readFileSync,constants} from 'node:fs';
import {isAbsolute} from 'node:path';
import {isIP} from 'node:net';
import {createPrivateKey,createPublicKey,createHash,X509Certificate} from 'node:crypto';
import {strictJson} from './verify-batch.mjs';
import {validateOpsSourceConfig} from './ops-source-config.mjs';

const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.sort().join();
const text=(v,max=16384)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const path=v=>text(v,4096)&&isAbsolute(v);
const fail=()=>{throw Error('Configured service configuration invalid');};
function origin(value,local=false){
 if(!text(value,256))fail();const u=new URL(value);
 if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||u.origin!==value||(u.protocol!=='https:'&&!(local&&value==='http://127.0.0.1:55321')))fail();
 return value;
}
function apiKey(value,role){
 if(!text(value)||/\s/.test(value))fail();
 if(value.startsWith(role==='anon'?'sb_publishable_':'sb_secret_'))return value;
 const parts=value.split('.');if(parts.length!==3||parts.some(v=>!v||!/^[A-Za-z0-9_-]+$/.test(v)))fail();
 if(strictJson(Buffer.from(parts[1],'base64url').toString('utf8'))?.role!==role)fail();return value;
}
// Pure validation: never discovers credentials, loads environment variables or opens a network.
export function validateConfiguredServiceConfig(value){
 try{
  const fields=['version','mode','deployment_id','public_origin','listen','auth','database','issuer','tls','ops_refresh','dashboard_delivery'];
  if(!exact(value,Object.hasOwn(value??{},'dashboard_receiver')?[...fields,'dashboard_receiver']:fields)||value.version!==1||!['isolated_local_pilot','configured'].includes(value.mode)||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(value.deployment_id))fail();
  const c=structuredClone(value),local=c.mode==='isolated_local_pilot';origin(c.public_origin);
  if(!exact(c.listen,['host','port'])||!isIP(c.listen.host)||!Number.isSafeInteger(c.listen.port)||c.listen.port<1||c.listen.port>65535||Number(new URL(c.public_origin).port||443)!==c.listen.port)fail();
  if(local&&(!['127.0.0.1','::1'].includes(c.listen.host)||!['localhost','127.0.0.1','[::1]'].includes(new URL(c.public_origin).hostname)))fail();
  if(!exact(c.auth,['origin','publishable_key','server_key']))fail();origin(c.auth.origin,local);if(local&&c.auth.origin!=='http://127.0.0.1:55321')fail();
  apiKey(c.auth.publishable_key,'anon');apiKey(c.auth.server_key,'service_role');
  if(!exact(c.database,['url','ca_path'])||!text(c.database.url,8192)||(c.database.ca_path!==null&&!path(c.database.ca_path)))fail();
  const db=new URL(c.database.url);
  if(!['postgres:','postgresql:'].includes(db.protocol)||!db.username||!db.password||db.search||db.hash||!/^\/[^/]+$/.test(db.pathname)||!db.hostname)fail();
  if(local&&(!['127.0.0.1','localhost'].includes(db.hostname)||db.port!=='55322'||c.database.ca_path!==null))fail();
  if(!exact(c.issuer,['issuer','audience','key_id','private_key_path'])||!text(c.issuer.issuer,256)||!(/^[A-Za-z0-9._:/-]{1,128}$/).test(c.issuer.audience)||!(/^[A-Za-z0-9_-]{1,64}$/).test(c.issuer.key_id)||!path(c.issuer.private_key_path))fail();
  if(!exact(c.tls,['certificate_path','private_key_path'])||!path(c.tls.certificate_path)||!path(c.tls.private_key_path))fail();
  if(c.ops_refresh!==null){validateOpsSourceConfig(c.ops_refresh,{credentials:true,interval:true});if(c.ops_refresh.transport==='schedule_bridge'&&[c.auth.publishable_key,c.auth.server_key].includes(c.ops_refresh.schedule_token))fail();}
  if(c.dashboard_delivery!==null&&(!exact(c.dashboard_delivery,['configuration_path','interval_ms'])||!path(c.dashboard_delivery.configuration_path)||!Number.isSafeInteger(c.dashboard_delivery.interval_ms)||c.dashboard_delivery.interval_ms<1000||c.dashboard_delivery.interval_ms>3600000))fail();
  if(c.dashboard_receiver!=null&&(!exact(c.dashboard_receiver,['configuration_path'])||!path(c.dashboard_receiver.configuration_path)))fail();
  return c;
 }catch{fail();}
}
export function readConfiguredFile(filename,{privateFile=true,maxBytes=131072}={}){
 if(!path(filename))throw Error('Regular bounded configuration file required');
 let fd;try{fd=openSync(filename,constants.O_RDONLY|constants.O_NOFOLLOW);const stat=fstatSync(fd);
  if(!stat.isFile()||stat.size<1||stat.size>maxBytes||(privateFile&&((stat.mode&0o077)!==0||(process.getuid&&stat.uid!==process.getuid()))))throw Error();
  const bytes=readFileSync(fd);if(bytes.length!==stat.size)throw Error();return bytes;
 }catch{throw Error('Regular bounded configuration file required');}finally{if(fd!==undefined)closeSync(fd);}
}
export function readConfiguredServiceConfig(filename){
 try{return validateConfiguredServiceConfig(strictJson(readConfiguredFile(filename,{maxBytes:65536}).toString('utf8')));}catch{fail();}
}
export function loadConfiguredMaterials(config,{now=Date.now()}={}){
 try{
  const certificate=readConfiguredFile(config.tls.certificate_path,{privateFile:false}),tlsKey=readConfiguredFile(config.tls.private_key_path),issuerKey=createPrivateKey(readConfiguredFile(config.issuer.private_key_path)),certificateKey=createPrivateKey(tlsKey),leaf=new X509Certificate(certificate);
  if(issuerKey.asymmetricKeyType!=='rsa'||issuerKey.asymmetricKeyDetails.modulusLength<2048)fail();
  const spki=key=>createPublicKey(key).export({type:'spki',format:'der'}),issuerSpki=spki(issuerKey),hostname=new URL(config.public_origin).hostname.replace(/^\[|\]$/g,'');
  if(!spki(certificateKey).equals(leaf.publicKey.export({type:'spki',format:'der'}))||Date.parse(leaf.validFrom)>now||Date.parse(leaf.validTo)<=now||!(isIP(hostname)?leaf.checkIP(hostname):leaf.checkHost(hostname,{subject:'never'})))fail();
  const databaseCa=config.database.ca_path===null?undefined:readConfiguredFile(config.database.ca_path,{privateFile:false});
  return {certificate,tlsKey,issuerKey,databaseCa,issuerPublicKey:issuerSpki.toString('base64url'),issuerSha256:createHash('sha256').update(issuerSpki).digest('hex')};
 }catch{throw Error('Configured TLS or issuer material invalid');}
}
export function configuredDeploymentIdentity(config,materials){return {deployment_id:config.deployment_id,auth_origin:config.auth.origin,public_origin:config.public_origin,issuer:config.issuer.issuer,audience:config.issuer.audience,issuer_key_id:config.issuer.key_id,issuer_spki_sha256:materials.issuerSha256};}
export function configuredPublicConfiguration(config,materials,deviceId){
 if(typeof deviceId!=='string'||!(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/).test(deviceId))throw Error('Approved installation ID required');
 return {endpoint:config.public_origin,issuer:config.issuer.issuer,audience:config.issuer.audience,device_id:deviceId,issuer_keys:{[config.issuer.key_id]:materials.issuerPublicKey}};
}
