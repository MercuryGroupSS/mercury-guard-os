# PostgreSQL identity persistence

The private mercury_guard schema is the first PostgreSQL persistence layer for Mercury One. It has vendors, guards and guard_login tables. Vendor kind is company or individual; multiple guard rows may reference one vendor. Each guard has a unique real auth.users subject and a separate guard ID. Email login mappings are lowercase and unique. New vendor/guard entries default inactive.

Foreign keys restrict deletion of referenced vendors, guards and Auth accounts. RLS is enabled on all three tables. PUBLIC, anon and authenticated have no schema/table access. The service role has schema usage and SELECT/INSERT/UPDATE only, with no DELETE or TRUNCATE grant. No client-facing RPC, public view or permissive policy is added. Server-side authorization must still check both vendor and guard activation and verify the password session against the guard's Auth subject.

This schema is installed only in the isolated local Supabase instance. The existing runtime still uses the local SQLite directory; a PostgreSQL runtime adapter, authenticated administrative approvals and migration/deployment review are outstanding. The existence of tables does not make sign-in production-ready.

Validation: supabase/tests/guard-identity.sql creates synthetic records inside a rolled-back transaction and checks role privileges, RLS, company-to-many-guards, unique Auth subjects/login emails, reference integrity and preservation of individually disabled guards. The local Supabase advisors reported no warnings or errors. The installed CLI's db query command rejects multi-statement files, so SQL execution used psql inside the fixed local database container; the migration is exported using db pull rather than handwritten migration naming.

Generated migration: 20261023184633_guard_identity.sql. Local migration history is aligned. Explicit revokes were retained in the generated migration so a target with different default grants cannot accidentally broaden access. Migration replay and the same constraint/privilege tests passed in a separately created disposable PostgreSQL database with a minimal auth.users reference table; that verification database was removed. This is not a full production Auth migration test.

## Runtime directory adapter

`PostgresGuardDirectory` implements asynchronous guard lookup, vendor lookup and eligible login-account lookup with parameterized SQL. It accepts a server-owned pg client/pool and requires an independently supplied login-attempt limiter. It does not create connections, grant privileges or default to unlimited login. The login handler now awaits both limiter and directory calls, including its post-authentication mapping recheck. The existing synchronous SQLite adapter remains compatible.

The pg driver is pinned to 8.23.1 with a lockfile; installation ran without lifecycle scripts. `node server/scripts/check-local-postgres-directory.mjs` checks the real local PostgreSQL adapter under SET LOCAL ROLE service_role, including safe parameterized input, subject resolution, vendor suspension and awaited limiter results. Fixture identities are rolled back. That test uses a synthetic in-memory limiter; production requires durable shared throttling and appropriately configured TLS/connection credentials. The service runner still uses SQLite until that composition is ready.

## Shared login throttling

The directory now defaults to createPostgresLoginLimiter. Its private SECURITY INVOKER function uses database time and locks a global counter before updating the account counter. Limits match the local pilot: 100 attempts per minute across the service and five per guard hash in five minutes. Rejected account attempts still consume global capacity. Expired account rows are removed inside the transaction; no password, email or raw guard ID is stored in limiter buckets. A failed database call denies sign-in through the existing handler error path.

Migration 20261023185052_guard_login_throttle.sql adds RLS-protected counters and service-role-only function execution. Local advisors reported no issues. A disposable PostgreSQL database verified both generated migrations, two concurrent service-role connections, per-account/global limits, expiry and bounded counter growth; the database was removed. The directory smoke now uses the real limiter, with all fixture changes rolled back. The previous synthetic-limiter limitation is superseded. Hosted deployment and production connection configuration are still unverified.

## Opt-in local runtime

After installing locked server dependencies and applying local migrations, run `MERCURY_IDENTITY_STORE=postgres node server/scripts/start-local-service.mjs` to select PostgreSQL identity storage. Omission preserves the existing SQLite mode. Invalid modes or unavailable PostgreSQL/schema fail startup; they do not silently select SQLite. This local factory permits only the configured loopback Supabase API and database ports, disallows connection-string overrides, limits the pool to four clients with query/connection timeouts, and verifies the service_role session and required schema before returning a directory.

No existing service was restarted as part of this change. Device enrollment, assignments, events and other stores still use their existing local implementations; this switches identity only. Production TLS, deployment configuration and remaining persistence adapters are separate work.

`check-local-postgres-login.mjs` verified real loopback HTTP sign-in with real Supabase password authentication, PostgreSQL identity/pool/shared throttling, profile resolution and existing-session denial after vendor suspension. It removes only its synthetic identity/Auth rows and its hashed account bucket; the shared global throttle counter is intentionally retained. All 125 server tests pass.

## Continuous verification

The server workflow now runs a separate PostgreSQL 17 service job, installs locked dependencies without lifecycle scripts and replays the identity/throttle migrations into a disposable test database. It checks identity constraints, private role grants, concurrent per-account/global throttling and expiry. The shared verifier accepts a CI-only loopback test URL; hosted URLs are refused. CI bootstraps the three Supabase role names only in its fresh test service, without modifying existing roles. The test database is removed afterward. This job does not use repository secrets or connect to hosted Supabase. Workflow execution must be checked separately from local preflight success.
