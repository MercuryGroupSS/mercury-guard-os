import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {LocalDeviceAssignments} from './local-device-assignments.mjs';
import {createAssignmentHandler} from './assignment-handler.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const identity={subject:'user-1',guardId:'guard-1',vendorId:'MG001'};
const pair=()=>generateKeyPairSync('ec',{namedCurve:'prime256v1'});
function proof(k,c){const spki=k.publicKey.export({type:'spki',format:'der'}),thumb=createHash('sha256').update(spki).digest('hex');return {version:1,algorithm:'SHA256withECDSA',audience:c.audience,request_id:c.request_id,challenge:c.challenge,device_thumbprint:thumb,public_key_spki:spki.toString('base64url'),signature_der:sign('sha256',Buffer.from(`mercury-enrollment-proof-v1\n${c.audience}\n${c.request_id}\n${c.challenge}\n${thumb}`),k.privateKey).toString('base64url')};}
function setup(db,k){
 db.enroll({deviceId:'phone',mode:'site',siteId:'site-1',active:true,revoked:false,publicKeySpki:k.publicKey.export({type:'spki',format:'der'}).toString('base64url')});
 for(const [assignmentId,guardId,siteId] of [['a','guard-1','site-1'],['b','guard-2','site-1'],['c','guard-1','site-2']])db.assign({assignmentId,guardId,siteId,vendorId:'MG001',active:true,startsAt:100,endsAt:999999});
}
test('durable device proof returns only own site assignments and rejects replay after restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'mercury-device-')),path=join(dir,'db.sqlite');let db=new LocalDeviceAssignments(path);const k=pair();
 try{
  setup(db,k);const p=proof(k,db.challenge(identity,'phone',200));db.close();db=new LocalDeviceAssignments(path);
  assert.deepEqual(db.list(identity,p,201).assignments.map(a=>a.assignmentId),['a']);
  db.close();db=new LocalDeviceAssignments(path);assert.throws(()=>db.list(identity,p,202));
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('wrong key, subject, expiry, revocation and cancelled assignment deny access',()=>{
 const db=new LocalDeviceAssignments(':memory:'),k=pair();try{
  setup(db,k);let c=db.challenge(identity,'phone',200),p=proof(k,c);
  assert.throws(()=>db.list({...identity,subject:'user-2'},p,201));
  assert.throws(()=>db.list(identity,proof(pair(),c),201));
  assert.throws(()=>db.list(identity,p,60200));
  c=db.challenge(identity,'phone',60300);p=proof(k,c);db.cancel('a');assert.deepEqual(db.list(identity,p,60301).assignments,[]);
  c=db.challenge(identity,'phone',60400);db.revoke('phone');assert.throws(()=>db.list(identity,proof(k,c),60401));
  assert.throws(()=>db.challenge(identity,'phone',60402));
 }finally{db.close();}
});
test('assignment route enforces authentication, identity, payload limits and signed proof',async()=>{
 const db=new LocalDeviceAssignments(':memory:'),k=pair();setup(db,k);
 const directory={loadGuardsForSubject:()=>[{...identity,authSubject:identity.subject,active:true}],loadVendor:()=>({vendorId:'MG001',kind:'company',active:true})};
 const handler=createAssignmentHandler({directory,devices:db,now:()=>200,verifySession:async token=>token==='valid'?{subject:identity.subject,active:true,expiresAt:1000}:null});
 const send=(path,body,token='valid')=>handler(new Request('https://guard.test'+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)}));
 try{
  assert.equal((await send('/v1/device-challenge',{device_id:'phone'},'bad')).status,401);
  assert.equal((await send('/v1/device-challenge',{device_id:'phone',guard_id:'guard-2'})).status,400);
  assert.equal((await send('/v1/device-challenge',{device_id:'x'.repeat(5000)})).status,413);
  const response=await send('/v1/device-challenge',{device_id:'phone'});assert.equal(response.status,200);
  const p=proof(k,await response.json()),result=await send('/v1/assignments',p);assert.equal(result.status,200);
  assert.deepEqual((await result.json()).assignments.map(a=>a.assignmentId),['a']);assert.equal((await send('/v1/assignments',p)).status,400);
 }finally{db.close();}
});

