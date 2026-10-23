import assert from 'node:assert/strict';
import {generateKeyPairSync,createPublicKey,verify} from 'node:crypto';
import {Pool} from 'pg';
import {PostgresDeviceAssignments} from '../postgres-device-assignments.mjs';
import {PostgresShiftGrantIssuer} from '../postgres-shift-grant-issuer.mjs';
export async function verifyPostgresGrants(connectionString,admin){
 const pool=new Pool({connectionString,max:4,options:'-c role=service_role'});
 try{
  const devices=new PostgresDeviceAssignments(pool),keys=generateKeyPairSync('rsa',{modulusLength:2048});
  const config={devices,privateKey:keys.privateKey,keyId:'pg-grants',issuer:'mercury-local',audience:'mercury-local'},issuer=new PostgresShiftGrantIssuer(config);
  const r=(await admin.query("SELECT h.*,g.auth_subject FROM mercury_guard.shift_sessions h JOIN mercury_guard.guards g ON g.guard_id=h.guard WHERE h.clocked_out IS NULL AND h.guard='device-guard'")).rows[0];assert.ok(r);
  const identity={subject:r.auth_subject,guardId:r.guard,vendorId:r.vendor},device=await devices.deviceByThumbprint(r.device),now=Number(r.clocked_in)+1;
  const assignment={assignmentId:r.assignment,guardId:r.guard,vendorId:r.vendor,siteId:r.site,deviceId:device.deviceId,startsAt:Number(r.starts_at),endsAt:Number(r.ends_at),canStart:true};
  const context={identity,device,assignment,now,sessionExpiresAt:now+120000,allowedActions:['incident','photo']};
  const signed=await issuer.issue(context),claims=JSON.parse(Buffer.from(signed.payload,'base64url'));
  assert.equal(verify('sha256',Buffer.from(`mercury-shift-grant-v1.${signed.key_id}.${signed.payload}`),createPublicKey(keys.privateKey),Buffer.from(signed.signature,'base64url')),true);
  const second=new PostgresShiftGrantIssuer(config),saved=await second.lookup(claims.grant_id);
  assert.deepEqual(saved.claims,claims);assert.equal(saved.subject,identity.subject);assert.equal(saved.vendorId,identity.vendorId);
  assert.equal(await second.lookup('invalid-uuid'),null);
  await assert.rejects(pool.query("UPDATE mercury_guard.capture_grants SET payload='changed'"),/permission denied/);
  await assert.rejects(pool.query('DELETE FROM mercury_guard.capture_grants'),/permission denied/);
  await second.revoke(claims.grant_id);assert.equal(await issuer.lookup(claims.grant_id),null);
  await assert.rejects(issuer.issue({...context,assignment:{...assignment,assignmentId:'pg-shift'}}));
  await devices.cancel(assignment.assignmentId);await assert.rejects(issuer.issue(context));
  console.log('PASS: shared PostgreSQL capture grants, signature/scope, cross-instance lookup/revocation and immutable records');
 }finally{await pool.end();}
}
