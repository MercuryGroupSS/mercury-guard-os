import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {createPersonalPermitCodec,PersonalSessionDenied,personalLoginMessage,personalRefreshMessage} from './personal-session.mjs';
const key=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey;
test('personal permit is signed for exact origin, account, device, provider session and refresh generation',()=>{
 let at=1700000000000;const options={key,keyId:'test',issuer:'issuer',audience:'audience',origin:'https://guard.test',now:()=>at},codec=createPersonalPermitCodec(options);
 const input={identity:{subject:randomUUID(),guardId:'a',vendorId:'company'},device:{deviceId:'phone',thumbprint:'a'.repeat(64),revocationVersion:2},session:{sessionId:randomUUID()},refresh:'private-fixture-only'};
 const permit=codec.issue(input),c=codec.read(permit);assert.equal(c.device_id,'phone');assert.equal(c.session_id,input.session.sessionId);assert.equal(c.expires_at_ms-at,30*86400000);
 assert.throws(()=>codec.read({...permit,signature:'bad'}),PersonalSessionDenied);
 assert.throws(()=>codec.read({...permit,payload:Buffer.from(JSON.stringify({...c,guard_id:'b'})).toString('base64url')}),PersonalSessionDenied);
 for(const changed of [{origin:'https://other.test'},{audience:'other'},{issuer:'other'},{keyId:'other'}])assert.throws(()=>createPersonalPermitCodec({...options,...changed}).read(permit),PersonalSessionDenied);
 at+=5000;const next=codec.read(codec.renew(c,'rotated-fixture-only'));assert.equal(next.issued_at_ms,c.issued_at_ms);assert.equal(next.expires_at_ms,c.expires_at_ms);assert.notEqual(next.refresh_sha256,c.refresh_sha256);
 at=c.expires_at_ms;assert.throws(()=>codec.read(permit),PersonalSessionDenied);
});
test('personal proof domains and refresh hashes bind exact credential and permit independently of property order',()=>{
 const permit={payload:'payload',signature:'sig'},other={signature:'sig',payload:'payload'};
 assert.equal(personalRefreshMessage('a','r','n','t',permit,'secret'),personalRefreshMessage('a','r','n','t',other,'secret'));
 assert.notEqual(personalRefreshMessage('a','r','n','t',permit,'secret'),personalRefreshMessage('a','r','n','t',permit,'other'));
 assert.notEqual(personalLoginMessage('a','guard','phone',1,'r','t'),personalRefreshMessage('a','r','n','t',permit,'secret'));
});
