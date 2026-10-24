import {isAbsolute} from 'node:path';
import {X509Certificate} from 'node:crypto';
import {strictJson} from './verify-batch.mjs';
import {readConfiguredFile} from './configured-service-config.mjs';
import {membershipRequest} from './owner-admin-membership.mjs';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.slice().sort().join();
const text=(v,max=16384)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x20\x7f]/.test(v);
const origin=v=>{if(!text(v,256))throw Error();const u=new URL(v);if(u.protocol!=='https:'||u.origin!==v||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error();return v;};
export function validateConfiguredOwnerInput(value){
 try{
  if(!exact(value,['version','expected_deployment','database','auth','request'])||value.version!==1)throw Error();
  const c=structuredClone(value),d=c.expected_deployment;
  if(!exact(d,['deployment_id','auth_origin','public_origin','issuer','audience','issuer_key_id','issuer_spki_sha256'])||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(d.deployment_id)||!text(d.issuer,256)||!(/^[A-Za-z0-9._:/-]{1,128}$/).test(d.audience)||!(/^[A-Za-z0-9_-]{1,64}$/).test(d.issuer_key_id)||!(/^[a-f0-9]{64}$/).test(d.issuer_spki_sha256))throw Error();origin(d.auth_origin);origin(d.public_origin);
  if(!exact(c.database,['url','ca_path'])||!text(c.database.url,8192)||!text(c.database.ca_path,4096)||!isAbsolute(c.database.ca_path))throw Error();
  const db=new URL(c.database.url);if(!['postgres:','postgresql:'].includes(db.protocol)||!db.username||!db.password||!db.hostname||db.search||db.hash||!/^\/[^/]+$/.test(db.pathname))throw Error();
  if(!exact(c.auth,['origin','server_key'])||origin(c.auth.origin)!==d.auth_origin||!text(c.auth.server_key))throw Error();
  if(!/^sb_secret_[A-Za-z0-9_-]+$/.test(c.auth.server_key)){const parts=c.auth.server_key.split('.');if(parts.length!==3||parts.some(p=>!p||!/^[A-Za-z0-9_-]+$/.test(p))||strictJson(Buffer.from(parts[1],'base64url').toString('utf8'))?.role!=='service_role')throw Error();}
  c.request=membershipRequest(c.request);return c;
 }catch{throw Error('Explicit configured owner input invalid');}
}
export function readConfiguredOwnerInput(filename){try{return validateConfiguredOwnerInput(strictJson(readConfiguredFile(filename,{maxBytes:65536}).toString('utf8')));}catch{throw Error('Private configured owner input unavailable or invalid');}}
export function loadConfiguredOwnerMaterials(config){
 try{const databaseCa=readConfiguredFile(config.database.ca_path,{maxBytes:32768}),text=databaseCa.toString('utf8'),certificates=text.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);if(!certificates?.length||certificates.length>8||certificates.join('').replace(/\s/g,'')!==text.replace(/\s/g,''))throw Error();for(const pem of certificates)new X509Certificate(pem);return {databaseCa};}
 catch{throw Error('Explicit private database CA unavailable or invalid');}
}
