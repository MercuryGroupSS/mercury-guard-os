import {readFileSync} from 'node:fs';
import {strictJson} from '../verify-batch.mjs';
import {validateProvisioning,createProvisioning} from '../provisioning.mjs';
const args=process.argv.slice(2);
try{
 if(args.length!==2&&args.length!==4||args[0]!=='--input'||args.length===4&&args[2]!=='--output')throw Error('Usage: --input manifest.json [--output new-directory]');
 const raw=readFileSync(args[1]);if(raw.length>2_000_000)throw Error('Provisioning input too large');
 const value=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(raw));
 const result=args.length===4?createProvisioning(value,args[3]):{status:'validated_only',counts:validateProvisioning(value)};
 console.log(JSON.stringify(result));
}catch{console.error('Provisioning failed. Check input fields, unique identities, approved public keys and links. Output must be a new directory. Existing configuration was not activated or replaced.');process.exitCode=1;}
