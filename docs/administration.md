# Mercury One administration

The local PostgreSQL service exposes the Mercury One console at `/admin/`, personal account setup/recovery at `/account/`, and authenticated administration at `/v1/admin/*`. An owner-only local command provisions or revokes administrator membership for a verified individual account. A real owner email/account has not been selected. No hosted membership or email transport has been created.

## Local startup

Run `node server/scripts/start-local-stack.mjs --restart` to apply local Auth/template settings while preserving data. The helper checks the exact Guard project, uses a dedicated Docker network, and limits its child CLI's Docker create commands to Guard containers. Every configured published port is explicitly bound to `127.0.0.1`; the effective Docker bindings are checked afterward. An unsafe result stops only Guard's local stack with its volumes preserved. No global Docker or Mac network settings are changed. Use `--status` for read-only port verification and private credential refresh.

The CLI's ordinary start output is a human-readable table even with JSON requested. The helper reads structured status separately and saves the normalized runtime configuration to owner-readable `supabase-start.log`; raw diagnostics and the scoped Docker helper stay inside ignored `.local-backend`. Runtime keys and passwords must never be committed or packaged. The local runner now defaults to PostgreSQL. `MERCURY_IDENTITY_STORE=sqlite` remains an explicit synthetic protocol mode without this account portal.

## Personal account setup and recovery

The account page requests an 8-digit email code, then accepts the code and a new 12–128-character password together. Codes expire after ten minutes and work once. Setup may create an unconfirmed Auth account; recovery uses `create_user=false` and gives the same generic response for an unknown email. Both routes share account/global throttling. The local service requires email confirmation to be enabled before exposing the flow.

The server exchanges the code through the publishable Auth API, remotely verifies the resulting session and exact confirmed email, changes only that user's password, and signs out all sessions. No password, OTP or Auth token is stored in Guard's tables; no access or refresh token is returned to the page. The final result contains the individual's Account ID and email for approved roster linking. It grants no guard, vendor, device, assignment or administrator role. New owner activation remains a separate private command.

The page clears credential inputs before sending and on backgrounding, uses same-origin no-store requests and rejects redirects. A password-write timeout or an unconfirmed sign-out is displayed as an unknown outcome, with guidance to try the new password or request a fresh code. It never automatically retries a password write with a consumed code. Shared-phone users are asked to decline browser password-saving prompts; browser password-manager behavior is outside the app's storage controls.

Android's configured account screens expose **Set up or reset password**. This clears the foreground guard session before opening only the configured HTTPS origin's `/account/` path, with no account identifier, token, query or fragment in the URL. An unconfigured preview still cannot request credentials or open an invented service.

Local emails are captured in Mailpit only. Production SMTP, sender/domain verification, hosted templates and real-user delivery have not been configured. Local account checks prove the flow, not delivery to a real person's mailbox. Supabase's free-tier template restrictions were reviewed; this continuation creates no paid service or hosted project.

`node server/scripts/check-local-account-portal.mjs` verifies the real local email/code/password round trip and removes its exact fixtures. `node server/scripts/open-local-account-test.mjs` opens an attended page with a disposable email and cleans up its own account/email on SIGINT/SIGTERM. Neither tool changes existing apps.

## Console workflow

Start the local service with `MERCURY_IDENTITY_STORE=postgres node server/scripts/start-local-service.mjs` and open `/admin/` at the printed loopback origin. The white/cyan console provides administrator sign-in, eleven paginated record catalogs, a filter for the current page, and forms for all supported actions. Row controls prefill the target IDs; revisioned mappings advance the previous approval revision. Patrol checkpoints can be approved independently of order. Timed check-in policy fields expose interval, response window, evidence freshness and GPS uncertainty. Administrators and their owner-controlled access history are visible as separate read-only catalogs.

Each change requires a reason and a review before submission. A confirmed receipt shows whether the request applied or closed without applying. After a connection failure or any response without a matching receipt, the console retains the exact request ID and body. It offers retry or resolution rather than silently submitting a second action. Resolution returns an existing receipt or saves a permanent not-applied receipt under the same transactional lock; a delayed apply cannot run after that closure.

