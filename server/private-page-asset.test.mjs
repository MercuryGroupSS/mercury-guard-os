import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
import {privatePageAssetUrl,readPrivatePageAsset} from './private-page-asset.mjs';
import {accountPageResponse} from './account-page-handler.mjs';
import {adminConsoleResponse} from './admin-console-handler.mjs';

test('source page assets are byte-exact and retain private page headers/routes',async()=>{
 for(const [name,path,handler]of [['account-page/index.html','/account/',accountPageResponse],['admin-console/index.html','/admin/',adminConsoleResponse],['admin-console/model.mjs','/admin/model.mjs',adminConsoleResponse]]){
  const original=readFileSync(new URL(name,import.meta.url));assert.deepEqual(readPrivatePageAsset(name),original);
  const response=handler(new Request('https://guard.example.invalid'+path));assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),original);assert.equal(response.headers.get('cache-control'),'no-store');assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const head=handler(new Request('https://guard.example.invalid'+path,{method:'HEAD'}));assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);assert.equal(handler(new Request('https://guard.example.invalid'+path+'?file=private')).status,404);
 }
});
test('both actual zisi function entry layouts resolve included assets from server without cwd or environment lookup',()=>{
 const root=mkdtempSync(join(tmpdir(),'mercury-private-assets-'));
 try{
  mkdirSync(join(root,'netlify','functions'),{recursive:true});mkdirSync(join(root,'server','account-page'),{recursive:true});mkdirSync(join(root,'server','admin-console'),{recursive:true});
  writeFileSync(join(root,'server','account-page','index.html'),'synthetic-account');writeFileSync(join(root,'server','admin-console','index.html'),'synthetic-admin');
  for(const entry of ['guard-api.mjs','guard-sweep.mjs']){
   const moduleUrl=pathToFileURL(join(root,'netlify','functions',entry));writeFileSync(moduleUrl,'// packaged entry');
   assert.equal(readFileSync(privatePageAssetUrl('account-page/index.html',moduleUrl),'utf8'),'synthetic-account');assert.equal(readFileSync(privatePageAssetUrl('admin-console/index.html',moduleUrl),'utf8'),'synthetic-admin');
   assert.equal(privatePageAssetUrl('account-page/index.html',moduleUrl).href,pathToFileURL(join(root,'server','account-page','index.html')).href);
  }
  const unknown=pathToFileURL(join(root,'netlify','functions','other.mjs'));
  assert.throws(()=>readFileSync(privatePageAssetUrl('account-page/index.html',unknown)),{code:'ENOENT'});
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('asset names cannot select credentials, directories, traversal, encoded paths or remote locations',()=>{
 for(const name of ['../supabase-start.log','../../server/configured-service-config.mjs','account-page/','account-page/%2e%2e/private','admin-console/console.mjs?secret','/etc/passwd','https://other.invalid/page',null,{}])assert.throws(()=>privatePageAssetUrl(name),/asset unavailable/);
 for(const moduleUrl of ['https://other.invalid/netlify/functions/guard-api.mjs','file:///tmp/guard.mjs?other','file:///tmp/guard.mjs#other'])assert.throws(()=>privatePageAssetUrl('account-page/index.html',moduleUrl),/asset unavailable/);
});
