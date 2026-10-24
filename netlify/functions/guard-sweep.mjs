import {readNetlifyEnvironment} from '../../server/netlify-config.mjs';
import {openNetlifyRuntime} from '../../server/netlify-runtime.mjs';
import {createNetlifyIngress} from '../../server/netlify-ingress.mjs';

const ingress=createNetlifyIngress({loadConfiguration:()=>readNetlifyEnvironment({get:name=>process.env[name]}),openRuntime:openNetlifyRuntime});
export default async (request,context)=>{
 const result=await ingress.scheduled(request,context);
 if(!result.ok)throw Error('Guard scheduled pass unavailable');
 return result;
};
// UTC, once per minute. Delayed platform invocation is not a deadline guarantee.
export const config={schedule:'* * * * *'};
