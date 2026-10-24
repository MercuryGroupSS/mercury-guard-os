# Configured HTTPS service and local pilot

For the separate serverless platform adapter, see [Mercury One on Netlify](netlify-deployment.md). The direct TLS entry point described here retains its own configuration and listener checks.

The configured entry point composes the existing Guard PostgreSQL, individual Auth, current-session, device, shift, grant, consent, escalation and administration handlers behind direct HTTPS. It accepts explicit private runtime files and existing approvals. It does not deploy a server, apply migrations, generate production keys, discover credentials, create accounts or approve a phone. The existing local launcher remains unchanged.

## Required inputs

An owner supplies an approved deployment UUID, canonical HTTPS origin and listener, the matching TLS certificate chain/private key, an RSA issuer key of at least 2048 bits, issuer/audience/key ID, Auth origin and API keys, and a PostgreSQL connection. The target must already have the canonical Guard migrations and an owner-installed deployment identity. Real account email delivery, release signing, retention/backups and operational response rules remain separate activation requirements.

| Mode | Enforced boundary |
| --- | --- |
| `isolated_local_pilot` | HTTPS origin and listener are loopback; Auth is exactly `http://127.0.0.1:55321`; PostgreSQL is loopback port 55322. This is the owned local stack, with synthetic data and no new hosting charge. |
| `configured` | Auth uses HTTPS. PostgreSQL verifies TLS certificates, using the supplied CA file or system trust. There is no URL query/SSL-disable override. The origin/listener and all credentials are explicitly supplied. |

Runtime JSON and private keys must be bounded regular files owned by the process user, with no group/other permissions and no leaf symlinks. Use absolute paths. Keep them outside Git, APK assets, logs and public build artifacts. Certificate/CA files are public material but still must be bounded regular files. TLS material must match the approved hostname/IP, validity period and private key. Those checks do not prove public CA trust, DNS, firewall reachability or Android trust. The ordinary APK requires a certificate its platform trusts; the synthetic test certificate is not phone provisioning.

The exact runtime shape follows below. Every placeholder needs an approved value; replace `PORT_AS_INTEGER` with a JSON integer. This template is deliberately not runnable. Optional source/destination integration stays `null` until explicitly configured.

```json
{
  "version": 1,
  "mode": "configured",
  "deployment_id": "DEPLOYMENT_UUID",
  "public_origin": "APPROVED_CANONICAL_HTTPS_ORIGIN",
  "listen": {"host": "APPROVED_BIND_IP", "port": "PORT_AS_INTEGER"},
  "auth": {
    "origin": "APPROVED_AUTH_ORIGIN",
    "publishable_key": "PUBLISHABLE_KEY",
    "server_key": "SERVER_ONLY_AUTH_KEY"
  },
  "database": {"url": "APPROVED_POSTGRESQL_URL", "ca_path": null},
  "issuer": {
    "issuer": "APPROVED_ISSUER",
    "audience": "APPROVED_AUDIENCE",
    "key_id": "APPROVED_KEY_ID",
    "private_key_path": "/ABS/PRIVATE/issuer-private.pem"
  },
  "tls": {
    "certificate_path": "/ABS/PRIVATE/certificate-chain.pem",
    "private_key_path": "/ABS/PRIVATE/tls-private.pem"
  },
  "ops_refresh": null,
  "dashboard_delivery": null,
  "dashboard_receiver": null
}
```

The public origin has no path, query, fragment or credentials. Its port must match the listener; no implicit proxy trust is used. PostgreSQL URLs also reject query/fragment overrides. If needed, `database.ca_path` is an absolute CA-file path. Configured Auth keys are server inputs and never part of the Android public configuration.

An approved optional `ops_refresh` object has exactly `origin`, `server_key`, `interval_ms`; it reads only approved Ops bindings. An approved optional `dashboard_delivery` object has exactly `configuration_path`, `interval_ms`; its private destination file follows [receiver delivery configuration](dashboard-receiver.md). Intervals must be explicitly supplied integers from 1000 through 3600000 milliseconds. These protocol bounds are not a recommended operating cadence. No observation/media sending or remote Ops reads start when these fields are null. The private projection/check-in workers still run after explicit service activation.

## Optional HTTPS receiver

`dashboard_receiver` is independently disabled when omitted or null. To enable the Guard integration inbox on this same strict HTTPS listener, supply exactly `{"configuration_path":"/ABS/PRIVATE/receiver.json"}`. That private file must contain exactly `version`, `destination` and `token`, for example `{"version":1,"destination":"APPROVED_DESTINATION_ID","token":"SUPPLIED_DEDICATED_RECEIVER_TOKEN"}`. The example is not a usable credential. The file uses the same bounded, owner-private, regular-file/no-leaf-symlink checks. Its token must be 32–4096 printable non-space ASCII characters and differ from the configured Auth and Ops server keys. Keep it out of Android assets, source, URLs, public records and browser pages. Changing the file does not rotate a running process; drain and restart with reviewed inputs.

Explicit enablement exposes only `POST /v1/mercury-one/observations` and `POST /v1/mercury-one/media/DELIVERY_ID` using the existing bounded handlers. The machine credential supplies no guard or administrator access and no media GET route. Receiver mappings must already be independently approved in the private receiver ledger; startup creates none. The original sender approval is a separate requirement. Protected Reports/JPEG access continues to require the existing current individual administrator session.