The access token stays in tab memory. Requests omit cookies and reject redirects. Session expiry, sign-out, page hiding and server revocation clear the token and displayed private records. An unresolved request stays in memory for the same administrator to recover; another administrator cannot see its review details or submit it. Reloading or closing the tab loses the draft, so the browser warns about an attempted unconfirmed request. Inspect the audit before manually repeating a lost request. The console has no persistent browser credential store.

Static serving uses an exact asset whitelist with no-store, no-sniff, no-referrer and same-origin resource headers. CSP permits only same-origin scripts, styles and API connections, denies inline/evaluated scripts, framing, object content and external base URLs. Camera, microphone and location are disabled for this console. Database and server keys are never embedded in browser assets.

For an attended disposable browser test, `node server/scripts/open-local-admin-test.mjs` creates a temporary verified account only in isolated local Supabase. Its credentials are saved to a private ignored file, not printed. SIGINT/SIGTERM removes that account and its own vendor/guard/audit rows. It does not provision a real owner or enable live integration.

## Access model

An Auth access token must be validated by the configured Supabase Auth service, and its individual subject must have an active row in private `mercury_guard.admin_accounts`. Vendor ID, guard status, user-editable metadata and claimed client roles do not grant administration. The service cannot insert administrator membership or change its email/active flag. Bootstrap and revocation remain owner-controlled.

The service may update only an inert zero-valued `lock_marker` on membership rows. This provides the PostgreSQL permission needed for `FOR SHARE` without allowing membership changes. Every action locks and rechecks membership, token expiry and its request receipt before committing. Revocation therefore serializes with an already-running action and denies subsequent actions, including receipt retries.

PostgreSQL service requests also check the remotely verified token's exact `session_id` and individual subject against current `auth.sessions`. A missing, deleted, mismatched or expired session is denied even while the JWT itself has time remaining. Password-session exchanges use the same check. Only session ID, subject and expiry columns are granted to the private service role; no refresh credentials, browser grants or Auth mutation rights are added. Startup fails if these minimum reads are unavailable. Already-authorized in-flight domain transactions are not serialized with a concurrent Auth sign-out. Synthetic SQLite/protocol fixtures retain their separate remote-token-only composition.

## Local owner setup

An existing individual Auth account must have a confirmed email and no current ban/deletion before activation. The owner command checks it remotely, then locks/rechecks its authoritative Auth row before committing membership and a separate `admin_membership_audit` receipt in one transaction. No password is accepted, generated or saved by this command. It is not imported into the HTTP service. Only the local `postgres` owner role may execute it; the service cannot write membership or its access audit. Operator labels are audit context, not authentication.

From the repository root, review an explicit local change with:

```sh
node server/scripts/set-local-admin.mjs --email owner@example.invalid --active true --operator "Local owner" --reason "Approved owner setup" --request-id 11111111-1111-4111-8111-111111111111
```

Use the actual approved email and a fresh request UUID. The command resolves only that exact email and refuses ambiguous accounts unless an explicit `--subject` is supplied. Add `--apply` with the identical fields to execute the reviewed change. Use `--active false` with a new request ID and a reason to revoke the matching existing membership. Revocation can remove the last active administrator; the private owner command remains the recovery path.

An identical request ID returns its original historical receipt. It never reapplies that historical state after a later revocation. Changed fields with the same ID are rejected. Keep the request ID when recovering from an uncertain command response. Check the current Administrators catalog separately from an old receipt. Real owner activation is pending the user's administrator email and verified account.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/admin/login` | Exchange an approved administrator email/password for an access token. No refresh token is returned. Shared per-account/global login limits apply. |
| `GET /v1/admin/me` | Check current administrator membership. |
| `GET /v1/admin/catalog?kind=guards&after=...` | Read a page of at most 50 records. Kinds: administrators, access_audit, vendors, guards, sites, devices, assignments, ops_bindings, dashboard_bindings, outbox, audit. |
| `POST /v1/admin/actions` | Apply a reasoned, idempotent, audited change. |
| `POST /v1/admin/resolve` | Send the identical action envelope to retrieve its saved receipt or close its request ID without applying. |
| `POST /v1/account/code` | Request a setup/recovery code for an individual email; recovery does not disclose account existence. |
| `POST /v1/account/password` | Verify the email code, set the personal password and sign out sessions; returns no tokens. |