test('ingestion authority must match active enrollment and current assignment',()=>{
 const db=new LocalDeviceAssignments(':memory:'),k=pair();try{
  setup(db,k);const d=db.device('phone'),a={thumbprint:d.thumbprint,publicKeySpki:d.publicKeySpki,assignmentId:'a',siteId:'site-1',guardId:'guard-1',revocationVersion:1};
  assert.equal(db.authorizes(identity,a,200),true);
  assert.equal(db.authorizes(identity,{...a,siteId:'other'},200),false);
  assert.equal(db.authorizes(identity,a,99),false);
  db.revoke('phone');assert.equal(db.authorizes(identity,a,201),false);
 }finally{db.close();}
});

test('dispatch route needs a fresh proof and rejects other assignments and invalid cursors',async()=>{
 const {DispatchFeed}=await import('./dispatch-feed.mjs');const dispatch=new DispatchFeed(':memory:'),db=new LocalDeviceAssignments(':memory:'),k=pair();setup(db,k);
 const directory={loadGuardsForSubject:()=>[{...identity,authSubject:identity.subject,active:true}],loadVendor:()=>({vendorId:'MG001',kind:'company',active:true})};
 const handler=createAssignmentHandler({directory,devices:db,dispatch,now:()=>2000,verifySession:async()=>({subject:identity.subject,active:true,expiresAt:1000})});
 const send=async(assignment,cursor)=>handler(new Request('https://guard.test/v1/dispatch',{method:'POST',headers:{authorization:'Bearer valid','content-type':'application/json'},body:JSON.stringify({assignment_id:assignment,cursor,proof:proof(k,db.challenge(identity,'phone',2000))})}));
 try{
  dispatch.publish({...identity,siteId:'site-1',assignmentId:'a'},{message_id:'m',version:1,state:'active',title:'Test',body:'Synthetic',issued_at:1000,due_at:null});
  assert.equal((await send('b',null)).status,400);assert.equal((await send('a','invalid')).status,409);
  const good=await send('a',null);assert.equal(good.status,200);assert.equal((await good.json()).changes.length,1);
  db.cancel('a');assert.equal((await send('a',null)).status,400);
 }finally{dispatch.close();db.close();}
});

test('shift route authenticates proofs and permits explicit scheduled end without reopening capture',async()=>{
 const {ShiftLifecycle}=await import('./shift-lifecycle.mjs');const shiftLifecycle=new ShiftLifecycle(':memory:'),db=new LocalDeviceAssignments(':memory:'),k=pair();setup(db,k);let now=200;
 const directory={loadGuardsForSubject:()=>[{...identity,authSubject:identity.subject,active:true}],loadVendor:()=>({vendorId:'MG001',kind:'company',active:true})};
 const handler=createAssignmentHandler({directory,devices:db,shiftLifecycle,now:()=>now,verifySession:async token=>token==='valid'?{subject:identity.subject,active:true,expiresAt:999999}:null});
 const body=(assignment,action,id=action)=>({assignment_id:assignment,transition:{action,request_id:id,reason:'',confirmed:true},proof:proof(k,db.challenge(identity,'phone',now))});
 const send=(b,token='valid')=>handler(new Request('https://guard.test/v1/shift-transition',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(b)}));
 try{
  assert.equal((await send(body('a','start'),'invalid')).status,401);
  assert.equal((await send(body('b','start'))).status,400);
  const startBody=body('a','start');const start=await send(startBody);assert.equal(start.status,200);const original=await start.json();
  assert.equal((await send(startBody)).status,400);
  now=999999;
  assert.deepEqual(await (await send(body('a','start'))).json(),original);
  const ordinary=db.list(identity,proof(k,db.challenge(identity,'phone',now)),now);assert.equal(ordinary.assignments.length,0);
  const ended=await send(body('a','end'));assert.equal(ended.status,200);assert.equal((await ended.json()).early_exit,false);
  db.cancel('a');assert.equal((await send(body('a','end'))).status,400);
 }finally{shiftLifecycle.close();db.close();}
});
