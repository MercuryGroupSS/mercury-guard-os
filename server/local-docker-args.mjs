import {localProject} from './local-stack-input.mjs';
export function localDockerArgs(args,allowedPorts){
 if(args[0]!=='create')return args;
 const name=args[args.indexOf('--name')+1];if(!args.includes('--name')||typeof name!=='string'||!name.startsWith('supabase_')||!name.endsWith('_'+localProject))throw Error('Only Mercury Guard local containers may be created through this helper');
 if(args.includes('-P')||args.includes('--publish-all'))throw Error('Implicit published ports are not permitted');
 const result=[...args];for(let i=1;i<result.length;i++){if(result[i]!=='-p'&&result[i]!=='--publish')continue;const spec=result[++i],parts=spec?.split(':');if(!parts||parts.length<2||parts.length>3)throw Error('Explicit local port mapping required');const hostPort=parts.at(-2),containerPort=parts.at(-1);if(!/^\d+$/.test(hostPort)||!/^\d+(?:\/(?:tcp|udp))?$/.test(containerPort)||!allowedPorts.includes(Number(hostPort)))throw Error('Unconfigured local port mapping');result[i]='127.0.0.1:'+hostPort+':'+containerPort;}
 return result;
}
