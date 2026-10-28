import {fixtureAuthSession} from './fixture-auth-session.mjs';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {Pool} from 'pg';
import {PostgresDeviceAssignments} from '../postgres-device-assignments.mjs';
import {parseEnrollmentKey} from '../enrollment-key.mjs';

// Called only against the disposable database created by the migration verifier.
export async function verifyPostgresDevices(connectionString,admin){
 const pool=new Pool({connectionString,max:4,options:'-c role=service_role'});
 try{
  const subject=randomUUID(),otherSubject=randomUUID(),now=Date.now();
  await admin.query('INSERT INTO auth.users(id) VALUES($1),($2)',[subject,otherSubject]);
  await admin.query("INSERT INTO mercury_guard.vendors VALUES('device-vendor','company',true,now())");
  await admin.query("INSERT INTO mercury_guard.guards(guard_id,auth_subject,vendor_id,active) VALUES('device-guard',$1,'device-vendor',true),('device-other',$2,'device-vendor',true)",[subject,otherSubject]);
  await admin.query("INSERT INTO mercury_guard.sites VALUES('device-site',true),('other-site',true)");
  const identity={subject,guardId:'device-guard',vendorId:'device-vendor'},other={subject:otherSubject,guardId:'device-other',vendorId:'device-vendor'};
  const session=await fixtureAuthSession(admin,subject),otherSession=await fixtureAuthSession(admin,otherSubject);
  const devices=new PostgresDeviceAssignments(pool),keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const spki=keys.publicKey.export({type:'spki',format:'der'}).toString('base64url'),thumb=parseEnrollmentKey(spki).thumbprint;
  await devices.enroll({deviceId:'site-phone',mode:'site',siteId:'device-site',active:true,revoked:false,publicKeySpki:spki});
  const assignment={assignmentId:'device-assignment',guardId:identity.guardId,vendorId:identity.vendorId,siteId:'device-site',startsAt:now-1000,endsAt:now+60000,active:true};
  await devices.assign(assignment);
  await assert.rejects(admin.query("UPDATE mercury_guard.assignments SET ends_at_ms=starts_at_ms WHERE assignment_id='device-assignment'"),/check constraint/);
  await assert.rejects(admin.query("UPDATE mercury_guard.assignments SET ends_at_ms=9007199254740992 WHERE assignment_id='device-assignment'"),/check constraint/);
  await devices.assign({...assignment,assignmentId:'different-site',siteId:'other-site'});
  const proof=c=>({version:1,algorithm:'SHA256withECDSA',audience:c.audience,request_id:c.request_id,challenge:c.challenge,device_thumbprint:thumb,public_key_spki:spki,signature_der:sign('sha256',Buffer.from(`mercury-enrollment-proof-v1\n${c.audience}\n${c.request_id}\n${c.challenge}\n${thumb}`),keys.privateKey).toString('base64url')});
  const first=proof(await devices.challenge(identity,'site-phone',now,session));
  const race=await Promise.allSettled([devices.list(identity,first,now,{session}),devices.list(identity,first,now,{session})]);
  assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
  assert.deepEqual(race.find(r=>r.status==='fulfilled').value.assignments.map(a=>a.assignmentId),['device-assignment']);
  const old=proof(await devices.challenge(identity,'site-phone',now,session));
  const current=proof(await devices.challenge(identity,'site-phone',now,session));
  await assert.rejects(devices.list(identity,old,now,{session}));
  await assert.rejects(devices.list(other,current,now,{session:otherSession}));
  await assert.rejects(devices.list(identity,{...current,signature_der:'AA'},now,{session}));
  assert.equal((await new PostgresDeviceAssignments(pool).list(identity,current,now,{session})).assignments.length,1);
  const expired=proof(await devices.challenge(identity,'site-phone',now,session));
  await assert.rejects(devices.list(identity,expired,now+60000,{session}));
  const authority={assignmentId:assignment.assignmentId,siteId:assignment.siteId,guardId:identity.guardId,thumbprint:thumb,publicKeySpki:spki,revocationVersion:1};
  assert.equal(await devices.authorizes(identity,authority,now),true);
  await devices.cancel(assignment.assignmentId);
  assert.equal(await devices.authorizes(identity,authority,now),false);
  assert.equal((await devices.list(identity,proof(await devices.challenge(identity,'site-phone',now,session)),now,{session})).assignments.length,0);
  const cancelled=await devices.list(identity,proof(await devices.challenge(identity,'site-phone',now,session)),now,{includeCancelled:true,session});
  assert.equal(cancelled.assignments[0].assignmentActive,false);
  await admin.query("UPDATE mercury_guard.sites SET active=false WHERE site_id='device-site'");
  await assert.rejects(devices.challenge(identity,'site-phone',now,session));
  await admin.query("UPDATE mercury_guard.sites SET active=true WHERE site_id='device-site'");
  const pending=proof(await devices.challenge(identity,'site-phone',now,session));
  await devices.revoke('site-phone');
  await assert.rejects(devices.list(identity,pending,now,{session}));
  assert.equal((await devices.device('site-phone')).revocationVersion,2);
  const personal=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  await devices.enroll({deviceId:'personal-phone',mode:'personal',guardId:identity.guardId,active:true,revoked:false,publicKeySpki:personal.publicKey.export({type:'spki',format:'der'}).toString('base64url')});
  await assert.rejects(devices.challenge(other,'personal-phone',now,otherSession));
  assert.ok(await devices.challenge(identity,'personal-phone',now,session));
  console.log('PASS: PostgreSQL device proof concurrency, replacement, rollback, expiry, scope, cancellation and revocation');
 }finally{await pool.end();}
}
