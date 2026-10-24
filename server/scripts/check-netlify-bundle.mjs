import assert from 'node:assert/strict';
import {zipFunctions} from '@netlify/zip-it-and-ship-it';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

const root=fileURLToPath(new URL('../../',import.meta.url));
const directory=mkdtempSync(join(tmpdir(),'mercury-netlify-bundle-'));
const assets=['account-page/index.html','account-page/portal.mjs','account-page/model.mjs','account-page/portal.css','admin-console/index.html','admin-console/console.css','admin-console/console.mjs','admin-console/model.mjs'];
try{
 const bundles=await zipFunctions(resolve(root,'netlify/functions'),directory,{archiveFormat:'none',basePath:root,config:{'*':{nodeBundler:'esbuild',nodeVersion:'24.x',includedFiles:['server/admin-console/**','server/account-page/**']}}});
 assert.deepEqual(bundles.map(b=>b.name).sort(),['guard-api','guard-sweep']);
 for(const bundle of bundles){
  assert.equal(bundle.runtimeAPIVersion,2);assert.equal(bundle.runtimeVersion,'nodejs24.x');
  for(const asset of assets)assert.deepEqual(readFileSync(join(bundle.path,'server',asset)),readFileSync(join(root,'server',asset)),asset);
  // Resolve pg from the archive, outside the checkout. This catches missing
  // package dependencies as well as import.meta-relative HTML/CSS/JS failures.
  assert.equal(JSON.parse(readFileSync(join(bundle.path,'node_modules/pg/package.json'),'utf8')).version,'8.23.1');
  const entry=pathToFileURL(join(bundle.path,'netlify/functions',bundle.name+'.mjs')).href;
  const code=`import assert from 'node:assert/strict';
globalThis.fetch=async()=>{throw Error('Network forbidden in bundle loading proof');};
const m=await import(${JSON.stringify(entry)});
assert.equal(typeof m.default,'function');
const request=new Request('https://unconfigured.example.invalid/v1/me');
const context={site:{id:'unconfigured'},deploy:{context:'production'}};
if(${JSON.stringify(bundle.name)}==='guard-api'){
 const response=await m.default(request,context);assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'service_unavailable'});
}else await assert.rejects(m.default(request,context),{message:'Guard scheduled pass unavailable'});
console.log('isolated_bundle_loaded_and_unconfigured_denied');`;
  const env={...process.env};for(const name of Object.keys(env))if(name.startsWith('MERCURY_GUARD_')||name==='NODE_PATH'||name==='NODE_OPTIONS')delete env[name];
  const output=execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:bundle.path,env,encoding:'utf8',timeout:15000});
  assert.equal(output.trim(),'isolated_bundle_loaded_and_unconfigured_denied');
 }
 console.log(JSON.stringify({status:'passed',packager:'@netlify/zip-it-and-ship-it@16.5.1',functions:2,runtime:'nodejs24.x',api_version:2,public_assets_per_function:assets.length,isolated_bundle_dependency_and_asset_load:true,unconfigured_invocation_denied:true,network_calls:0,deployment:false}));
}finally{rmSync(directory,{recursive:true,force:true});}
