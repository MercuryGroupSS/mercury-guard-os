import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openLocalAssignmentStore} from './local-assignment-factory.mjs';
import {PostgresGuardDirectory} from './postgres-guard-directory.mjs';
test('assignment store fails closed for invalid mode, mismatched identity or missing schema',async()=>{
 await assert.rejects(openLocalAssignmentStore({mode:'postgress'}));
 await assert.rejects(openLocalAssignmentStore({mode:'postgres',directory:{client:{connect(){}}}}));
 const directory=new PostgresGuardDirectory({client:{connect(){},query:async()=>({rows:[{role:'service_role',ready:false}]})}});
 await assert.rejects(openLocalAssignmentStore({mode:'postgres',directory}),/no fallback/);
 const local=await openLocalAssignmentStore({mode:'sqlite',sqlitePath:':memory:'});
 try{assert.equal(local.devices.device('missing'),null);assert.equal(typeof local.sync.apply,'function');}finally{await local.close();}
});
