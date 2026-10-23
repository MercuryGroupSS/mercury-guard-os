import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {mkdir,writeFile,chmod,readFile} from 'node:fs/promises';import {fileURLToPath} from 'node:url';
import {localProject,localNetwork,configuredLocalPorts,parseLocalStatus,verifyLocalPublishedPorts} from '../local-stack-input.mjs';
const args=process.argv.slice(2);if(args.some(a=>!['--restart','--status','--help'].includes(a)))throw Error('Use --help for supported local stack options');
if(args.includes('--help')){console.log('Start the isolated Mercury Guard stack with loopback-only published ports.\nUsage: node server/scripts/start-local-stack.mjs [--restart|--status]\n--restart preserves data while applying local Auth/template settings. --status performs read-only verification and refreshes the private runtime config.');process.exit(0);}
if(args.includes('--restart')&&args.includes('--status'))throw Error('Choose restart or status');
const root=fileURLToPath(new URL('../../',import.meta.url)),privateDir=new URL('../../.local-backend/',import.meta.url),cli=fileURLToPath(new URL('../node_modules/.bin/supabase',import.meta.url)),docker=process.env.MERCURY_DOCKER_BIN??'/usr/local/bin/docker',execute=promisify(execFile);
const allowedPorts=configuredLocalPorts(await readFile(new URL('../../supabase/config.toml',import.meta.url),'utf8'));
await mkdir(privateDir,{recursive:true,mode:0o700});await chmod(privateDir,0o700);
const wrapperDir=new URL('docker-bin/',privateDir);await mkdir(wrapperDir,{recursive:true,mode:0o700});const wrapper=new URL('docker',wrapperDir);await writeFile(wrapper,'#!/usr/bin/env node\nimport('+JSON.stringify(new URL('./local-docker.mjs',import.meta.url).href)+').then(m=>m.runLocalDocker()).catch(()=>{console.error("Local Docker command rejected.");process.exitCode=1;});\n',{mode:0o700});await chmod(wrapper,0o700);
const cliEnvironment={...process.env,PATH:fileURLToPath(wrapperDir)+':'+process.env.PATH,MERCURY_REAL_DOCKER:docker,MERCURY_LOCAL_PORTS:JSON.stringify(allowedPorts)};
async function run(binary,command,label){try{return await execute(binary,command,{cwd:root,env:binary===cli?cliEnvironment:process.env,encoding:'utf8',timeout:240000,maxBuffer:16*1024*1024});}catch(error){const file=new URL(label+'.log',privateDir);await writeFile(file,(error.stdout??'')+'\n'+(error.stderr??''),{mode:0o600});await chmod(file,0o600);throw Error(label+' failed; details are in the private .local-backend directory');}}
async function ensureNetwork(){
 const listed=await run(docker,['network','ls','--filter','name='+localNetwork,'--format','{{.Name}}'],'stack-network-list');
 if(!listed.stdout.split('\n').includes(localNetwork))await run(docker,['network','create','--driver','bridge','--opt','com.docker.network.bridge.host_binding_ipv4=127.0.0.1','--label','com.mercury.guard.project='+localProject,localNetwork],'stack-network-create');
 const result=await run(docker,['network','inspect',localNetwork],'stack-network-inspect'),network=JSON.parse(result.stdout)[0];if(network.Driver!=='bridge'||network.Options?.['com.docker.network.bridge.host_binding_ipv4']!=='127.0.0.1'||network.Labels?.['com.mercury.guard.project']!==localProject)throw Error('Dedicated Guard loopback network mismatch');
}
if(!args.includes('--status')){
 if(args.includes('--restart')){console.log('Restarting only '+localProject+'; database volumes are preserved.');await run(cli,['stop','--project-id',localProject,'--workdir',root],'stack-stop');}
 await ensureNetwork();console.log('Starting Guard services on the dedicated loopback network.');const started=await run(cli,['start','--workdir',root,'--network-id',localNetwork],'stack-start');const log=new URL('stack-start.log',privateDir);await writeFile(log,started.stdout+'\n'+started.stderr,{mode:0o600});await chmod(log,0o600);
}
const list=await run(docker,['ps','--filter','name='+localProject,'--format','{{.Names}}'],'stack-container-list'),names=list.stdout.split('\n').filter(n=>n.startsWith('supabase_')&&n.endsWith('_'+localProject));
const inspected=await run(docker,['inspect',...names],'stack-container-inspect');let ports;
try{ports=verifyLocalPublishedPorts(JSON.parse(inspected.stdout),allowedPorts);}catch(error){if(!args.includes('--status'))await run(cli,['stop','--project-id',localProject,'--workdir',root],'stack-stop-unsafe-binding');throw error;}
const status=await run(cli,['status','--workdir',root,'--output','json','--output-format','json'],'stack-status'),config=parseLocalStatus(status.stdout),file=new URL('../../supabase-start.log',import.meta.url);await writeFile(file,JSON.stringify(config)+'\n',{mode:0o600});await chmod(file,0o600);
console.log(JSON.stringify({project:localProject,api:config.API_URL,emailInbox:'http://127.0.0.1:55324',loopbackPorts:ports.map(p=>p.port),runtimeConfig:'private supabase-start.log refreshed'}));
