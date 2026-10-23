import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openLocalGuardDirectory} from './local-directory-factory.mjs';
const config={API_URL:'http://127.0.0.1:55321',DB_URL:'postgresql://postgres:synthetic@127.0.0.1:55322/postgres'};
test('directory mode rejects typos, remote origins and connection overrides without fallback',async()=>{
 await assert.rejects(()=>openLocalGuardDirectory({config,mode:'postgress',sqlitePath:':memory:'}));
 await assert.rejects(()=>openLocalGuardDirectory({config:{...config,API_URL:'https://remote.test'},mode:'sqlite',sqlitePath:':memory:'}));
 for(const DB_URL of ['postgresql://postgres:synthetic@remote.test:55322/postgres',config.DB_URL+'?options=bad',config.DB_URL+'#fragment'])await assert.rejects(()=>openLocalGuardDirectory({config:{...config,DB_URL},mode:'postgres'}));
 const directory=await openLocalGuardDirectory({config,mode:'sqlite',sqlitePath:':memory:'});assert.equal(directory.loginAccount('missing'),null);directory.close();
});
