# Mercury One administration API

The local PostgreSQL service now exposes authenticated administration at `/v1/admin/*`. The console UI and first real administrator setup are still pending. No hosted membership has been created.

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

137 server tests passed. Real disposable PostgreSQL checks covered company-to-many guard linking, explicit membership, concurrent exact retries, immutable audit privileges, and nested rollback of vendor status, enrollment revocation, Ops mapping/cancellation, dashboard mapping and dispatch publication. Real local Auth/HTTP checks verified metadata-role denial, administrator password sign-in, guard activation against Auth, catalog access, mapping withdrawal and existing-session denial after membership revocation. Temporary accounts and memberships were removed. Migration/advisor verification passed locally.

Production hosting, owner bootstrap, administrator UI, credential recovery, release-key distribution, retention and physical acceptance remain open.
