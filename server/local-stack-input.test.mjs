import {test} from 'node:test';import assert from 'node:assert/strict';import {configuredLocalPorts,parseLocalStatus,verifyLocalPublishedPorts} from './local-stack-input.mjs';
test('local runtime config extraction tolerates CLI notices while rejecting another project origin',()=>{
 const config={API_URL:'http://127.0.0.1:55321',DB_URL:'postgres://postgres:synthetic@127.0.0.1:55322/postgres',SERVICE_ROLE_KEY:'synthetic',PUBLISHABLE_KEY:'synthetic'};assert.deepEqual(parseLocalStatus('CLI notice\n'+JSON.stringify(config,null,2)+'\n'),config);
 for(const change of [{API_URL:'https://other.example.test'},{DB_URL:'postgres://127.0.0.1:5432/other'},{PUBLISHABLE_KEY:''}])assert.throws(()=>parseLocalStatus(JSON.stringify({...config,...change})));
 const text='project_id = "mercury-guard-os-local"\n[api]\nport = 55321\n[db]\nport = 55322\n[studio]\nport = 55323\n[local_smtp]\nport = 55324\n[edge_runtime]\ninspector_port = 8083\n';assert.deepEqual(configuredLocalPorts(text),[55321,55322,55323,55324,8083]);assert.throws(()=>configuredLocalPorts(text.replace('mercury-guard-os-local','another-project')));
});
test('only exact Guard project containers with effective loopback-only published ports are accepted',()=>{
 const containers=[{Name:'/supabase_kong_mercury-guard-os-local',NetworkSettings:{Ports:Object.fromEntries([55321,55322,55323,55324].map(port=>[port+'/tcp',[{HostIp:'127.0.0.1',HostPort:String(port)}]]))}}];assert.equal(verifyLocalPublishedPorts(containers).length,4);
 const changed=structuredClone(containers);changed[0].NetworkSettings.Ports['55321/tcp'][0].HostIp='0.0.0.0';assert.throws(()=>verifyLocalPublishedPorts(changed));changed[0].Name='/supabase_db_another-project';assert.throws(()=>verifyLocalPublishedPorts(changed),/Unrelated/);assert.throws(()=>verifyLocalPublishedPorts([]));
});
