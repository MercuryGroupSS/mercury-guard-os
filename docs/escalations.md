# Mercury One escalation protocol

Mercury One stores an authenticated guard escalation in a private operator inbox and records a separate, explicit operator acknowledgement. An escalation does not require clock-in or a live shift capture grant. Service receipt, operator acknowledgement, downstream delivery and emergency response are different outcomes.

This path sends no email, SMS, push message or emergency call. The existing Ops observation receiver requires an assignment and does not automatically forward off-shift escalations.

## Guard requests

Both routes require HTTPS, an individually verified bearer in the `Authorization` header, a current Auth session and possession of a currently enrolled installation key. They accept only POST with `Content-Type: application/json`; query strings are rejected. Tokens, passwords and refresh credentials never belong in the body, URL, intent or receipt.

| Route | Exact JSON envelope | Maximum request bytes |
| --- | --- | --- |
| `/v1/escalations` | `{"intent":"<base64url raw JSON>","proof":{...}}` | 16,384 |
| `/v1/escalations/status` | `{"escalation_id":"<UUID>","proof":{...}}` | 4,096 |

`intent` encodes the exact retained UTF-8 JSON bytes using canonical unpadded base64url. The decoded snapshot is limited to **11,264 bytes**. Preserve those bytes, the escalation UUID and their SHA-256 across retries. Do not decode and reserialize the snapshot before signing or retrying: whitespace, JSON escaping and numeric spelling affect its fingerprint. Duplicate keys, trailing content, invalid UTF-8 and a byte-order mark are rejected.

The decoded intent has these exact fields:

```json
{
  "version": 1,
  "escalation_id": "11111111-1111-4111-8111-111111111111",
  "guard_id": "individual-guard-id",
  "vendor_id": "company-or-individual-vendor-id",
  "assignment_id": null,
  "occurred_at_ms": 1792770000000,
  "urgency": "assistance",
  "description": "Synthetic example only",
  "location": null
}
```

UUIDs use lowercase canonical text. Guard, vendor and optional assignment IDs follow `[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}`. `occurred_at_ms` is a positive safe integer no later than the service's intake time. `urgency` is `urgent` or `assistance`; it does not select a medical triage or emergency service. Description contains 1–2,000 Unicode code points, must contain non-whitespace text, and cannot contain invalid surrogate sequences or disallowed control characters.

Location may be absent as `null`; missing GPS must not prevent an escalation. When supplied, it has exactly `at_ms`, `latitude`, `longitude`, `accuracy_m` and `mock`. Its time is positive, no later than the observation and at most five minutes older. Latitude is −90 to 90, longitude −180 to 180, accuracy greater than zero and at most 1,000 metres, and `mock` must be false. Native clients should use `null` for unavailable, stale or mock GPS. These values are device-reported context; they do not establish verified presence or indoor position.

## Intent-bound device proof

Obtain a fresh challenge through the existing authenticated `/v1/device-challenge` route for the packaged Device ID. A challenge expires after 60 seconds and is consumed in the same transaction as escalation intake or status reading. Another challenge for the same person and device replaces its predecessor.

Proof uses the existing enrollment envelope's exact fields:

```json
{
  "version": 1,
  "algorithm": "SHA256withECDSA",
  "audience": "<packaged audience>",
  "request_id": "<challenge UUID>",
  "challenge": "<32-byte unpadded base64url nonce>",
  "device_thumbprint": "<lowercase SHA-256 of public SPKI>",
  "public_key_spki": "<unpadded base64url P-256 SPKI>",
  "signature_der": "<unpadded base64url ECDSA DER signature>"
}
```

Sign the UTF-8 bytes of the following text, with literal line feeds and **no final newline**:

```text
mercury-escalation-proof-v1
<audience>
<operation>
<request_id>
<challenge>
<device_thumbprint>
<payload_sha256>
```

Operation is `create` or `status`. For `create`, `payload_sha256` is the lowercase SHA-256 of the exact decoded intent bytes. For `status`, hash exactly the compact UTF-8 JSON `{"escalation_id":"<UUID>"}`. Its only property and lowercase UUID make its serialization unambiguous.

An ordinary enrollment signature, a proof for another operation, an altered snapshot or an already consumed challenge cannot authorize this request. Obtain and sign a new proof on each retry while retaining the original intent. A failed transaction also rolls back nonce consumption; clients should still obtain a new challenge after an unconfirmed transport outcome.

## Current authority and off-shift scope

The service resolves the named guard from the verified individual Auth subject, then rechecks the current Auth session, active guard, vendor and enrollment inside its transaction. The caller's Guard ID and Vendor ID must match that directory entry. Company identity and local biometrics cannot substitute for the individual account.

For a shared site phone, the current approved enrollment supplies Site ID and that site must be active. For a personal phone, the enrollment must belong to the guard; an off-shift request without an assignment has no inferred site. GPS and display names never choose the site.

