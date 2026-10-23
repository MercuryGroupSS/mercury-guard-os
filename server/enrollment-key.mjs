import {createPublicKey,createHash} from 'node:crypto';
export function decodeEnrollmentValue(x,max){
 if(typeof x!=='string'||x.length>max*2||!/^[A-Za-z0-9_-]+$/.test(x))throw Error('Invalid encoding');
 const b=Buffer.from(x,'base64url');if(b.length>max||b.toString('base64url')!==x)throw Error('Invalid encoding');return b;
}
export function parseEnrollmentKey(spki){
 const bytes=decodeEnrollmentValue(spki,256),k=createPublicKey({key:bytes,type:'spki',format:'der'});
 if(k.asymmetricKeyType!=='ec'||k.asymmetricKeyDetails?.namedCurve!=='prime256v1')throw Error('P256 required');
 return {key:k,thumbprint:createHash('sha256').update(bytes).digest('hex')};
}
