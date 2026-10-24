# Original photo transfer on bounded HTTP platforms

Mercury One retains the original JPEG and signed metadata, including its stable event/evidence IDs, byte count and SHA-256. It does not resize or recompress evidence to fit a hosting limit. The photo cap remains 20 MiB. Netlify currently documents a 6 MB buffered payload limit, with binary upload encoding reducing the effective request budget; this protocol uses at most 1 MiB of raw photo data per request/response. See [Netlify function limits](https://docs.netlify.com/build/functions/configuration/).

## Handset to Guard service

The accepted signed photo event must exist first. Every request requires the current verified individual Auth session, matching guard/vendor, original assignment/capture grant, and current enrolled installation key/revision. Captures made before an explicit clock-out retain the existing late-delivery window; a later grant or another guard never relabels the original.

`POST /v1/evidence/EVENT_UUID/chunks/INDEX` accepts `application/octet-stream`, `X-Mercury-Chunk-SHA256` and `X-Mercury-Chunk-Signature`. Indices are canonical decimal 0..19; all pieces are 1048576 bytes except the exact final remainder. The signature is canonical unpadded base64url P-256/SHA256withECDSA DER from the original installation key over UTF-8 lines, with no trailing newline:

```
mercury-evidence-chunk-v1
AUDIENCE
ORIGINAL_DEVICE_THUMBPRINT
EVENT_UUID
EVIDENCE_UUID
FULL_PHOTO_SHA256
FULL_PHOTO_BYTE_COUNT
CHUNK_INDEX
CHUNK_SHA256
CHUNK_BYTE_COUNT
```

All fields have canonical encodings and bounded lengths. An exact proof retry can authorize only that same immutable piece; no nonce is required for this content-bound retry. A stolen same-guard bearer without the installation key cannot poison staging. This proof does not replace current session, enrollment or capture-grant checks. The handler validates the proof before reading/storing a fragment and rechecks current authority after the body arrives.

The exact chunk receipt contains `event_id`, `evidence_id`, full `sha256`/`bytes`, `chunk_index`, `chunk_sha256`, `chunk_bytes` and `status:evidence_chunk_retained`. This receipt does **not** acknowledge the whole photo or clear its local encrypted queue.

`POST /v1/evidence/EVENT_UUID/finalize` accepts only JSON `{}`. A transaction verifies all original ordered pieces, exact total/hash and JPEG boundary markers, then inserts the immutable original into existing private media storage. It returns the unchanged existing `evidence_accepted_local_only` receipt. Concurrent/exact retries return that same receipt. Incomplete/conflicting/corrupt pieces cannot create a final receipt. Legacy direct `POST /v1/evidence/EVENT_UUID` remains supported; its large body is unsuitable for Netlify ingress.

## Guard service to approved receiver

The dedicated machine credential and current original mapping/deployment checks protect `/v1/mercury-one/media/DELIVERY_ID`. Small legacy JPEG sends remain direct. Larger originals use `/chunks/INDEX` with the chunk digest header and `/finalize` with JSON `{}`. A retained fragment is distinct from the unchanged `media_stored_in_integration_inbox` final receipt. This machine transfer does not impersonate a guard or grant administrator access.

`POST /v1/mercury-one/media/DELIVERY_ID/status` accepts JSON `{}` and returns exact original IDs/destination/hash/size, `chunk_size:1048576`, up to 20 validated `{chunk_index,sha256,bytes}` entries, `receipt:null` or the matching stored final receipt, and `status:media_transfer_status`. It rechecks current mapping/deployment even for retries. The sender skips only pieces whose reported size/hash match its own original byte slice. This resumes after a finite Netlify worker budget or lost HTTP response; missing/expired progress causes retransmission of original bytes. A mismatched progress hash is never trusted and cannot mark delivery complete.

## Protected report viewing

The existing authenticated report media path supports exact `Range: bytes=START-END` requests of at most 1048576 bytes. Each request revalidates the current administrator session/membership and stored original media integrity. It returns 206, exact `Content-Range`/`Content-Length`, `image/jpeg`, strong `ETag:"FULL_SHA256"`, and private no-store/nosniff/same-origin headers. Suffix/multipart/oversized/out-of-bounds ranges are rejected. The previous direct 200 route remains available outside a platform body cap.

The browser snapshots the report-supplied same-origin path/hash/size, fetches large images sequentially in bounded ranges, checks every range and the final JPEG/hash, then creates its private object URL. Session changes, expiry, cancellation and stale responses cannot restore an old private image. There is no public object URL or credential query parameter.

## Persistence and limits

The migration adds RLS-enabled private `mercury_guard.evidence_chunks` and `mercury_guard_receiver.media_chunks`. Only the server role may select/insert/delete fragments; it cannot update them. Event/delivery foreign keys and bounded unique indices prevent cross-photo reuse or unbounded fragment counts. Accepted media/events/receipts remain append-only under their existing grants.

Incomplete fragments have a 24 hour technical staging lifetime, capped by the original assignment's late-delivery cutoff on the source side. Exact retries do not extend an existing fragment. Bounded maintenance removes only expired staging rows; it never deletes accepted media or original events/receipts. The handset retains its encrypted original for eligible retransmission. This staging lifetime does not define business retention, backups or evidence deletion policy.

Local verification covers 20 MiB original-byte round trips, restart/concurrency/retry, failure/expiry/revocation, source phone-key proofs, protected ranges and finite-worker progress. Android build/JVM and instrumentation compilation are separate from actual framework/HTTPS execution. The existing HTTPS integration now exercises Android Keystore chunk signatures and missing/other-key denial; exact-source CI execution must pass before accepting that interoperability gate. No local result proves hosted activation or Fold camera/network/battery acceptance. Existing immutable v0.35 APKs and handset applications remain untouched.