An optional assignment must be active and belong to the original guard/vendor. Its approved site must be active and match a shared phone's enrolled site. No clock-in, current schedule window or attendance state is required, so a still-approved ended assignment can provide context. Cancelling an assignment prevents new intake or exact intake-receipt recovery against that assignment; it does not delete its already received escalation.

The guard's status route requires the original subject, guard, vendor, installation key, Device ID and enrollment revision, with current guard/vendor/device/site approval. It can recover a received escalation after assignment cancellation. Another guard at the same company or shared phone cannot read it. Operators retain historical inbox access after source cancellation or revocation, provided their own administrator approval and Auth session remain current.

Application-side authority rows are locked through commit. Auth session existence/expiry is checked again before returning a successful transaction; an already authorized transaction can still finish across a concurrent provider logout after its final check. This is not a claim that provider logout and database commit are fully serialized. [Supabase session behavior](https://supabase.com/docs/guides/auth/sessions) explains why JWT expiry alone does not establish current session existence.

## Receipt and status meanings

A committed intake returns:

```json
{
  "version": 1,
  "escalation_id": "<original UUID>",
  "intent_sha256": "<exact original fingerprint>",
  "status": "received_by_guard_service",
  "received_at_ms": 1792770001000
}
```

Validate every field against the original snapshot before saving its receipt. Exact retries from the same current original authority return the original receipt and original receipt time. Changed bytes, identity, device or attribution under the same UUID conflict. A receipt confirms storage in this service's protected inbox; it does not confirm an operator saw the request.

Status returns those same identity/fingerprint/time fields, a status of `received_by_guard_service` or `operator_acknowledged`, and `acknowledgement`. Before an explicit operator action, that field is `null`. Afterwards it contains exactly:

```json
{
  "operator_subject": "<approved individual administrator UUID>",
  "acknowledged_at_ms": 1792770010000,
  "note": "<operator note shared with the guard>"
}
```

Recommended native states are **Saved on this phone**, **Received by Mercury One** and **Operator acknowledged**. A failed/unknown upload keeps the immutable local snapshot pending. Do not label a local save, a report view or a timed status poll as acknowledgement. Retain separate received and observed times.

HTTP 401 requires reauthentication; 403 means current scope or proof was not authorized; 409 means UUID contents/authority conflict. Oversized requests return 413. Transient authorization/storage or unconfirmed outcomes return 503. Unknown status IDs and IDs outside the current guard/device binding return 404. None of these responses confirms receipt, acknowledgement or external contact.

## Operator review and request resolution

The existing protected administration surface exposes `GET /v1/admin/catalog?kind=escalations`, with optional opaque `after`. Pages contain at most 50 items ordered by service receipt time and UUID, latest first. Cursors remain opaque to clients. Catalog items include the original intent/attribution, its service receipt and current acknowledgement; they include no bearer or Auth session ID.

Use the normal reviewed administration request at `/v1/admin/actions`:

```json
{
  "request_id": "<new lowercase UUID>",
  "action": "escalation.acknowledge",
  "reason": "Reviewed the request and contacted the guard through the established channel.",
  "payload": {"escalation_id": "<original escalation UUID>"}
}
```

The reason is a required single-line note of at most 500 Unicode code points and is **visible to the originating guard**. The first explicit acknowledgement keeps its original operator, time and note. Later acknowledgement requests record their own audit receipt but cannot replace that first human acknowledgement. Acknowledgement does not mark the incident resolved or assert any contact actually occurred.

Receipts use the existing `request_id`, `action`, `status`, `result` and `server_time_ms` administration envelope. The result includes the escalation ID, original acknowledgement and `already_acknowledged`. Requests share the existing append-only administration audit, actor/body digest and global UUID lock namespace; reusing a UUID for changed contents or another action conflicts.

If an action's outcome is unconfirmed, retry the exact envelope or submit it to `/v1/admin/resolve`. Resolve returns its already saved receipt or permanently closes a never-applied request as `not_applied`. A delayed action with that UUID then returns the closure and cannot acknowledge the escalation. Closing a request does not resolve the underlying escalation, remove an existing acknowledgement or discard guard records.

## Contact and release limits

Escalate must remain available before sign-in. Unverified/offline drafts and existing demo audit rows must not be silently reassigned to the next signed-in guard. A configured contact fallback should come only from independently approved public configuration, use the system dialer for user confirmation, and remain separate from service/operator receipts. Vendor billing phones/emails are not approved dispatch contacts. Tests must intercept synthetic dialer intents and send no calls or messages.

Actual configured contacts, downstream alert transports and their delivery receipts need independent setup and acceptance. A protected inbox does not guarantee an operator is watching it. Production HTTPS deployment, real approved users/enrollments, operational procedures, retention, release signing and Fold6/background/network acceptance remain release requirements. No emergency-response guarantee follows from local database, API, emulator or browser tests.
