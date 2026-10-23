// Server authorization assembly. Providers must verify sessions and read authoritative
// bindings/enrollment/grants; caller JSON and user_metadata are never providers.
export function createAuthorization({verifySession, loadAuthorization, audience, now=()=>Math.floor(Date.now()/1000)}) {
  if(typeof verifySession!=='function'||typeof loadAuthorization!=='function'||typeof audience!=='string'||!audience) throw Error('Trusted authorization providers required');
  return async header=>{
    if(typeof header!=='string'||header.length>16384) return null;
    const match=/^Bearer ([^\s]+)$/.exec(header); if(!match) return null;
    const session=await verifySession(match[1]); const at=now();
    if(!session||typeof session.subject!=='string'||!session.subject||session.active!==true||
      !Number.isSafeInteger(at)||!Number.isSafeInteger(session.expiresAt)||session.expiresAt<=at) return null;
    const a=await loadAuthorization(session.subject);
    if(!a||a.subject!==session.subject||a.active!==true||a.enrolled!==true||a.revoked!==false||a.audience!==audience) return null;
    for(const key of ['guardId','siteId','assignmentId','publicKeySpki']) if(typeof a[key]!=='string'||!a[key].trim()) return null;
    if(!/^[a-f0-9]{64}$/.test(a.thumbprint??'')||!Number.isSafeInteger(a.revocationVersion)||a.revocationVersion<0) return null;
    if(!Number.isSafeInteger(a.notBefore)||!Number.isSafeInteger(a.expiresAt)||a.notBefore>at||a.expiresAt<=at||a.expiresAt-a.notBefore>900) return null;
    if(!Array.isArray(a.allowedKinds)||!a.allowedKinds.length||a.allowedKinds.some(k=>typeof k!=='string'||!k.trim()||k.length>128)) return null;
    // Shorten authorization to session lifetime. Never return provider extras or claims.
    return Object.freeze({enrolled:true,revoked:false,audience,thumbprint:a.thumbprint,publicKeySpki:a.publicKeySpki,
      guardId:a.guardId,siteId:a.siteId,assignmentId:a.assignmentId,revocationVersion:a.revocationVersion,
      notBefore:a.notBefore,expiresAt:Math.min(a.expiresAt,session.expiresAt),allowedKinds:Object.freeze([...a.allowedKinds])});
  };
}
