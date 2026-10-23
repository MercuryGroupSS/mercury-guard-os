import {spawn} from 'node:child_process';import {localDockerArgs} from '../local-docker-args.mjs';
export async function runLocalDocker(){
 const real=process.env.MERCURY_REAL_DOCKER;if(!real?.startsWith('/'))throw Error('Explicit Docker executable required');const allowed=JSON.parse(process.env.MERCURY_LOCAL_PORTS??'[]');if(!Array.isArray(allowed)||!allowed.length||allowed.some(p=>!Number.isInteger(p)||p<1||p>65535))throw Error('Configured local ports required');
 const args=localDockerArgs(process.argv.slice(2),allowed),child=spawn(real,args,{stdio:'inherit'});for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
 process.exitCode=await new Promise((resolve,reject)=>{child.once('error',()=>reject(Error('Docker execution failed')));child.once('exit',code=>resolve(code??1));});
}
