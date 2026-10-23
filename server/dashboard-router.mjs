import {createHash} from 'node:crypto';
import {createDashboardTransport} from './dashboard-delivery.mjs';
import {strictJson} from './verify-batch.mjs';
import {createDashboardMediaTransport,validateDashboardMediaJob} from './dashboard-media.mjs';
export function createDashboardRouter({destinations,allowLocal=false,fetchImpl=fetch}){
 if(!Array.isArray(destinations)||destinations.length<1||destinations.length>25)throw Error('Explicit bounded destinations required');
 const routes=new Map();
 for(const route of destinations){
  if(!route||!['destination,endpoint,token','destination,endpoint,mediaEndpoint,token'].includes(Object.keys(route).sort().join())||typeof route.destination!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(route.destination)||routes.has(route.destination))throw Error('Unique exact destination configuration required');
  if(Object.hasOwn(route,'mediaEndpoint'))createDashboardMediaTransport({endpoint:route.mediaEndpoint,token:route.token,allowLocal,fetchImpl});
  routes.set(route.destination,createDashboardTransport({endpoint:route.endpoint,token:route.token,allowLocal,fetchImpl}));
 }
 return async job=>{
  if(typeof job?.body!=='string'||Buffer.byteLength(job.body)>64000||createHash('sha256').update(job.body).digest('hex')!==job.hash)throw Error('Immutable outbound observation required');
  const value=strictJson(job.body),send=routes.get(value.destination);
  if(!send||value.delivery_id!==job.id||value.version!==1||value.source!=='mercury_one')throw Error('Observation destination not configured');
  return send(job);
 };
}
export function createDashboardMediaRouter(options){
 createDashboardRouter(options);const routes=new Map(options.destinations.filter(r=>Object.hasOwn(r,'mediaEndpoint')).map(r=>[r.destination,createDashboardMediaTransport({endpoint:r.mediaEndpoint,token:r.token,allowLocal:options.allowLocal,fetchImpl:options.fetchImpl})]));if(routes.size===0)return null;
 return async job=>{const meta=validateDashboardMediaJob(job),send=routes.get(meta.destination);if(!send)throw Error('Media destination not configured');return send(job);};
}
