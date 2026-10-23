# Mercury Ops Dashboard integration — local groundwork

Confirmed by user on 2026-10-22. Target: MercuryGroupSS/mercury-dashboard, Netlify mercuryops-dashboard, Supabase Ops-Dashboard (dyctehllmjryjwvrmxdw). Existing application remains unchanged. No hosted project, deployment, live data write or new hosting charge.

## Read-only findings

Inspected dashboard source and live column metadata, without querying business records. Dashboard tree inspected: d05cff868a4810dd3bb1cbf7471841a196849f90.

- public.shifts contains a Homebase text ID, display names, schedule, status and updated_at; it has no stable guard/site foreign keys. An explicit independently maintained assignment-to-guard/site binding is required. Matching names cannot authorize a device.
- board-data.js serves dashboard-wide data through server authorization. Do not expose this broad read to guard devices.
- checkin-ingest.js is a shared-secret WhatsApp ingestion path; it hardcodes source=whatsapp and updates whatsapp_reader heartbeat. Do not use this endpoint for Mercury One or put its shared secret in the APK.
- Existing guard_checkins and shift_compliance are downstream integration candidates, not approved write targets. Their assumptions about WhatsApp, confidence, time and alerts require review before introducing another source.
- Dashboard access checks verify Supabase users and an active billing.app_users entry. Device enrollment and assignment authorization require their own explicit mapping; an admin/vendor role is not guard identity.

## Implemented locally

server/ops-dashboard-adapter.mjs is a pure projection boundary with no transport or writes. It validates an independently provided binding and schedule, projects a limited assignment, and projects scoped Mercury One observation metadata. It intentionally excludes report bodies and media pending an explicit ingestion schema. It does not authenticate, sign grants, persist, deduplicate or produce delivery receipts. Inputs must come from trusted server checks; never pass phone-supplied binding objects directly.

Five new adapter tests plus seventeen existing protocol tests pass (22 total). They cover missing/inactive/mismatched bindings, unavailable assignments, invalid schedules, cross-scope observations, unsupported kinds and avoiding false delivery claims.

## Next implementation gates

1. Confirm authoritative stable guard/site/assignment mapping, source revisions and cancellation semantics, including Homebase sync replacement behavior.
2. Implement server authentication, enrollment, scoped grants and immutable original capture scope in Android.
3. Add durable transactional ingestion and replay receipts; maintain separate Mercury One observations and heartbeat. Review downstream compliance behavior before publishing projections.
4. Exercise a local HTTP round trip and database isolation, then test the Fold. No production activation is implied by adapter unit tests.

## Isolated delivery path — 23 October 2026

Read-only reinspection of the existing checkin-ingest.js confirmed it remains a WhatsApp-specific endpoint. No existing application code, schema, heartbeat or payroll record was modified.

The Guard OS repository now contains a separate integration-inbox protocol:

- `dashboard-bridge.mjs`: administrative stable identity/assignment bindings with increasing revisions. Bounded scans project only accepted service records that have an explicitly approved mapping. Unmapped records remain in the source store and are revisited. No device API can approve mappings.
- `dashboard-delivery.mjs`: strict observation projection, durable immutable outbox, exclusive expiring delivery leases, exponential retry delay, bounded HTTPS transport without redirects, and exact payload-hash receipts. Original mapping/content conflicts require review rather than silently retargeting a queued observation.
- `dashboard-inbox.mjs`: isolated SQLite reference receiver at POST /v1/mercury-one/observations, with a dedicated service credential, independent mapping validation, body bounds and idempotent durable insertion. It writes only its new reference inbox, not existing dashboard tables.

Receipts are named stored_in_integration_inbox and bind delivery ID, destination and SHA-256 of the exact payload. That confirms inbox persistence, not dashboard rendering, compliance processing or payroll clock-in. Photo/check-in projections explicitly state media_delivery=not_transferred; private image delivery remains a separate unfinished integration. Only approved typed fields are projected; unrelated source data and capture-grant IDs are omitted. Local reasons remain immutable observations.

The local service runner creates a local binding store and outbox, and scans accepted records every 30 seconds. It deliberately supplies no network send function, so outbound delivery is disabled. No actual customer/guard mapping has been approved or inferred from names. Existing records are preserved when mapping is missing, changed, revoked or delivery fails.

84 server tests pass, including a real loopback HTTP sender-to-inbox round trip, durable retry receipts, immutable content conflicts, wrong credentials/mappings, lease recovery, redirect rejection, oversized receipts and revocation before sending. The destination is synthetic and separate from the user's hosted applications. Production still requires reviewed receiver persistence/deployment, dedicated credential provisioning, approved mappings, private media access, downstream rendering/compliance integration and inbound dispatch/assignment refresh.
