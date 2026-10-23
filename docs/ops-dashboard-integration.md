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

## Delivery recovery and scoped return feed

Outbox acknowledgement now checks the persisted immutable payload and lease, not only a caller-held job object. A lost response after the inbox commit can be retried after both processes restart; the same durable receipt returns and no second row is inserted. Corrupted queued content fails closed before transport.

`dispatch-feed.mjs` provides an isolated administrative message source plus POST /v1/dispatch through the authenticated device-proof assignment handler. Each message version is immutable, revisions advance one step, and retractions carry empty content. New readers receive only the latest version of each message rather than historical withdrawn text. Opaque persisted cursors bind guard/vendor/site/assignment, enrolled device key and revocation version. Expired or mismatched cursors return an explicit reset-required response. Pages are limited by both count and encoded byte size. No broad dashboard reader or existing messaging endpoint is exposed to the phone.

The Android service client and HTTPS fixture can fetch this feed, but the encrypted local phone inbox, read/acknowledgement state and user-facing message screen are still being implemented. A fetched message is not treated as read or acknowledged. The local runner's dispatch source is empty until an administrator publishes synthetic messages; no live dashboard message import or outbound human messaging has occurred.

91 server tests pass, including durable lost-response recovery, strict receipt integrity, cross-scope cursor rejection, version/retraction behavior, restart/expiry, fresh device-proof authorization and large escaped-content pagination. Android APK/test APK compilation, JVM checks and lint pass locally. The expanded HTTPS device path awaits CI execution for this source checkpoint.

## Vendor identity reconciliation — 23 October 2026

Read-only source inspection of `invoice-desk/README.md`, `netlify/functions/lib/billing-map.js`, `supabase-schema.sql` and `hr/migrations/M1_hr_schema_and_employees.sql` confirms:

- Invoice Desk stores vendors under `billing.vendors.vendor_id`. Its UI document ID may be a slug; use the explicit vendor_id, never the slug, name or email, for the external link.
- Vendor IDs can change through `billing_rename_vendor`; `prev_ids` preserves earlier codes. They are not immutable Mercury One identity keys. Keep a separate internal vendor ID and an explicitly revisioned Ops vendor binding.
- `is_agency` is a licensing flag, separate from contractor/employee `worker_type`. A false flag does not prove an individual vendor. Use a reviewed company/individual classification; never infer guards from vendor billing contact details.
- The HR migration enforces one employee per vendor and an EMP-vendor-ID format. It is not a general roster of individual guards working under company vendors. Guard authentication subjects remain independent.
- Existing guard_map links Homebase display names to vendors, not authenticated guard subjects. It cannot authorize guard sign-in by itself.

`ops-vendor-reconciliation.mjs` now reconciles bounded trusted vendor snapshots against explicit bindings without writes or network access. Missing, renamed, reused and ambiguous codes return review statuses; historical aliases never silently retarget existing guard relationships. Only minimal identity/status fields leave the projection, excluding billing addresses, tax and payment details. `source_link_resolved` means only that the reviewed external link exists in this snapshot; it does not approve access, prove snapshot freshness, create Auth accounts or activate assignments. Wiring authenticated snapshot retrieval, persistent binding approval and cancellation remains outstanding. These findings are repository-source evidence, not verification of the current hosted schema or business records.

## Local assignment refresh adapter

`OpsAssignmentSync` applies one trusted source row and explicit approved binding to `LocalDeviceAssignments` in a single SQLite transaction. Bindings contain opsShiftId, guardId, vendorId, siteId, revision and active, plus optional approved patrolRoute/checkInPolicy. The adapter is administrative; it is not exposed to phone HTTP clients and does not retrieve or authenticate upstream data itself.

Source timestamps and binding revisions advance independently. Equal-version content conflicts and regressions are rejected. Routine source-status refreshes preserve the assignment ID; material schedule/scope/policy changes create a new internal ID and cancel the earlier assignment without rewriting its original schedule or attendance. Completed/cancelled source status or disabled binding cancels the current assignment. Reopening creates another ID. Missing rows never imply cancellation, because a partial dashboard snapshot is not proof of removal. Failed replacement rolls back cancellation and refresh history together.

The local assignment store is the adapter's transaction boundary. Auth roster validation, trusted source transport/freshness, persisted mapping approval, dashboard outbox binding for generated IDs and recurring refresh wiring are still required before activation. Live data was not queried or changed. The adapter does not clock guards in or out; existing confirmed cancelled shifts use the separate close-out path.

## Server-only shift reader

`createOpsShiftReader` reads `public.shifts` through a configured Supabase Data API origin using a server-only secret or legacy service credential. Each call accepts at most 25 explicitly mapped IDs, sends only GET, selects id/scheduled_start/scheduled_end/status/updated_at, refuses redirects and non-200/partial responses, and bounds response time and bytes. Returned IDs, duplicates and fields are checked before any result is released. Missing IDs are reported separately and must not be treated as cancellations. Errors do not include upstream response text or credentials.

This code has contract tests using synthetic responses, not a verified live connection. Source schedules remain validated by OpsAssignmentSync before activation. No service key is bundled in Android, no production credential was retrieved, and no live query or write was performed in this change. A secure server deployment, approved mapping source, live read verification and recurring synchronization remain required.

Documentation reviewed: [Data API](https://supabase.com/docs/guides/api), [API keys](https://supabase.com/docs/guides/getting-started/api-keys), [explicit Data API grants](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically), and [TLS cipher changes](https://supabase.com/changelog/cbc-tls-ciphers-deprecated). Existing Ops schema source grants service-role SELECT on shifts; hosted grant state must still be verified. The adapter uses the supported Node runtime's normal TLS, with no legacy-cipher override.
