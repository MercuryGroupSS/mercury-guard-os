import {readConfiguredOwnerInput,loadConfiguredOwnerMaterials} from '../configured-owner-input.mjs';
import {openConfiguredOwner} from '../configured-owner-membership.mjs';
const args=process.argv.slice(2);
if(args.length===1&&args[0]==='--help'){
 console.log('Owner-only configured Guard administrator membership.\nUsage: node server/scripts/set-configured-admin.mjs --input /absolute/private-owner-request.json [--apply]\nDefault: review only, no membership changes. Apply only the same reviewed request UUID/body.\nRequires supplied owner PostgreSQL credentials, verified database CA, exact existing deployment marker and trusted Auth server key. Creates no accounts, roles, enrollment, assignments or messages.');
}else{
 let owner;
 try{
  if(!((args.length===2||args.length===3)&&args[0]==='--input'&&args[1]&&!args[1].startsWith('--')&&(args.length===2||args[2]==='--apply')))throw Error();
  const config=readConfiguredOwnerInput(args[1]);owner=await openConfiguredOwner(config,loadConfiguredOwnerMaterials(config));console.log(JSON.stringify(args.length===3?await owner.apply():await owner.review()));
 }catch{console.error('Configured owner operation failed. No success is confirmed; review the exact private configuration and retry the original request to resolve an uncertain result.');process.exitCode=1;}
 finally{try{await owner?.close();}catch{console.error('Owner connection cleanup could not be confirmed.');process.exitCode=1;}}
}
