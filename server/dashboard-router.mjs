import {createHash} from 'node:crypto';
import {createDashboardTransport} from './dashboard-delivery.mjs';
import {strictJson} from './verify-batch.mjs';
export function createDashboardRouter({destinations,allowLocal=false,fetchImpl=fetch}){
 if(!Array.isArray(destinations)||destinations.length<1||destinations.length>25)throw Error('Explicit bounded destinations required');
 const routes=new Map();
 for(const route of destinations){
  if(!route||Object.keys(route).sort().join()!=='destination,endpoint,token'||typeof route.destination!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(route.destination)||routes.has(route.destination))throw Error('Unique exact destination configuration required');
  routes.set(route.destination,createDashboardTransport({endpoint:route.endpoint,token:route.token,allowLocal,fetchImpl}));
 }
 return async job=>{
  if(typeof job?.body!=='string'||Buffer.byteLength(job.body)>64000||createHash('sha256').update(job.body).digest('hex')!==job.hash)throw Error('Immutable outbound observation required');
  const value=strictJson(job.body),send=routes.get(value.destination);
  if(!send||value.delivery_id!==job.id||value.version!==1||value.source!=='mercury_one')throw Error('Observation destination not configured');
  return send(job);
 };
}
