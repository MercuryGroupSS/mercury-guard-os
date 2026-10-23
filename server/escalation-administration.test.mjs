import test from 'node:test';
import assert from 'node:assert/strict';
import {withEscalationAdministration} from './escalation-administration.mjs';
test('escalation facade preserves original role checks and routes exact reviewed envelopes',async()=>{
 const calls=[],session={subject:'individual'},admin={pool:{},member(s){assert.equal(this,admin);assert.equal(s,session);return true;},catalog(...args){calls.push(['catalog',...args]);return 'base-page';},apply(...args){calls.push(['apply',...args]);return 'base-applied';},settle(...args){calls.push(['settle',...args]);return 'base-settled';}},escalations={catalog(...args){calls.push(['escalations',...args]);return 'alerts-page';},acknowledge(...args){calls.push(['ack',...args]);return 'ack-receipt';},settle(...args){calls.push(['ack-settle',...args]);return 'ack-tombstone';}},api=withEscalationAdministration(admin,escalations);
 assert.equal(await api.member(session),true);assert.equal(api.pool,admin.pool);
 assert.equal(await api.catalog(session,'vendors','next'),'base-page');assert.equal(await api.catalog(session,'escalations','cursor'),'alerts-page');
 const request={request_id:'immutable-id',action:'escalation.acknowledge',reason:'Guard-visible operator response',payload:{escalation_id:'original-id'}},copy=structuredClone(request);
 assert.equal(await api.apply(session,request),'ack-receipt');assert.equal(await api.settle(session,request),'ack-tombstone');assert.deepEqual(request,copy);
 assert.deepEqual(calls.slice(-2),[['ack',session,{request_id:request.request_id,escalation_id:'original-id',reason:request.reason}],['ack-settle',session,{request_id:request.request_id,escalation_id:'original-id',reason:request.reason}]]);
 const unrelated={action:'vendor.status',payload:{}};assert.equal(await api.apply(session,unrelated),'base-applied');assert.equal(await api.settle(session,unrelated),'base-settled');
});
test('escalation facade rejects unexpected authority or review fields before forwarding',()=>{
 let touched=0;const api=withEscalationAdministration({}, {acknowledge(){touched++;},settle(){touched++;}}),valid={request_id:'id',action:'escalation.acknowledge',reason:'Acknowledged',payload:{escalation_id:'original'}};
 for(const request of [{...valid,actor:'attacker'},{...valid,payload:{...valid.payload,guard_id:'other'}},{...valid,payload:null},{...valid,payload:[]}]){assert.throws(()=>api.apply({},request));assert.throws(()=>api.settle({},request));}
 assert.equal(touched,0);
});