Protected administrator requests use an Authorization bearer header. Responses use `Cache-Control: no-store`. There is no cookie-based authority or public administrator, guard-role, device or assignment self-enrollment route. Personal Auth account setup is separate from those approvals.

Action shape:

```json
{
  "request_id": "11111111-1111-4111-8111-111111111111",
  "action": "vendor.create",
  "reason": "Approved supplier onboarding",
  "payload": {"vendorId":"vendor-example","kind":"company","active":true}
}
```

Supported actions are `vendor.create`, `vendor.status`, `site.create`, `site.status`, `guard.link`, `guard.status`, `device.enroll`, `device.revoke`, `ops_binding.approve`, `dashboard_mapping.approve` and `dispatch.publish`. Payload fields match the existing server adapters; unexpected fields are rejected. Guard linking takes an existing Auth subject and matching email, which the individual can obtain through the account page. Active linking/reactivation verifies the current Auth account and confirmed email.

A company vendor can link to several individually authenticated guards. Guard IDs and Auth subjects remain separate from the company Vendor ID. Public installation keys may be approved through device enrollment; private keys remain on the handset.

## Audit and retry rules

Actions and their append-only `admin_audit` record commit in one PostgreSQL transaction. The audit binds the verified actor, action, reason, payload digest, request ID and saved receipt. An identical retry returns the original receipt. Changing a request ID's actor or content returns a conflict; it cannot reuse or expose another actor's receipt. Sign-in passwords are not included in audit requests.

Ops binding withdrawal also cancels its current imported assignment and records a revision watermark in that transaction. Active approvals are imported by the configured refresh worker. Dashboard mapping withdrawal blocks subsequent send attempts; it cannot recall an in-flight HTTP request.

## Verification

162 server tests passed. Real disposable PostgreSQL checks covered company-to-many guard linking, explicit membership, concurrent exact retries, apply-versus-resolution races, delayed apply after not-applied closure, immutable audit privileges, and nested rollback of vendor status, enrollment revocation, Ops mapping/cancellation, dashboard mapping and dispatch publication. They also verified current Auth-session subject/expiry/deletion checks and column-only privileges; owner-only setup, stale receipt isolation, Auth-state changes, audit rollback and access-audit read-only grants. Real local Auth/HTTP checks verified initially unconfirmed account denial, the owner CLI review/apply path, metadata-role denial, administrator password sign-in, guard activation against Auth, console asset isolation, catalogs, request resolution, mapping withdrawal and existing-session denial after owner revocation. Real provider sign-out denied the old token at Guard and admin APIs while an independent session remained valid. Migration/advisor verification passed locally.

The real Mailpit/Auth/HTTP round trip verified an initially unconfirmed signup, wrong-code denial, code-only email templates, one-time code use, password setup, no implicit roles, approved owner linking, recovery, invalidation of old access tokens, failure of the previous password, success of the replacement password, retained approved membership, shared account throttling and a generic unknown-recovery response without account creation. Fixtures and exact messages were removed. Browser rendering/code-request checks passed with no console warnings. Local Android APK/test APK, unit checks and lint passed; the updated account-link instrumentation awaits CI/device execution.

Rendered browser checks verified sign-in, company creation, individual Auth guard linking, review/receipt display, the audit catalog, rejected-target resolution and subsequent new changes, and active-session revocation with cleared private views and explicit feedback. The browser's native fetch receiver binding and stale success feedback on revocation were corrected. All temporary accounts, memberships and fixture rows were removed. This verifies the local console, not hosted owner access or physical-device behavior.

The migrations for private application tables were exported after local advisory checks. The column-only cross-schema Auth grant was created with the CLI migration command because it is not emitted by the private-schema diff; it was applied locally, recorded and replay-tested explicitly.

Production hosting, real email delivery and owner activation, release-key distribution, retention and physical acceptance remain open. References: Supabase [sessions](https://supabase.com/docs/guides/auth/sessions), [email authentication](https://supabase.com/docs/guides/auth/auth-email-passwordless), [local email templates](https://supabase.com/docs/guides/local-development/customizing-email-templates), Docker [published-port binding](https://docs.docker.com/engine/network/port-publishing/), and the [Mailpit API](https://mailpit.axllent.org/docs/api-v1/).
