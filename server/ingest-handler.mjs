// Transport-independent HTTP handler. The host must supply trusted authentication.
// Not deployed; no default credentials, implicit identity, or public listener.
export function createIngestHandler({authenticate, store, now = () => Math.floor(Date.now()/1000)}) {
  if (typeof authenticate !== 'function' || !store?.ingest) throw new Error('Trusted dependencies required');
  const reply = (status, body) => new Response(JSON.stringify(body), {status,
    headers:{'content-type':'application/json','cache-control':'no-store'}});
  return async request => {
    if (new URL(request.url).pathname !== '/v2/batches') return reply(404,{error:'not_found'});
    if (request.method !== 'POST') return reply(405,{error:'method_not_allowed'});
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return reply(415,{error:'json_required'});
    let context;
    try { context = await authenticate(request.headers.get('authorization')); }
    catch { return reply(401,{error:'authentication_failed'}); }
    if (!context) return reply(401,{error:'authentication_required'});
    const reader=request.body?.getReader();
    if (!reader) return reply(400,{error:'body_required'});
    let size=0; const chunks=[];
    try {
      while(true) {
        const {done,value}=await reader.read(); if(done) break;
        size+=value.byteLength;
        if(size>360000) {await reader.cancel(); return reply(413,{error:'body_too_large'});}
        chunks.push(Buffer.from(value));
      }
      const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
      const receipt=await store.ingest(raw,context,now());
      return reply(200,receipt);
    } catch { return reply(400,{error:'batch_rejected'}); }
    finally { reader.releaseLock(); }
  };
}
