import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reconcileOpsVendors} from './ops-vendor-reconciliation.mjs';
const binding={vendorId:'internal-vendor',opsVendorId:'MG001',kind:'company',revision:1,active:true};
test('explicit vendor binding excludes billing PII and does not infer individual guards',()=>{
 const result=reconcileOpsVendors([{vendor_id:'MG001',is_agency:false,name:'Example',email:'private@example.test',hst_number:'private'}],[binding]);
 assert.deepEqual(result,[{vendorId:'internal-vendor',opsVendorId:'MG001',kind:'company',revision:1,status:'source_link_resolved'}]);
 assert.equal(reconcileOpsVendors([{vendor_id:'MG001',is_agency:true}],[{...binding,kind:'individual'}])[0].status,'vendor_kind_review_required');
});
test('rename history never automatically retargets a binding, including reused vendor codes',()=>{
 const renamed={vendor_id:'MG002',prev_ids:['MG001']};
 assert.equal(reconcileOpsVendors([renamed],[binding])[0].status,'rename_review_required');
 assert.equal(reconcileOpsVendors([renamed,{vendor_id:'MG001'}],[binding])[0].status,'ambiguous_source_identity');
 assert.equal(reconcileOpsVendors([renamed,{vendor_id:'MG003',prev_ids:['MG001']}],[binding])[0].status,'ambiguous_source_identity');
 assert.equal(reconcileOpsVendors([renamed],[{...binding,opsVendorId:'MG002',revision:2}])[0].status,'source_link_resolved');
});
test('missing and disabled links remain unresolved and duplicate bindings are refused',()=>{
 assert.equal(reconcileOpsVendors([],[binding])[0].status,'source_missing');
 assert.equal(reconcileOpsVendors([],[{...binding,active:false}])[0].status,'binding_disabled');
 assert.throws(()=>reconcileOpsVendors([{vendor_id:'MG001'},{vendor_id:'MG001'}],[binding]));
 assert.throws(()=>reconcileOpsVendors([],[binding,{...binding,vendorId:'other'}]));
 assert.throws(()=>reconcileOpsVendors([],[binding,{...binding,opsVendorId:'other'}]));
 assert.throws(()=>reconcileOpsVendors([{vendor_id:'MG001',prev_ids:'MG002'}],[binding]));
});
