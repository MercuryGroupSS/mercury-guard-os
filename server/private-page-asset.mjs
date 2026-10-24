import {readFileSync} from 'node:fs';

const assets=new Set(['account-page/index.html','account-page/portal.mjs','account-page/model.mjs','account-page/portal.css','admin-console/index.html','admin-console/console.css','admin-console/console.mjs','admin-console/model.mjs']);
// zisi/esbuild retains the function entry at netlify/functions/guard-{api,sweep}.mjs
// and included_files at server/. Source modules keep their original server/ base.
// Only these two verified package layouts are recognized; no cwd/env probing or
// arbitrary filename fallback can expose server configuration or private inputs.
export function privatePageAssetUrl(asset,moduleUrl=import.meta.url){
 if(!assets.has(asset))throw Error('Public page asset unavailable');
 const entry=new URL(moduleUrl);if(entry.protocol!=='file:'||entry.search||entry.hash)throw Error('Public page asset unavailable');
 const bundled=/\/netlify\/functions\/guard-(?:api|sweep)\.mjs$/.test(entry.pathname);
 return new URL((bundled?'../../server/':'')+asset,entry);
}
export function readPrivatePageAsset(asset){return readFileSync(privatePageAssetUrl(asset));}
