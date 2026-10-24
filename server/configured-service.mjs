import {createServer} from 'node:https';
import {Readable} from 'node:stream';
import {validateConfiguredServiceConfig} from './configured-service-config.mjs';
import {createGuardApplication} from './guard-application.mjs';

const reply=(status,error)=>new Response(JSON.stringify({error}),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
// Direct TLS keeps its complete original validation before entering the common HTTP application.
export function createConfiguredApplication({config,...components}){
 const c=validateConfiguredServiceConfig(config);
 return createGuardApplication({...components,configuration:{deployment_id:c.deployment_id,public_origin:c.public_origin,auth:c.auth,issuer:{issuer:c.issuer.issuer,audience:c.issuer.audience,key_id:c.issuer.key_id},allow_local_auth:c.mode==='isolated_local_pilot',receiver_enabled:c.dashboard_receiver!=null,mail_recipients:null}});
}
export function createConfiguredService({config,materials,application,preflight=async()=>{}}){
 const c=validateConfiguredServiceConfig(config),active=new Set();let stopping=false,startPromise=null;
 if(typeof application?.handle!=='function'||typeof application?.assertConfiguration!=='function'||typeof preflight!=='function')throw Error('Configured application required');
 const server=createServer({cert:materials.certificate,key:materials.tlsKey,minVersion:'TLSv1.2'},(req,res)=>{
  const operation=(async()=>{
   let response;
   try{
    const hostCount=req.rawHeaders.filter((_,i)=>i%2===0&&req.rawHeaders[i].toLowerCase()==='host').length;
    if(stopping)response=reply(503,'service_stopping');
    else if(hostCount!==1||req.headers.host!==new URL(c.public_origin).host||!req.url.startsWith('/')||req.url.startsWith('//')||req.url.includes('#')||['forwarded','x-forwarded-host','x-forwarded-proto','x-original-url','x-rewrite-url'].some(h=>req.headers[h]!==undefined))response=reply(421,'origin_unavailable');
    else response=await application.handle(new Request(new URL(req.url,c.public_origin),{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Readable.toWeb(req),duplex:'half'})}));
   }catch{response=reply(500,'request_failed');}
   if(!res.destroyed){res.writeHead(response.status,{...Object.fromEntries(response.headers),'strict-transport-security':'max-age=31536000','referrer-policy':'no-referrer'});res.end(Buffer.from(await response.arrayBuffer()));}
  })().catch(()=>{if(!res.destroyed){res.writeHead(500,{'cache-control':'no-store'});res.end();}});
  active.add(operation);void operation.finally(()=>active.delete(operation));
 });
 server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
 return {async check(){await preflight();await application.assertConfiguration();return {status:'configuration_verified',origin:c.public_origin,deployment_id:c.deployment_id};},
  start(){if(stopping)return Promise.reject(Error('Configured service stopped'));if(startPromise)return startPromise;startPromise=(async()=>{await this.check();if(stopping)throw Error('Configured service stopped');await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(c.listen.port,c.listen.host,()=>{server.removeListener('error',reject);resolve();});});if(stopping)throw Error('Configured service stopped');return c.public_origin;})();return startPromise;},
  async stop(){stopping=true;await startPromise?.catch(()=>{});const closed=server.listening?new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve())):Promise.resolve();const timer=setTimeout(()=>server.closeAllConnections(),15000);timer.unref();try{await closed;await Promise.allSettled([...active]);}finally{clearTimeout(timer);}}
 };
}
