import {test} from 'node:test';
import assert from 'node:assert/strict';
import {patrolRoute,permitsCheckpoint,patrolRoundKey} from './patrol-route.mjs';
test('route validation preserves independent checkpoint choices and rejects ambiguity',()=>{
 const route=patrolRoute({routeId:'route',revision:1,checkpoints:[{id:'a',label:'Entrance'},{id:'b',label:'Perimeter'}]});
 assert.equal(permitsCheckpoint(route,{route_id:'route',route_revision:1,checkpoint_id:'b'}),true);
 assert.equal(permitsCheckpoint(route,{route_id:'route',route_revision:2,checkpoint_id:'b'}),false);
 assert.equal(permitsCheckpoint(route,{route_id:'route',route_revision:1,checkpoint_id:'c'}),false);
 assert.throws(()=>patrolRoute({...route,checkpoints:[route.checkpoints[0],route.checkpoints[0]]}));
});
test('declared patrol rounds are bounded, independently selectable and require an explicit trusted round ID',()=>{
 const input={routeId:'route',revision:3,checkpoints:[{id:'entrance',label:'Entrance'}],rounds:[{id:'opening',label:'Opening patrol'},{id:'closing',label:'Closing patrol'}]},route=patrolRoute(input),checkpoint={route_id:'route',route_revision:3,checkpoint_id:'entrance'};
 assert.equal(permitsCheckpoint(route,{...checkpoint,round_id:'closing'}),true);assert.equal(permitsCheckpoint(route,{...checkpoint,round_id:'opening'}),true);assert.equal(permitsCheckpoint(route,checkpoint),false);assert.equal(permitsCheckpoint(route,{...checkpoint,round_id:'invented'}),false);assert.equal(permitsCheckpoint(route,{...checkpoint,round_id:''}),false);assert.equal(permitsCheckpoint(route,{...checkpoint,round_id:'opening',route_revision:4}),false);
 input.rounds[0].id='changed';assert.equal(route.rounds[0].id,'opening');assert.equal(patrolRoundKey({...checkpoint,round_id:'opening'}),'opening');assert.equal(patrolRoundKey(checkpoint),'');
 for(const rounds of [[],null,[{id:'same',label:'A'},{id:'same',label:'B'}],[{id:'a',label:'Same'},{id:'b',label:' same '}],[{id:'a',label:' '}],Array.from({length:101},(_,index)=>({id:'round-'+index,label:'Round '+index}))])assert.throws(()=>patrolRoute({...input,rounds}));
 for(const round_id of ['',null,1,'invalid/id'])assert.throws(()=>patrolRoundKey({...checkpoint,round_id}));
 const {rounds,...old}=input,legacy=patrolRoute(old);assert.equal(permitsCheckpoint(legacy,checkpoint),true);assert.equal(permitsCheckpoint(legacy,{...checkpoint,round_id:'opening'}),false);
});
