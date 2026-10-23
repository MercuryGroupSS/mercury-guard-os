import {test} from 'node:test';
import assert from 'node:assert/strict';
import {patrolRoute,permitsCheckpoint} from './patrol-route.mjs';
test('route validation preserves independent checkpoint choices and rejects ambiguity',()=>{
 const route=patrolRoute({routeId:'route',revision:1,checkpoints:[{id:'a',label:'Entrance'},{id:'b',label:'Perimeter'}]});
 assert.equal(permitsCheckpoint(route,{route_id:'route',route_revision:1,checkpoint_id:'b'}),true);
 assert.equal(permitsCheckpoint(route,{route_id:'route',route_revision:2,checkpoint_id:'b'}),false);
 assert.equal(permitsCheckpoint(route,{route_id:'route',route_revision:1,checkpoint_id:'c'}),false);
 assert.throws(()=>patrolRoute({...route,checkpoints:[route.checkpoints[0],route.checkpoints[0]]}));
});
