import {openSync,closeSync,fstatSync,readFileSync,realpathSync,constants} from 'node:fs';
import {isAbsolute,resolve,relative,sep,dirname,basename} from 'node:path';
import {createPublicKey} from 'node:crypto';
import {strictJson} from './verify-batch.mjs';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.slice().sort().join();
const text=(v,max=4096)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const path=v=>text(v)&&isAbsolute(v);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function readPrivateBuildFile(filename,max=65536){
 let fd;try{if(!path(filename))throw Error();fd=openSync(filename,constants.O_RDONLY|constants.O_NOFOLLOW);const s=fstatSync(fd);
  if(!s.isFile()||s.size<1||s.size>max||(s.mode&0o077)!==0||(process.getuid&&s.uid!==process.getuid()))throw Error();
  const b=readFileSync(fd);if(b.length!==s.size)throw Error();return b;
 }catch{throw Error('Private bounded owned build file required');}finally{if(fd!==undefined)closeSync(fd);}
}
export function validatePublicGuardConfiguration(value,mode){
 try{
  if(!exact(value,['endpoint','issuer','audience','device_id','issuer_keys']))throw Error();
  const u=new URL(value.endpoint);
  if(!text(value.endpoint,256)||u.protocol!=='https:'||u.origin!==value.endpoint||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error();
  if(mode==='synthetic_build_proof'?!u.hostname.endsWith('.invalid'):u.hostname.endsWith('.invalid'))throw Error();
  if(!text(value.issuer,256)||!(/^[A-Za-z0-9._:/-]{1,128}$/).test(value.audience)||!(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/).test(value.device_id))throw Error();
  if(!value.issuer_keys||Array.isArray(value.issuer_keys)||Object.keys(value.issuer_keys).length<1||Object.keys(value.issuer_keys).length>4)throw Error();
  for(const [id,encoded] of Object.entries(value.issuer_keys)){
   if(!/^[A-Za-z0-9_-]{1,64}$/.test(id)||typeof encoded!=='string'||encoded.length>4096||!/^[A-Za-z0-9_-]+$/.test(encoded))throw Error();
   const bytes=Buffer.from(encoded,'base64url');if(bytes.toString('base64url')!==encoded)throw Error();
   const key=createPublicKey({key:bytes,format:'der',type:'spki'});if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails.modulusLength<2048||!key.export({format:'der',type:'spki'}).equals(bytes))throw Error();
  }
  return structuredClone(value);
 }catch{throw Error('Exact public HTTPS/RSA Guard configuration required');}
}
export function validateControlledBuildInput(value){
 try{
  if(!exact(value,['version','mode','source_directory','source_commit','public_config_path','signing','expected','output_directory','previous_apk','tools'])||value.version!==1||!['controlled_release','synthetic_build_proof'].includes(value.mode))throw Error();
  for(const key of ['source_directory','public_config_path','output_directory'])if(!path(value[key]))throw Error();
  if(!/^[a-f0-9]{40}$/.test(value.source_commit)||!(value.previous_apk===null||path(value.previous_apk)))throw Error();
  const inside=relative(resolve(value.source_directory),resolve(value.output_directory));if(inside===''||(!(inside==='..'||inside.startsWith('..'+sep))&&!isAbsolute(inside)))throw Error();
  const s=value.signing;if(!exact(s,['keystore_path','store_password','key_alias','key_password'])||!path(s.keystore_path)||!text(s.key_alias,256)||['store_password','key_password'].some(k=>typeof s[k]!=='string'||s[k].length<1||s[k].length>1024||s[k].includes('\u0000')))throw Error();
  const e=value.expected;if(!exact(e,['package','version_code','version_name','signer_sha256'])||!/^ca\.mercury\.guard$/.test(e.package)||!Number.isSafeInteger(e.version_code)||e.version_code<1||!text(e.version_name,100)||!hash(e.signer_sha256))throw Error();
  const t=value.tools;if(!exact(t,['gradle','java_home','android_sdk','gradle_cache_directory'])||!['gradle','java_home','android_sdk'].every(k=>path(t[k]))||!(t.gradle_cache_directory===null||path(t.gradle_cache_directory)))throw Error();
  return structuredClone(value);
 }catch{throw Error('Exact reviewed controlled build input required');}
}
export function assertControlledBuildOutputIsolation(source,output){
 try{
  const actualSource=realpathSync(source),actualOutput=resolve(realpathSync(dirname(output)),basename(output));
  const inside=relative(actualSource,actualOutput);
  if(inside===''||(!(inside==='..'||inside.startsWith('..'+sep))&&!isAbsolute(inside)))throw Error();
 }catch{throw Error('Existing resolved output parent outside source required');}
}
export function loadControlledBuildInput(filename){
 try{const input=validateControlledBuildInput(strictJson(readPrivateBuildFile(filename).toString('utf8'))),bytes=readPrivateBuildFile(input.public_config_path,16384);
  validatePublicGuardConfiguration(strictJson(bytes.toString('utf8')),input.mode);readPrivateBuildFile(input.signing.keystore_path,16*1024*1024);
  return {input,publicBytes:bytes};
 }catch{throw Error('Controlled build inputs unavailable or invalid');}
}
export function assertPreviousApkCompatible(previous,expected){
 if(previous.package!==expected.package||previous.signer_sha256!==expected.signer_sha256||previous.version_code>expected.version_code)throw Error('Previous APK identity mismatch or downgrade');
}
export function parseApkIdentity(badging,certificates){
 const p=/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'/m.exec(badging),signers=[...certificates.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([a-f0-9]{64})\s*$/gmi)];
 if(!p||!Number.isSafeInteger(Number(p[2]))||Number(p[2])<1||signers.length!==1||badging.includes('application-debuggable'))throw Error('Verified nondebuggable single-signer APK required');
 return {package:p[1],version_code:Number(p[2]),version_name:p[3],signer_sha256:signers[0][1].toLowerCase()};
}
