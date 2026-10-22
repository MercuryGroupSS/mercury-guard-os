import { createHash, createPublicKey, verify } from 'node:crypto';

// Offline protocol reference only. No HTTP endpoint, credentials, database writes or receipts.
const fail = () => { throw new Error('Batch rejected'); };
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const fields = (x, keys) => object(x) && Object.keys(x).sort().join(',') === [...keys].sort().join(',');
const uuid = x => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x);
function decode(x, max) {
  if (typeof x !== 'string' || x.length > Math.ceil(max * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(x)) fail();
  const bytes = Buffer.from(x, 'base64url');
  if (bytes.length > max || bytes.toString('base64url') !== x) fail();
  return bytes;
}
// Reject duplicate keys at every depth, trailing content and invalid JSON. Never evaluate input.
export function strictJson(raw) {
  let i = 0;
  const ws = () => { while (/[\x20\t\r\n]/.test(raw[i] ?? '') && i < raw.length) i++; };
  function string() {
    const start = i++;
    while (i < raw.length) {
      const c = raw[i++];
      if (c === '\\') i++;
      else if (c === '"') return JSON.parse(raw.slice(start, i));
    }
    fail();
  }
  function value(depth = 0) {
    if (depth > 64) fail();
    ws();
    if (raw[i] === '"') return string();
    if (raw[i] === '{') {
      i++; const result = Object.create(null); const seen = new Set(); ws();
      if (raw[i] === '}') { i++; return result; }
      while (i < raw.length) {
        ws(); if (raw[i] !== '"') fail(); const key = string();
        if (seen.has(key)) fail(); seen.add(key); ws(); if (raw[i++] !== ':') fail();
        result[key] = value(depth + 1); ws(); const end = raw[i++];
        if (end === '}') return result; if (end !== ',') fail();
      }
      fail();
    }
    if (raw[i] === '[') {
      i++; const result = []; ws(); if (raw[i] === ']') { i++; return result; }
      while (i < raw.length) {
        result.push(value(depth + 1)); ws(); const end = raw[i++];
        if (end === ']') return result; if (end !== ',') fail();
      }
      fail();
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(raw.slice(i));
    if (!match) fail(); i += match[0].length; return JSON.parse(match[0]);
  }
  const parsed = value(); ws(); if (i !== raw.length) fail(); return parsed;
}

/** Context MUST come from trusted server authentication/enrollment/grant checks, never request fields.
 * now is server epoch seconds. Event timestamps are observations, never authorization clocks.
 * This verifies a proof only; durable idempotency/sequence acceptance is deliberately separate.
 */
export function verifyBatch(rawEnvelope, context, now) {
  if (typeof rawEnvelope !== 'string' || Buffer.byteLength(rawEnvelope) > 360000) fail();
  const proof = strictJson(rawEnvelope);
  if (!fields(proof, ['version','algorithm','audience','device_thumbprint','public_key_spki','payload','signature_der']) ||
      proof.version !== 1 || proof.algorithm !== 'SHA256withECDSA') fail();
  if (!context || context.enrolled !== true || context.revoked !== false || !Number.isSafeInteger(now) ||
      !Number.isSafeInteger(context.notBefore) || !Number.isSafeInteger(context.expiresAt) ||
      now < context.notBefore || now >= context.expiresAt || context.expiresAt - context.notBefore > 900 ||
      typeof context.audience !== 'string' || !/^[A-Za-z0-9._:/-]{1,128}$/.test(context.audience) ||
      proof.audience !== context.audience || !/^[a-f0-9]{64}$/.test(context.thumbprint ?? '') ||
      proof.device_thumbprint !== context.thumbprint) fail();
  for (const key of ['guardId','siteId','assignmentId']) if (typeof context[key] !== 'string' || !context[key].trim()) fail();
  if (!Number.isSafeInteger(context.revocationVersion) || context.revocationVersion < 0 ||
      !Array.isArray(context.allowedKinds) || !context.allowedKinds.length) fail();
  const spki = decode(proof.public_key_spki, 512);
  if (createHash('sha256').update(spki).digest('hex') !== context.thumbprint || proof.public_key_spki !== context.publicKeySpki) fail();
  const key = createPublicKey({key: spki, type: 'spki', format: 'der'});
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') fail();
  const payload = decode(proof.payload, 263168);
  const signature = decode(proof.signature_der, 80);
  const message = `mercury-event-batch-v1\n${proof.audience}\n${proof.device_thumbprint}\n${proof.payload}`;
  if (!verify('sha256', Buffer.from(message, 'ascii'), key, signature)) fail();
  const text = new TextDecoder('utf-8', {fatal: true}).decode(payload);
  const batch = strictJson(text);
  if (!fields(batch, ['batch_id','schema_version','events']) || !uuid(batch.batch_id) || batch.schema_version !== 1 ||
      !Array.isArray(batch.events) || !batch.events.length || batch.events.length > 100) fail();
  const seen = new Set(); let previous = 0;
  for (const event of batch.events) {
    if (!fields(event, ['event_id','at','kind','data','sequence']) || !uuid(event.event_id) || seen.has(event.event_id) ||
        !Number.isSafeInteger(event.sequence) || event.sequence <= previous || !Number.isSafeInteger(event.at) || event.at < 0 ||
        typeof event.kind !== 'string' || !event.kind.trim() || event.kind.length > 128 ||
        !context.allowedKinds.includes(event.kind) || !object(event.data)) fail();
    previous = event.sequence; seen.add(event.event_id);
  }
  return { batch, payloadHash: createHash('sha256').update(payload).digest('hex'),
    scope: {guardId: context.guardId, siteId: context.siteId, assignmentId: context.assignmentId,
      thumbprint: context.thumbprint, revocationVersion: context.revocationVersion} };
}
