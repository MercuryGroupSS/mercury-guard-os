export const localProject='mercury-guard-os-local';
export const localNetwork='mercury-guard-os-local-loopback';
export function configuredLocalPorts(text){
 if(!/^project_id\s*=\s*"mercury-guard-os-local"\s*$/m.test(text))throw Error('Mercury Guard local project required');
 const ports=[...new Set([...text.matchAll(/^\s*[a-z_]*port\s*=\s*(\d+)\s*(?:#.*)?$/gm)].map(m=>Number(m[1])))];
 if(ports.some(p=>p<1||p>65535)||![55321,55322,55323,55324].every(p=>ports.includes(p)))throw Error('Expected configured local ports required');return ports;
}
export function parseLocalStatus(output){
 let value;try{value=JSON.parse(output.slice(output.indexOf('{'),output.lastIndexOf('}')+1));}catch{throw Error('Structured local status unavailable');}
 let db;try{db=new URL(value.DB_URL);}catch{throw Error('Local database status unavailable');}
 if(value.API_URL!=='http://127.0.0.1:55321'||!['postgres:','postgresql:'].includes(db.protocol)||db.hostname!=='127.0.0.1'||db.port!=='55322'||db.search||db.hash||typeof value.SERVICE_ROLE_KEY!=='string'||!value.SERVICE_ROLE_KEY||typeof value.PUBLISHABLE_KEY!=='string'||!value.PUBLISHABLE_KEY)throw Error('Isolated runtime status required');
 return value;
}
export function verifyLocalPublishedPorts(containers,allowedPorts=[55320,55321,55322,55323,55324,55327,55329]){
 if(!Array.isArray(containers)||containers.length<1||containers.length>20)throw Error('Bounded local container inspection required');const ports=[];
 for(const container of containers){const name=container.Name?.replace(/^\//,'');if(typeof name!=='string'||!name.startsWith('supabase_')||!name.endsWith('_'+localProject))throw Error('Unrelated container in local inspection');
  for(const bindings of Object.values(container.NetworkSettings?.Ports??{})){if(!bindings)continue;for(const binding of bindings){if(!['127.0.0.1','::1'].includes(binding.HostIp)||!/^\d+$/.test(binding.HostPort)||!allowedPorts.includes(Number(binding.HostPort)))throw Error(`Unapproved local binding: ${name} ${binding.HostIp}:${binding.HostPort}`);ports.push({container:name,host:binding.HostIp,port:Number(binding.HostPort)});}}
 }
 if(![55321,55322,55323,55324].every(port=>ports.some(p=>p.port===port)))throw Error('Expected local Guard services are missing');return ports;
}
