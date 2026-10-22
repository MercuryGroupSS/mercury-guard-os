import {readFileSync} from 'node:fs';
import {verifyScopedBatch} from './verify-batch.mjs';
// Only for synthetic test output. Context is intentionally a known synthetic fixture, not authentication.
const file=process.argv[2];
if(!file) throw new Error('Provide a synthetic Android v2 proof JSON file');
const raw=readFileSync(file,'utf8'), proof=JSON.parse(raw);
const context={enrolled:true,revoked:false,audience:'mercury-local',thumbprint:proof.device_thumbprint,
 publicKeySpki:proof.public_key_spki,guardId:'synthetic-guard',siteId:'synthetic-site',assignmentId:'synthetic-assignment',
 revocationVersion:1,notBefore:1000,expiresAt:1900,allowedKinds:['incident']};
const verified=verifyScopedBatch(raw,context,1100);
console.log(JSON.stringify({verified:true,events:verified.batch.events.length,scope:verified.scope,payloadHash:verified.payloadHash}));
