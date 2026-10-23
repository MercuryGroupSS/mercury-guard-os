# PostgreSQL device and assignment persistence

Migration 20261023185827_guard_device_assignments.sql adds private sites, devices, assignments and device_challenges tables under mercury_guard. It is applied only to isolated local Supabase. No existing dashboard, billing or HR table is changed.

Assignments reference the guard/vendor pair and a site. Device enrollment references either a site or a personal guard, never both. Thumbprints are unique, revocation versions and millisecond times are bounded to JavaScript safe integers, schedules have positive duration, and each subject/device pair has at most one active challenge. Expiry and foreign-key indexes support the expected lookups.

All tables have RLS and no anonymous/authenticated access. Server-role column grants permit assignment cancellation and device revocation fields but not rewriting assignment identity/schedule/policies or enrolled key/binding. Public-key format checks do not prove a valid P-256 key or possession: those still require cryptographic service validation. Revocation-version monotonicity and single-use challenge consumption must be enforced by the runtime transaction adapter. Patrol/check-in JSON has structural/size bounds; detailed policy validation remains in the service.

The transactional SQL tests check scope mismatch, ambiguous device binding, challenge uniqueness, RLS and server-role column permissions, then roll back fixtures. The generated migration replays in the disposable PostgreSQL verifier, and local advisors report no issues. The CI PostgreSQL job now includes this migration and its tests. Runtime device/assignment operations still use SQLite pending the asynchronous PostgreSQL adapter.

## Transactional adapter verification

`PostgresDeviceAssignments` now implements enrollment, revocation, assignment cancellation, device challenges, scoped assignment listing, authority lookup, and bounded schedule reads. Challenge consumption locks the challenge row and deletes it within the same transaction as the assignment projection. A failed signature rolls back without consuming the challenge. Site handsets additionally require an active site. Enrollment key parsing is shared with the SQLite adapter.

The disposable PostgreSQL verifier now exercises real service-role connections: simultaneous use of one signed challenge yields exactly one success; replacement, wrong subject, invalid signature rollback, expiry, site scope, cancellation, disabled sites, revocation, and personal-device ownership are checked. The disposable database is removed afterward. HTTP assignment, evidence, and ingestion handlers now await device lookups and authorization, with the handler regression suites exercising asynchronous device providers. All 125 server tests pass locally.

Runtime activation remains pending: the check-in scheduler and Ops assignment synchronization still require adaptation before the service runner can select PostgreSQL devices. This is not a hosted deployment or physical-device verification.
