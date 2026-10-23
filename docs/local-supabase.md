# Local Supabase — verified 2026-10-23

Isolated project: mercury-guard-os-local. No cloud project link, production change, or paid hosting was created.

- Studio: http://127.0.0.1:55323
- API/Auth: http://127.0.0.1:55321
- Database: local port 55322, PostgreSQL 17.11
- Local test mail: http://127.0.0.1:55324
- CLI pinned to 2.122.0 in server/package.json and package-lock.json.

From the work directory, use `node server/scripts/start-local-stack.mjs` to start the isolated stack. This helper applies and verifies loopback-only Docker port bindings. Use `--status` for a read-only check or `--restart` to apply local settings while preserving volumes. Docker Desktop must be running. Do not substitute a bare Supabase start: the CLI default can publish ports on every interface. The generated supabase-start.log contains local development credentials; it is ignored and must never be committed or included in review bundles. Use synthetic data only. No production credentials are installed.

Verification: database query confirmed auth.users; Auth health endpoint responded; server/scripts/check-local-auth.mjs creates a synthetic account, signs in, verifies identity, checks invalid-token rejection, and deletes the account. This verifies local Supabase Auth, not the Android integration or a hosted dashboard login.

Current PostgreSQL mode includes shared identities, enrollment/assignments/grants, scoped observations and evidence, administration, account setup/recovery and opt-in dashboard observation/private-media delivery. See the [current brief](project-brief.md) and [receiver guide](dashboard-receiver.md). The runner defaults to PostgreSQL; explicit SQLite mode remains a synthetic fixture. Live source/destination configuration, release and physical acceptance remain open. Historical v0.24 details follow.

## Connected local pilot service (v0.24)

The server now verifies access tokens against local Supabase Auth, loads an explicit authorization row from public.guard_authorizations with a server-only key, validates its scope/lifetime, and ingests signed v2 batches into durable local SQLite. No client can read or write authorization rows. One current device/assignment per Auth subject is supported in this pilot. No automatic enrollment or grant issuance exists.

Run `node server/scripts/check-local-roundtrip.mjs` from the project directory for an actual loopback HTTP test. It provisions a temporary synthetic account and authorization, signs a P-256 incident, sends it through the service, restarts it, retries without duplication, revokes the authorization, confirms rejection, and removes the test account (cascading the authority row) and test database. Do not use production data.

Run `node server/scripts/start-local-service.mjs` to run the service on a printed ephemeral loopback port. Stop with Ctrl+C. Credentials are read from the ignored local startup log, never printed by these scripts. The service writes to ignored .local-backend/events.sqlite; this is a plaintext synthetic-data pilot store. It is not a deployable Netlify/Supabase production service.

Migrations are CLI-generated and local only. Security advisors found no issues. Verification confirms RLS enabled, anonymous reads denied, and authenticated inserts denied. Server role privileges narrowed to SELECT/INSERT/UPDATE/DELETE.

Android v0.24 adds HTTPS transport and strict pilot-receipt matching tests. It does not call the local cleartext service or clear the demo outbox. Live phone integration still requires scoped capture persistence, sign-in UI/session lifecycle, enrollment/grant issuance, inbound assignment transport and trusted HTTPS. No real Ops Dashboard data or hosted credential is copied here.
