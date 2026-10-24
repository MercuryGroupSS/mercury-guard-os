import {readPrivatePageAsset} from './private-page-asset.mjs';
import {privatePageHeaders as headers} from './private-page-headers.mjs';
const files=new Map([
 ['/admin/',['admin-console/index.html','text/html; charset=utf-8']],
 ['/admin/console.css',['admin-console/console.css','text/css; charset=utf-8']],
 ['/admin/console.mjs',['admin-console/console.mjs','text/javascript; charset=utf-8']],
 ['/admin/model.mjs',['admin-console/model.mjs','text/javascript; charset=utf-8']]
].map(([path,[file,type]])=>[path,{body:readPrivatePageAsset(file),type}]));
// Only these public application assets are served. No directory or credential files.
export function adminConsoleResponse(request){
 const url=new URL(request.url);
 if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{...headers,allow:'GET, HEAD'}});
 if(url.search)return new Response(null,{status:404,headers});
 if(url.pathname==='/admin')return new Response(null,{status:302,headers:{...headers,location:'/admin/'}});
 const file=files.get(url.pathname);if(!file)return new Response(null,{status:404,headers});
 return new Response(request.method==='HEAD'?null:file.body,{headers:{...headers,'content-type':file.type}});
}
