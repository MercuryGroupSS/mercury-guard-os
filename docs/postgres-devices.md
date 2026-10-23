# PostgreSQL device and assignment persistence

Migration 20261023185827_guard_device_assignments.sql adds private sites, devices, assignments and device_challenges tables under mercury_guard. It is applied only to isolated local Supabase. No existing dashboard, billing or HR table is changed.

Assignments reference the guard/vendor pair and a site. Device enrollment references either a site or a personal guard, never both. Thumbprints are unique, revocation versions and millisecond times are bounded to JavaScript safe integers, schedules have positive duration, and each subject/device pair has at most one active challenge. Expiry and foreign-key indexes support the expected lookups.

All tables have RLS and no anonymous/authenticated access. Server-role column grants permit assignment cancellation and device revocation fields but not rewriting assignment identity/schedule/policies or enrolled key/binding. Public-key format checks do not prove a valid P-256 key or possession: those still require cryptographic service validation. Revocation-version monotonicity and single-use challenge consumption must be enforced by the runtime transaction adapter. Patrol/check-in JSON has structural/size bounds; detailed policy validation remains in the service.

The transactional SQL tests check scope mismatch, ambiguous device binding, challenge uniqueness, RLS and server-role column permissions, then roll back fixtures. The generated migration replays in the disposable PostgreSQL verifier, and local advisors report no issues. The CI PostgreSQL job now includes this migration and its tests. Runtime device/assignment operations still use SQLite pending the asynchronous PostgreSQL adapter.

## Transactional adapter verification

`PostgresDeviceAssignments` now implements enrollment, revocation, assignment cancellation, device challenges, scoped assignment listing, authority lookup, and bounded schedule reads. Challenge consumption locks the challenge row and deletes it within the same transaction as the assignment projection. A failed signature rolls back without consuming the challenge. Site handsets additionally require an active site. Enrollment key parsing is shared with the SQLite adapter.

The disposable PostgreSQL verifier now exercises real service-role connections: simultaneous use of one signed challenge yields exactly one success; replacement, wrong subject, invalid signature rollback, expiry, site scope, cancellation, disabled sites, revocation, and personal-device ownership are checked. The disposable database is removed afterward. HTTP assignment, evidence, and ingestion handlers now await device lookups and authorization, with the handler regression suites exercising asynchronous device providers. All 125 server tests pass locally.

Runtime activation remains pending: the check-in scheduler and Ops assignment synchronization still require adaptation before the service runner can select PostgreSQL devices. This is not a hosted deployment or physical-device verification.

The check-in worker now awaits schedule pages, coalesces concurrent sweeps, records database-read failures without advancing its cursor, and waits for in-flight reads on shutdown. A stopped sweep cannot create missed-check-in records or move its cursor after the pending read returns. Queued timer callbacks after stop are ignored. Service startup/shutdown await the scheduler. All 127 server tests passed; focused scheduler checks also passed after adding queued-callback shutdown coverage. Ops assignment synchronization remains SQLite-specific and is the next runtime integration gate.

The Ops refresh worker now awaits assignment synchronization and binding revocation. Asynchronous database failures are counted as failures rather than successful imports. Shutdown drains an already-started synchronization, prevents later items in the batch from starting, and ignores queued timer callbacks. An already-started transaction may finish; stopping does not imply rollback. The new delayed-write and rejected-write regressions pass as part of the 129-test server suite. The PostgreSQL implementation of the synchronization ledger itself is still pending.

## PostgreSQL Ops synchronization ledger

`PostgresOpsAssignmentSync` now persists the source revision/digests, revocation watermark and append-only history in `mercury_guard`. Each operation holds a transaction-scoped advisory lock derived from the source ID, including first imports before a row exists. Replacement cancels the old assignment, inserts its immutable successor and records history in one transaction. Revocation uses that same lock so older concurrent imports cannot leave access active. A later explicitly approved binding revision can reopen a new assignment. Source parsing and digest preparation are shared with SQLite.

