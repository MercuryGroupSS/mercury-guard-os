#!/usr/bin/env node
import {readConfiguredServiceConfig,loadConfiguredMaterials,configuredDeploymentIdentity,configuredPublicConfiguration} from '../configured-service-config.mjs';
import {openConfiguredRuntime} from '../configured-runtime.mjs';

const args=process.argv.slice(2);
if(args.length===1&&args[0]==='--help'){
 console.log('Usage: node server/scripts/start-configured-service.mjs --inspect|--check|--serve /ABS/PRIVATE/runtime.json\n       node server/scripts/start-configured-service.mjs --public-config /ABS/PRIVATE/runtime.json APPROVED_DEVICE_ID\nInspect/public-config read local files only. Check verifies the existing database/Auth settings without listening or starting workers. Serve is explicit activation. No credential discovery, schema changes or automatic provisioning.');
}else{
 let runtime,stopping=false;
 const stop=async()=>{if(stopping)return;stopping=true;try{await runtime?.close();}catch{console.error('Configured service shutdown unconfirmed; preserve runtime and records for owner review.');process.exitCode=1;}};
 try{
  if(!['--inspect','--check','--serve','--public-config'].includes(args[0])||args.length!==(args[0]==='--public-config'?3:2))throw Error();
  const config=readConfiguredServiceConfig(args[1]),materials=loadConfiguredMaterials(config);
  if(args[0]==='--inspect')console.log(JSON.stringify({status:'files_validated_not_activated',deployment:configuredDeploymentIdentity(config,materials)}));
  else if(args[0]==='--public-config')console.log(JSON.stringify(configuredPublicConfiguration(config,materials,args[2])));
  else{
   process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
   runtime=await openConfiguredRuntime(config,materials);
   if(stopping){await runtime.close();}else if(args[0]==='--check'){console.log(JSON.stringify(await runtime.check()));await stop();}
   else{const origin=await runtime.start();if(stopping)await runtime.close();else console.log(JSON.stringify({status:'configured_service_started',origin,deployment_id:config.deployment_id}));}
  }
 }catch{console.error('Configured service request failed; no credential details are printed. Review approved inputs and private server diagnostics.');process.exitCode=1;await stop();}
}
