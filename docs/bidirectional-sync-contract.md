# Guard OS bidirectional sync contract — proposed, not deployed

This document defines the integration target. No endpoint, production schema, token, network client or inbound command store is enabled by it. Existing demo dispatch/check-in buttons are simulations and do not implement this contract.

## Authority and identity

Keep authoritative guards, sites, assignments and operational records in the existing applications. Introduce explicit mappings from authenticated subject to stable guard/site/assignment IDs; matching display names or client-supplied IDs cannot grant access. A restricted Guard OS API resolves device enrollment, authenticated guard, assigned site and active grant before returning or accepting data. Server-side adapters access the minimum required records in each source project. No cross-project administrator credentials belong in the APK.

## Receive path

- Assignment snapshots: stable assignment/site IDs, source version, schedule, approved instructions and permitted route/checkpoint definitions. Server assigns authority and scope; the phone cannot edit upstream scheduling by changing a cached assignment.
- Dispatch tasks: stable message ID, assignment/site binding, content version, issued time, deadline and required acknowledgement. Received/read/acknowledged are separate states.
- Policy/revocation: monotonic version and explicit device/guard/assignment scope. Revocation takes precedence over cached grants. Offline revocation cannot arrive without connectivity; short grant expiry bounds that gap.
- Cursor protocol: opaque server-issued cursor with changes/tombstones and a next cursor. Validate scope/schema before atomically storing accepted changes and cursor together. On interrupted processing retain the previous cursor and replay idempotently. If the server invalidates a cursor, obtain a scoped snapshot rather than silently skipping changes.
- An incoming record ID/version must not accept differing content at the same version. Reject stale versions, unauthorized scope and inconsistent snapshots. Instructions and commands are data, not executable code or arbitrary URLs.

## Send path

Use stable device event IDs, local sequence and signed durable batches. The server validates enrolled key, signature, audience, authenticated guard, assignment and grant action. It enforces event-level idempotency and rejects an existing event ID with different content. Local sequence gaps can occur after retention/repair and require a defined server policy; do not equate sequence continuity with truthful or immutable history.

Append operational observations; do not allow arbitrary updates of source application rows. A check-in creates a validated check-in observation associated with an authorized assignment. A dispatch acknowledgement references its exact message ID/version and stays pending locally until an authenticated receipt confirms acceptance. Evidence uploads are separately authorized, private and hash/size checked, with metadata references in the event stream.

Receipts name batch/event IDs and accepted/rejected/pending results. Apply accepted IDs transactionally to the local queue. Leave retries pending and expose actionable rejection reasons. Partial acceptance creates a new remaining batch ID while retaining original event IDs. A signed request alone is not a delivery receipt.

## Connectivity and conflicts

Work offline only within the current signed grant's explicit actions/lifetime. Calculate deadlines using a trusted server-time anchor plus monotonic time, invalidating on reboot. Connectivity restoration first refreshes identity/revocation/grants, then obtains inbound changes and retries permitted outbound data. Define whether expired-shift historical observations may be submitted under a separate archival-upload permission; do not pretend an expired operational grant is valid.

Treat backend assignments/policies as authoritative; retain unsent local observations and drafts without overwriting server scheduling. Surface reassigned/cancelled shifts and rejected reports for review. Push/realtime may wake sync, but the authenticated API and persisted cursor determine durable state.

## Required staging checks

Wrong device/guard/site; expired/revoked grant; replayed or altered IDs; changed message versions; cursor replay/invalidation; failed atomic persistence; duplicate and partial receipts; out-of-order changes; assignment cancellation; offline-to-online recovery; expired report upload policy; private media access; legacy mapping failures; and unchanged behaviour in existing applications.

An isolated staging environment must use synthetic records and disable production message/payment/media side effects. Production rollout requires additive reviewed migrations/API changes, restricted roles/RLS, rollback planning and physical Fold6 validation. No automatic production merge or deployment is configured.
