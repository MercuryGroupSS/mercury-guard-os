import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
export function configuredFixture({port=55448}={}){
 const dir=mkdtempSync(join(tmpdir(),'mercury-configured-test-'));
 const save=(name,value)=>{const path=join(dir,name);writeFileSync(path,value,{mode:0o600});return path;};
 try{
  const tlsKey=save('tls-private.pem',generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'})),issuerKey=save('issuer-private.pem',generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'})),certificate=join(dir,'certificate.pem');
  execFileSync('openssl',['req','-new','-x509','-key',tlsKey,'-out',certificate,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
  const key=role=>[Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),Buffer.from(JSON.stringify({role})).toString('base64url'),'synthetic'].join('.');
  return {dir,save,close:()=>rmSync(dir,{recursive:true,force:true}),config:{version:1,mode:'isolated_local_pilot',deployment_id:randomUUID(),public_origin:'https://localhost:'+port,listen:{host:'127.0.0.1',port},auth:{origin:'http://127.0.0.1:55321',publishable_key:key('anon'),server_key:key('service_role')},database:{url:'postgresql://synthetic:synthetic@127.0.0.1:55322/synthetic',ca_path:null},issuer:{issuer:'synthetic-configured',audience:'synthetic-configured',key_id:'synthetic-configured',private_key_path:issuerKey},tls:{certificate_path:certificate,private_key_path:tlsKey},ops_refresh:null,dashboard_delivery:null}};
 }catch{rmSync(dir,{recursive:true,force:true});throw Error('Synthetic configured fixture unavailable');}
}
