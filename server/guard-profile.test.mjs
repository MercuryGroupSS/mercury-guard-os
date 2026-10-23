import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LocalGuardDirectory} from './local-guard-directory.mjs';
import {createGuardProfileHandler} from './guard-profile-handler.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('persistent individual roster, uniqueness and immediate access removal',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mercury-roster-'));let db=new LocalGuardDirectory(join(dir,'roster.sqlite'));
 try {
  db.addVendor({vendorId:'MG001',kind:'company',active:true});
  db.addGuard({guardId:'g1',authSubject:'u1',vendorId:'MG001',active:true});
  db.addGuard({guardId:'g2',authSubject:'u2',vendorId:'MG001',active:true});
  assert.throws(()=>db.addGuard({guardId:'g3',authSubject:'u1',vendorId:'MG001',active:true}));
  assert.throws(()=>db.addGuard({guardId:'g4',authSubject:'u4',vendorId:'missing',active:true}));
  db.close();db=new LocalGuardDirectory(join(dir,'roster.sqlite'));
  const handler=createGuardProfileHandler({directory:db,verifySession:async token=>token==='valid'?{subject:'u1',active:true,expiresAt:200}:null,now:()=>100});
  const get=(token='valid',method='GET')=>handler(new Request('https://guard.test/v1/me',{method,headers:{authorization:'Bearer '+token}}));
  assert.deepEqual(await (await get()).json(),{guard_id:'g1',vendor_id:'MG001',auth_subject:'u1'});
  assert.equal((await get('wrong')).status,401);assert.equal((await get('valid','POST')).status,405);
  db.setGuardActive('g1',false);assert.equal((await get()).status,403);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('profile subject comes only from the verified individual and matching roster',async()=>{
 const directory={loadGuardsForSubject:async subject=>[{guardId:'same-guard',vendorId:'company',authSubject:subject,active:true}],loadVendor:async()=>({vendorId:'company',kind:'company',active:true})};
 const handler=createGuardProfileHandler({directory,verifySession:async token=>({subject:token==='new'?'second-person':'first-person',active:true,expiresAt:200,user_metadata:{auth_subject:'attacker'}}),now:()=>100});
 for(const [token,subject]of [['old','first-person'],['new','second-person']]){const r=await handler(new Request('https://guard.test/v1/me?auth_subject=attacker',{headers:{authorization:'Bearer '+token}}));assert.equal(r.status,200);assert.deepEqual(await r.json(),{guard_id:'same-guard',vendor_id:'company',auth_subject:subject});}
});
test('expired sessions and unavailable directory fail closed',async()=>{
 const directory={loadGuardsForSubject(){throw Error('offline');},loadVendor(){throw Error('offline');}};
 for(const [expiresAt,status] of [[99,401],[200,503]]){
  const h=createGuardProfileHandler({directory,verifySession:async()=>({subject:'u',active:true,expiresAt}),now:()=>100});
  assert.equal((await h(new Request('https://guard.test/v1/me',{headers:{authorization:'Bearer token'}}))).status,status);
 }
});
