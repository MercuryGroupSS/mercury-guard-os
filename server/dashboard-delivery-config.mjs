import {openSync,closeSync,fstatSync,readFileSync,constants} from 'node:fs';
import {strictJson} from './verify-batch.mjs';import {createDashboardRouter,createDashboardMediaRouter} from './dashboard-router.mjs';
export function openDashboardDelivery({mode='off',path,fetchImpl=fetch}={}){
 if(mode==='off')return null;if(mode!=='on'||typeof path!=='string'||!path)throw Error('Explicit on/off delivery mode and private configuration file required');
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);let config;
 try{const stat=fstatSync(fd);if(!stat.isFile()||(stat.mode&0o077)!==0||stat.size<1||stat.size>64000)throw Error('Private bounded destination file required');config=strictJson(readFileSync(fd,'utf8'));}finally{closeSync(fd);}
 if(!config||Object.keys(config).sort().join()!=='destinations,version'||config.version!==1)throw Error('Versioned destination configuration required');
 const options={destinations:config.destinations,fetchImpl};return {observations:createDashboardRouter(options),media:createDashboardMediaRouter(options)};
}
