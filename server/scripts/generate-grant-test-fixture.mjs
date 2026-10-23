// Synthetic interoperability fixture; only its public key is written.
import {generateKeyPairSync} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {ShiftGrantIssuer} from '../shift-grant-issuer.mjs';
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const issuer=new ShiftGrantIssuer({path:':memory:',privateKey,keyId:'fixture-v1',issuer:'mercury-local',audience:'mercury-local'});
try{
 const now=1800000000000;
 const grant=issuer.issue({identity:{subject:'synthetic-user',guardId:'synthetic-guard',vendorId:'synthetic-vendor'},assignment:{assignmentId:'synthetic-shift',guardId:'synthetic-guard',vendorId:'synthetic-vendor',siteId:'synthetic-site',deviceId:'synthetic-phone',canStart:true,startsAt:now-1000,endsAt:now+60000},device:{deviceId:'synthetic-phone',mode:'site',siteId:'synthetic-site',active:true,revoked:false,thumbprint:'a'.repeat(64),revocationVersion:1},sessionExpiresAt:now+120000,allowedActions:['incident','check_in'],now});
 writeFileSync(new URL('../../app/src/androidTest/assets/server-grant-fixture.json',import.meta.url),JSON.stringify({public_key_spki:issuer.publicKey(),...grant},null,2)+'\n');
}finally{issuer.close();}
