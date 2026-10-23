# Mercury One administration

The local PostgreSQL service exposes the Mercury One console at `/admin/` and authenticated administration at `/v1/admin/*`. First real administrator setup, account provisioning and recovery remain pending. No hosted membership has been created.

## Console workflow

Start the local service with `MERCURY_IDENTITY_STORE=postgres node server/scripts/start-local-service.mjs` and open `/admin/` at the printed loopback origin. The white/cyan console provides administrator sign-in, nine paginated record catalogs, a filter for the current page, and forms for all supported actions. Row controls prefill the target IDs; revisioned mappings advance the previous approval revision. Patrol checkpoints can be approved independently of order. Timed check-in policy fields expose interval, response window, evidence freshness and GPS uncertainty.

Each change requires a reason and a review before submission. A confirmed receipt shows whether the request applied or closed without applying. After a connection failure or any response without a matching receipt, the console retains the exact request ID and body. It offers retry or resolution rather than silently submitting a second action. Resolution returns an existing receipt or saves a permanent not-applied receipt under the same transactional lock; a delayed apply cannot run after that closure.

The access token stays in tab memory. Requests omit cookies and reject redirects. Session expiry, sign-out, page hiding and server revocation clear the token and displayed private records. An unresolved request stays in memory for the same administrator to recover; another administrator cannot see its review details or submit it. Reloading or closing the tab loses the draft, so the browser warns about an attempted unconfirmed request. Inspect the audit before manually repeating a lost request. The console has no persistent browser credential store.

Static serving uses an exact asset whitelist with no-store, no-sniff, no-referrer and same-origin resource headers. CSP permits only same-origin scripts, styles and API connections, denies inline/evaluated scripts, framing, object content and external base URLs. Camera, microphone and location are disabled for this console. Database and server keys are never embedded in browser assets.

For an attended disposable browser test, `node server/scripts/open-local-admin-test.mjs` creates a temporary verified account only in isolated local Supabase. Its credentials are saved to a private ignored file, not printed. SIGINT/SIGTERM removes that account and its own vendor/guard/audit rows. It does not provision a real owner or enable live integration.

## Access model

An Auth access token must be validated by the configured Supabase Auth service, and its individual subject must have an active row in private `mercury_guard.admin_accounts`. Vendor ID, guard status, user-editable metadata and claimed client roles do not grant administration. The service cannot insert administrator membership or change its email/active flag. Bootstrap and revocation remain owner-controlled.

The service may update only an inert zero-valued `lock_marker` on membership rows. This provides the PostgreSQL permission needed for `FOR SHARE` without allowing membership changes. Every action locks and rechecks membership, token expiry and its request receipt before committing. Revocation therefore serializes with an already-running action and denies subsequent actions, including receipt retries.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/admin/login` | Exchange an approved administrator email/password for an access token. No refresh token is returned. Shared per-account/global login limits apply. |
| `GET /v1/admin/me` | Check current administrator membership. |
| `GET /v1/admin/catalog?kind=guards&after=...` | Read a page of at most 50 records. Kinds: vendors, guards, sites, devices, assignments, ops_bindings, dashboard_bindings, outbox, audit. |
| `POST /v1/admin/actions` | Apply a reasoned, idempotent, audited change. |
| `POST /v1/admin/resolve` | Send the identical action envelope to retrieve its saved receipt or close its request ID without applying. |

Protected requests use an Authorization bearer header. Responses use `Cache-Control: no-store`. There is no cookie-based authority or public self-enrollment route.

Action shape:

```json
{
  "request_id": "11111111-1111-4111-8111-111111111111",
  "action": "vendor.create",
  "reason": "Approved supplier onboarding",
  "payload": {"vendorId":"vendor-example","kind":"company","active":true}
}
```

Supported actions are `vendor.create`, `vendor.status`, `site.create`, `site.status`, `guard.link`, `guard.status`, `device.enroll`, `device.revoke`, `ops_binding.approve`, `dashboard_mapping.approve` and `dispatch.publish`. Payload fields match the existing server adapters; unexpected fields are rejected. Guard linking takes an existing Auth subject and matching email. Active linking/reactivation verifies the current Auth account and confirmed email. This does not yet create Auth accounts or implement password recovery.

A company vendor can link to several individually authenticated guards. Guard IDs and Auth subjects remain separate from the company Vendor ID. Public installation keys may be approved through device enrollment; private keys remain on the handset.

## Audit and retry rules

Actions and their append-only `admin_audit` record commit in one PostgreSQL transaction. The audit binds the verified actor, action, reason, payload digest, request ID and saved receipt. An identical retry returns the original receipt. Changing a request ID's actor or content returns a conflict; it cannot reuse or expose another actor's receipt. Sign-in passwords are not included in audit requests.

Ops binding withdrawal also cancels its current imported assignment and records a revision watermark in that transaction. Active approvals are imported by the configured refresh worker. Dashboard mapping withdrawal blocks subsequent send attempts; it cannot recall an in-flight HTTP request.

## Verification

146 server tests passed. Real disposable PostgreSQL checks covered company-to-many guard linking, explicit membership, concurrent exact retries, apply-versus-resolution races, delayed apply after not-applied closure, immutable audit privileges, and nested rollback of vendor status, enrollment revocation, Ops mapping/cancellation, dashboard mapping and dispatch publication. Real local Auth/HTTP checks verified metadata-role denial, administrator password sign-in, guard activation against Auth, console asset isolation, catalogs, request resolution, mapping withdrawal and existing-session denial after membership revocation. Migration/advisor verification passed locally.

Rendered browser checks verified sign-in, company creation, individual Auth guard linking, review/receipt display, the audit catalog, rejected-target resolution and subsequent new changes, and active-session revocation with cleared private views and explicit feedback. The browser's native fetch receiver binding and stale success feedback on revocation were corrected. All temporary accounts, memberships and fixture rows were removed. This verifies the local console, not hosted owner access or physical-device behavior.

Production hosting, owner bootstrap, account provisioning/recovery, release-key distribution, retention and physical acceptance remain open.
