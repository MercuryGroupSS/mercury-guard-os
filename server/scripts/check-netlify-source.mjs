import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {config as api} from '../../netlify/functions/guard-api.mjs';
import {config as sweep} from '../../netlify/functions/guard-sweep.mjs';

const fail=()=>{throw Error('Netlify source boundary check failed');};
const paths=['/v1/*','/v2/*','/account','/account/*','/admin','/admin/*'];
if(Object.keys(api).join()!=='path'||JSON.stringify(api.path)!==JSON.stringify(paths))fail();
if(Object.keys(sweep).join()!=='schedule'||sweep.schedule!=='* * * * *')fail();
const directory=fileURLToPath(new URL('../../netlify/public/',import.meta.url));
const entries=readdirSync(directory);
if(entries.length!==1||entries[0]!=='index.html'||!lstatSync(directory+'/index.html').isFile()||lstatSync(directory+'/index.html').isSymbolicLink())fail();
const body=readFileSync(directory+'/index.html','utf8');
if(/BEGIN .*PRIVATE KEY|sb_secret_|service_role|postgres(?:ql)?:\/\//.test(body))fail();
console.log('Netlify source verified: explicit API paths, internal-only scheduled function, bounded public directory. No deployment or credentials loaded.');
