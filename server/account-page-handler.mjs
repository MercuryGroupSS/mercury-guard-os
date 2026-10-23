import {readFileSync} from 'node:fs';import {privatePageHeaders as headers} from './private-page-headers.mjs';
const files=new Map([
 ['/account/',['account-page/index.html','text/html; charset=utf-8']],
 ['/account/portal.mjs',['account-page/portal.mjs','text/javascript; charset=utf-8']],
 ['/account/model.mjs',['account-page/model.mjs','text/javascript; charset=utf-8']],
 ['/account/portal.css',['account-page/portal.css','text/css; charset=utf-8']],
 ['/account/base.css',['admin-console/console.css','text/css; charset=utf-8']]
].map(([path,[file,type]])=>[path,{body:readFileSync(new URL(file,import.meta.url)),type}]));
export function accountPageResponse(request){
 const url=new URL(request.url);if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{...headers,allow:'GET, HEAD'}});if(url.search)return new Response(null,{status:404,headers});
 if(url.pathname==='/account')return new Response(null,{status:302,headers:{...headers,location:'/account/'}});const file=files.get(url.pathname);if(!file)return new Response(null,{status:404,headers});
 return new Response(request.method==='HEAD'?null:file.body,{headers:{...headers,'content-type':file.type}});
}