The local-only schema was applied, checked with advisors (no issues), exported as `20261023191157_guard_ops_sync.sql`, and replayed in a disposable database. Explicit grants keep the ledger private and history insert/select only for service_role. The generated migration's equivalent assignment-check constraint drop/re-add was removed to avoid unrelated churn; explicit revokes were retained. The real PostgreSQL verifier covers concurrent duplicate imports, failed-replacement rollback, retained original schedule, stale/conflicting updates, revocation races, reopen after a newer approval and denied history mutation. All 129 server tests pass. This adapter is not yet selected by the service runner.

Locking reference: https://www.postgresql.org/docs/current/explicit-locking.html . The Supabase September 25, 2026 minor-version changelog was reviewed; this addition uses none of its listed extension/custom-operator features.

## Local runtime composition

`MERCURY_IDENTITY_STORE=postgres node server/scripts/start-local-service.mjs` now selects PostgreSQL identity, devices, assignments and the Ops sync adapter together. SQLite remains the default. The assignment factory shares the restricted identity pool, checks required tables and fails closed without a storage fallback. Existing SQLite enrollment/assignment records are not automatically migrated. The Ops refresh worker is not yet configured in the runner, so selecting PostgreSQL does not begin importing live Ops shifts.

The real local Auth/HTTP smoke now provisions synthetic PostgreSQL identity/site/device records, imports an assignment through the PostgreSQL sync adapter, signs in and proves device possession. It verifies replay rejection, denial of capture grants before confirmed start, confirmed start, RSA grant signature and guard/assignment/device scope, source cancellation, denial of new grants, explicit cancelled-shift closeout, device revocation and vendor suspension. Temporary identity, device, assignment and sync rows are removed afterward. The shift/grant/event stores in this test remain SQLite in memory; this is not a claim that their persistence has moved to PostgreSQL. 130 server tests pass.

## Opt-in recurring Ops refresh

The local runner now accepts `MERCURY_OPS_REFRESH=off` (default), `local`, or `remote`. Local mode reads synthetic shift rows from the isolated Supabase API using the local server credential. Remote mode requires explicit `MERCURY_OPS_URL` (HTTPS) and `MERCURY_OPS_SERVER_KEY` environment values; do not commit these values. It performs read-only GET requests for approved IDs only. No remote source has been enabled by this change.

Both modes load the existing local `ops-bindings.sqlite` approval store and use the selected assignment adapter. No approval is inferred from names or vendor IDs. An empty approval store imports nothing. Refresh runs immediately and every 30 seconds, reports aggregate failures, and drains before database shutdown. Outbound dashboard delivery remains disabled. Hosted approval administration and moving the approval store itself into PostgreSQL remain outstanding.

Verification: 132 server tests passed. A separate real local REST/Auth smoke started the recurring composition with a one-second test interval and verified that an upstream synthetic cancellation reached the assignment endpoint without an explicit refresh call. The timer was drained and temporary local table/Auth records removed. Hosted Ops was untouched.

## Shared Ops approvals

PostgreSQL mode now loads approvals from private `mercury_guard.ops_bindings` and append-only `ops_binding_history`; SQLite mode retains its local approval file. Both adapters share canonical input validation, reject unexpected fields, require explicit guard/vendor/site/Auth bindings and retain exact-retry/revision rules. PostgreSQL serializes approval writes to enforce the 1,000-mapping bound across instances and commits current state with its audit record. Operator labels remain audit context, not administrator authentication; no public approval endpoint has been exposed.

The exported `20261023191943_guard_ops_bindings.sql` migration was replayed successfully. Tests cover concurrent exact retries, restart visibility, immutable audit permissions, audit-failure rollback, competing inserts at capacity, and refresh composition using PostgreSQL approvals and assignments together. Advisors found no issues; 132 server tests pass.

Migration review also found a stray constraint drop in the prior Ops-sync export: the intended removal of an equivalent drop/re-add pair had removed only the add. The un-deployed migration source is corrected to preserve `assignments_check`. Replay now explicitly attempts invalid end times against the database and confirms rejection. The running local schema retained the original constraint; no hosted schema was changed.
