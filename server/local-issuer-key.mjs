import {readFileSync,writeFileSync} from 'node:fs';
import {generateKeyPairSync,createPrivateKey} from 'node:crypto';
// Local pilot only. Existing keys are never replaced on parse or access failure.
export function localIssuerKey(path){
 try{return createPrivateKey(readFileSync(path));}
 catch(error){if(error.code!=='ENOENT')throw error;}
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const pem=privateKey.export({type:'pkcs8',format:'pem'});
 try{writeFileSync(path,pem,{flag:'wx',mode:0o600});return privateKey;}
 catch(error){if(error.code==='EEXIST')return createPrivateKey(readFileSync(path));throw error;}
}