The runtime checks its deployment marker on entry. The receiver also checks that exact identity inside the storage transaction before work and before returning its original/new receipt, including media metadata and exact retries. Drift during a body upload or a failed post-insert check prevents acknowledgement and rolls back that transaction. Existing mapping locks and revocation checks remain in place. Work can finish after its last successful check; drain before changing deployment identity or restoring a backup. This is a configured Guard inbox, not an Ops Dashboard deployment or proof of rendering there.

## Bind this database to this deployment

Migration `20261024011341_guard_deployment_identity.sql` creates a private RLS table with one permitted singleton row. Public/anonymous/authenticated roles have no access. The service role can only read it; it cannot insert, update, delete or truncate it. Applying the migration creates no deployment row.

`--inspect` prints seven public identity fields: `deployment_id`, `auth_origin`, `public_origin`, `issuer`, `audience`, `issuer_key_id`, `issuer_spki_sha256`. After reviewing the target database and these values, the database owner installs the exact row, with an identified `approved_by` and reason. Do not infer ownership from an existing database name or automatically adopt an old marker. A missing or mismatched row prevents startup. Runtime PostgreSQL operates as `service_role` and also requires the full schema, consent insertion order and limited current Auth-session reads.

The marker is checked for HTTP requests, worker entry points, Ops reads/mutations and immediately before observation/media sends. A mismatch blocks subsequent checked work. This does not undo a transaction/send that already passed its check. Drain the old process before changing the marker, issuer keys, Auth origin or deployment. Preserve the prior configuration, approvals and records for recovery. This is an owner-managed deployment binding, not an automatic key-rotation or provisioning system.

## Inspect, check and explicitly start

```sh
node server/scripts/start-configured-service.mjs --inspect /ABS/PRIVATE/runtime.json
node server/scripts/start-configured-service.mjs --public-config /ABS/PRIVATE/runtime.json APPROVED_DEVICE_ID
node server/scripts/start-configured-service.mjs --check /ABS/PRIVATE/runtime.json
node server/scripts/start-configured-service.mjs --serve /ABS/PRIVATE/runtime.json
```

Inspect/public-config read local files only. Public-config emits exactly the public Android service fields, including issuer SPKI; it includes no Auth key, password, database URL or private key. Enrollment/device approval remains separate. See [APK service configuration](service-configuration.md).

Check verifies database/schema/identity and required Auth settings without listening or starting workers. It does not establish mailbox delivery, real-user onboarding, live Ops rendering, TLS client trust or hardware acceptance. Serve explicitly starts the HTTPS listener, check-in reconciliation, private projection and any configured optional integration. Strict Host/Origin checks reject other origins and forwarded/rewrite headers; this entry point does not trust a reverse proxy's headers or directly implement Netlify Functions.

SIGINT/SIGTERM request a drain. The listener stops new work, closes remaining sockets after 15 seconds and awaits existing handlers/workers before closing the pool. Fifteen seconds is not a hard total shutdown deadline. Startup interrupted by shutdown cannot continue into a listener/worker, and a closed service/runtime object rejects another start. Preserve originals after an unconfirmed shutdown; do not clear data or replace keys to recover.

For rollback, stop and drain the new process first. Review compatibility, then restore the previous reviewed runtime/TLS/issuer files and their matching owner-installed marker; check before restarting. Retain additive migrations, original observations/receipts and installation keys. Do not drop tables, reset app data or overwrite an old queue to roll back a service binary. A rollback is not confirmed until the prior service checks and original-scope receipt behavior pass again.

## Verification and remaining acceptance

The focused Node tests exercise strict configuration/files/keys, exact deployment matching, verified database TLS options, audience consistency, real loopback TLS Host/Origin handling and startup/shutdown races. The full canonical PostgreSQL replay includes an independently isolated configured-service verifier: TLS, real PostgreSQL/current-session rows, individual/device/shift/custom-audience proofs, consent challenge, marker privileges/drift and worker/send/lifecycle regressions. That verifier deliberately injects a synthetic Auth HTTP provider; it is not live Auth evidence.

A separate actual local-provider gate is available:

```sh
MERCURY_CONFIGURED_REAL_AUTH=synthetic-only node server/scripts/check-configured-real-auth.mjs
```

It requires the owned loopback stack and an empty deployment marker, claims an exclusive private ownership file before creating accounts, and uses only temporary synthetic approvals/materials. It passed actual local Supabase Auth through direct configured application/TLS composition: two independent sessions, logout preserving the second, PostgreSQL session revocation denying the old token, and exact cleanup. It does not compose/start global workers or change existing worker cursors. The global limiter is preserved. An unconfirmed cleanup retains recovery metadata; do not delete another run's ownership file or adopt an existing marker.

These gates leave no running deployment or approved real owner/phone. The v0.35 source `eccb469ef072a17b614677da664ad9c809a8e519` passed all seven GitHub jobs on the first attempt: 237 Node tests, canonical PostgreSQL replay, Android build, API 28/API 35 and both HTTPS jobs. Its separate controlled release proof verifies synthetic signing/configuration and prior-APK compatibility; it does not establish live activation or phone data recovery. See [local logical recovery](recovery-readiness.md) and the [bounded capacity baseline](capacity-baseline.md) for the separate operational drills. Real deployment credentials, public trust/reachability, email, actual Ops exchange, release/update recovery and [attended Fold acceptance](fold-acceptance-v0.35.md) remain open. SDK GNSS and full-shift battery/Doze behavior are not established by typed emulator samples.
