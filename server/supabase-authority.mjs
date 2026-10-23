// Service-side only. This key must never be shipped to Android or the browser.
export function createSupabaseAuthority({url,serviceKey,allowLocal=false,fetchImpl=fetch}) {
 const base=new URL(url);
 if(base.username||base.password||base.search||base.hash||base.pathname!=='/'||
  (base.protocol!=='https:'&&!(allowLocal&&base.origin==='http://127.0.0.1:55321')))throw Error('Trusted origin required');
 if(typeof serviceKey!=='string'||!serviceKey)throw Error('Server credential required');
 return async subject=>{
  if(typeof subject!=='string'||!/^[0-9a-f-]{36}$/.test(subject))return null;
  const endpoint=new URL('/rest/v1/guard_authorizations',base);
  endpoint.searchParams.set('subject','eq.'+subject);endpoint.searchParams.set('limit','2');
  const response=await fetchImpl(endpoint,{headers:{apikey:serviceKey,authorization:'Bearer '+serviceKey},redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error('Authority unavailable');
  const rows=await response.json();if(!Array.isArray(rows)||rows.length!==1)return null;
  const a=rows[0];
  return {subject:a.subject,active:a.active,enrolled:a.enrolled,revoked:a.revoked,audience:a.audience,
   guardId:a.guard_id,siteId:a.site_id,assignmentId:a.assignment_id,thumbprint:a.thumbprint,publicKeySpki:a.public_key_spki,
   revocationVersion:a.revocation_version,notBefore:a.not_before,expiresAt:a.expires_at,allowedKinds:a.allowed_kinds};
 };
}
