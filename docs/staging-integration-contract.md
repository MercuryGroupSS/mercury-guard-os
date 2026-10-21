# Proposed staging integration boundary

This is a design contract for the next implementation phase, not a live service or a claim of existing production compatibility. No existing Mercury app/repository has been inspected or changed for it.

## Trust separation

- Device enrollment binds an installation-generated device key to inventory and an administrator-controlled status.
- Guard identity is authenticated by the staging identity provider. A local demo shift button never grants production access.
- The authorization service independently checks guard, device, site, assignment and schedule before issuing a short-lived signed grant.
- A grant identifies its issuer, audience, guard, site, device public-key thumbprint, assignment, start/expiry, allowed actions and revocation version. The app verifies its signature against pinned/rotatable trusted public keys. Offline permissions must be explicitly bounded and cannot be derived from the user-editable wall clock alone.
- Device-management lock task policy and operational shift authorization are independent.

## Required operations

1. Enroll/attest installation with an administrator-approved enrollment token and device public key; never put fleet administrator secrets in the APK.
2. Authenticate guard, retrieve assigned shifts and request a site/device-bound grant.
3. Upload encrypted-in-transit event batches with stable UUIDs, monotonic sequence, device signature and idempotency key. Server enforces grant scope, replay controls, expiry and role/site isolation; client-supplied identities are not authority.
4. Authorize media upload separately, enforce content/size limits, verify hashes and retain private objects behind role/purpose checks.
5. Fetch dispatch tasks with message IDs and deadlines; acknowledgements are deduplicated and audit recorded.
6. Revoke grants/device sessions, rotate keys, apply retention and handle lost-device recovery.

## Open before connection

Choose the isolated staging service/identity provider, define dashboard-compatible schemas and ownership, select allowed offline durations, handle credential recovery, and test unauthorized/cross-site/replay access. Existing production dashboard security must be reviewed through a separately authorized integration change before sensitive telemetry is connected. Until then the APK stays explicitly demo-only and sends nothing to existing Mercury applications.


## Implemented client foundation in v0.5

The local queue now provides stable per-event UUIDs, local row sequence, encrypted persistent batches and validated transactional receipt application. Retrying before a receipt returns the same batch ID and content. A partial receipt produces a new batch ID containing remaining events with their original event IDs; the server must deduplicate by event ID as well as batch ID. Stale batch receipts are rejected locally. No records are deleted on acknowledgement. Batch selection is limited to 100 events and a 256 KiB event-data budget. Oversized records need a future explicit resolution policy.

This remains transport-neutral: no endpoint, credentials, server signature validation, enrollment, signed device events, background scheduler or live network sync is present. The schema version is provisional for an isolated staging contract, not evidence of compatibility with any existing Mercury application.
