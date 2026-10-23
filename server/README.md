# Offline server protocol reference

Run `node --test server/*.test.mjs` with Node 24.19.0. No packages, credentials or cloud connection are required. Seventeen tests currently pass locally. CI runs independently from Android builds. The current Android continuation is v0.13; no network connection is enabled.

`verifyBatch` checks the Android v0.11/v0.12 envelope's SHA256withECDSA DER signature, P-256 SPKI fingerprint, exact audience, strict duplicate-free JSON, bounded encoding, event IDs/order/types and an injected server authorization context. That context must come from trusted server authentication, enrollment, current revocation/assignment and grant checks. Never populate it from request parameters or user-editable metadata. Server time governs authorization, while event observation timestamps may be old during offline recovery. Numeric fields must be safe integers for this JavaScript reference.

This is NOT an ingestion endpoint or deployable authorization service. It writes nothing and produces no delivery acknowledgement. Replaying a valid proof passes this stateless verifier; a future transactional ingestion store must deduplicate event IDs and batch IDs, reject changed-ID content and enforce per-device sequence policy. Partial batch retries retain original event IDs.

The existing signed batch does not cryptographically include guard/site/assignment/revocation scope. Consequently this reference cannot prove the assignment under which an offline event was captured. It must not be used to accept events into whichever assignment is current at upload time. Before live transport, add a versioned scope-bound envelope or an independently verifiable event-to-grant association; preserve that association across retries and scope changes. Binding a returned object to the current caller context does not solve historical attribution. Scope fields in the result are trusted context labels, not claims signed by this batch format.

Remaining gates: real sign-in/session freshness; administrator-controlled enrollment with one-use challenge storage; signed grants; scope-bound protocol and Android interoperability fixtures; durable transactional ingestion/replay receipts; authoritative backend adapters; inbound authorization, cursor reset and retention; deployment limits/rate controls; isolated synthetic-data round-trip tests. No existing application or database is modified by this reference.

The user selected local testing without additional hosting charges. No hosted project or branch will be created under this decision. No Supabase connection or production credentials are used by these tests.

## Local round-trip simulation

`local-roundtrip.test.mjs` supplies a synthetic backend and device signer entirely inside the test process. It receives synthetic assignment/dispatch pages, queues observations, verifies signed batches, simulates a lost receipt, deduplicates retries and rejects changed-content ID reuse. A late conflict rolls back the synthetic transaction. This is an in-memory test double, not a persistent server, real Supabase authentication or the Android app running over a network. It does not test database concurrency, crash recovery, RLS, actual identity mappings or physical devices.

The new `verifyScopedBatch` reference uses envelope version 2, payload schema_version 2 and signature domain `mercury-event-batch-v2`. The signed payload adds exact scope fields guard_id, site_id, assignment_id, device_thumbprint and revocation_version, checked against independent trusted context. This prevents changing the assignment of an existing signed payload. Android v0.13 adds an independent low-level v2 signer; its demo outbox remains v1 because original authenticated capture scope is not yet persisted. Cross-platform fixtures and scope-separated capture/storage remain required before transport. The tests do not claim to establish real authentication or enrollment.

## Durable local ingestion continuation

`durable-ingest.mjs` adds SQLite transactions and persisted local receipts after v2 signature/scope verification. It rechecks trusted authorization on every retry, binds deduplication to original scope, rejects sequence rollback, and commits events and receipts together. Tests cover process-style close/reopen, lost receipts, duplicate events and late-conflict rollback. The full local suite now has 24 passing tests.

This uses Node 24 built-in SQLite with no additional packages. The database is plaintext and for synthetic local tests only. There is no HTTP listener, Supabase authentication, enrollment service, production persistence deployment, or Android transport enabled by this module. Accepted local receipts do not mean delivery to Ops Dashboard. Device sequences currently must increase globally per enrolled key; handling delayed older batches remains an explicit protocol decision before transport.

The HTTP boundary now has a composed test using real P-256 signatures and the durable SQLite store, including restart/retry and revoked authorization. All 28 local tests pass. Requests run in-process, without a socket or real Supabase session; this is not an Android network round trip.
