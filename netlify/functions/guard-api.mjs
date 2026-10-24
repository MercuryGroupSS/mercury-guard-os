import {readNetlifyEnvironment} from '../../server/netlify-config.mjs';
import {openNetlifyRuntime} from '../../server/netlify-runtime.mjs';
import {createNetlifyIngress} from '../../server/netlify-ingress.mjs';

// Node Functions use process.env; Netlify.env is the separate Edge runtime API.
const ingress=createNetlifyIngress({loadConfiguration:()=>readNetlifyEnvironment({get:name=>process.env[name]}),openRuntime:openNetlifyRuntime});
export default (request,context)=>ingress.api(request,context);
export const config={path:['/v1/*','/v2/*','/account','/account/*','/admin','/admin/*']};
