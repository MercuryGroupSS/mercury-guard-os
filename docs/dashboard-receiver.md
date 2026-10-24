# Guard observation receiver

The receiver now persists immutable observation bodies and receipts in PostgreSQL. Its private `mercury_guard_receiver` schema has its own approved mappings and reasoned owner audit. It does not insert into Ops `public.shifts`, WhatsApp check-ins, compliance or billing tables. The existing Ops source was reviewed at `a5344005ef9843f6c1ab295735e1cd5239449d8f`; its WhatsApp ingest is not the Guard receiver.

`PostgresDashboardInbox` rechecks the current receiver mapping inside the transaction before storing or returning an earlier receipt. Mapping changes take an exclusive advisory lock; observation commits take the corresponding shared lock. This makes a completed revocation effective even when the HTTP handler previously loaded an active mapping. An observation already committing under that lock may finish before the revocation commits. Receipt status `stored_in_integration_inbox` proves inbox storage only. It does not claim Ops display, payroll processing or transferred photo bytes.

Exact retries return the original stored receipt. Changed raw bytes, altered attribution, mapping revisions, destination or upstream shift cannot rewrite an existing delivery ID. Concurrent duplicate inserts store one row. Receipts are returned only after the storage transaction commits. The integration service can select bindings and select/insert observations; it cannot approve mappings, update/delete observations or modify the owner ledger. Anonymous and ordinary authenticated roles have no schema access. Local development uses the existing test `service_role`; production still requires a reviewed server credential and deployment configuration.

## Local receiver and approval

The ordinary [configured HTTPS runtime](configured-service.md#optional-https-receiver) now supports an explicit optional `dashboard_receiver` private-file reference. Legacy omission or null stays disabled. Enablement composes these same PostgreSQL observation/media handlers behind the existing TLS/Host/Origin boundary and deployment identity. Its dedicated machine token never grants guard/admin access. The marker is rechecked on the same transaction client before persistence and before returning a receipt, including exact retries; drift during upload or after insertion rolls back without acknowledgement. Existing receiver mapping approvals remain mandatory and startup creates none. Protected Reports in the Guard console reads the same private inbox under current administrator authorization. Actual Ops application rendering remains a separate integration.

`node server/scripts/check-local-configured-receiver.mjs` verifies that runtime using a unique disposable database and actual loopback HTTPS. It passes default-off routes, separate machine/admin credentials, immutable observation/media receipts, mapping/session/admin revocation, same-transaction post-insert marker rollback and drift during a partially uploaded image. Auth HTTP is explicitly synthetic in this verifier; it is not real-provider evidence. Exact temporary database/private-file cleanup is required. Canonical PostgreSQL replay also includes this verifier. No destination, hosted service, existing app or real account is activated.

From the project root, `node server/scripts/start-local-dashboard-receiver.mjs --help` describes its required private environment settings. It binds only `127.0.0.1`, uses the isolated Guard local database, and does not automatically approve a mapping. The dedicated receiver token is separate from Supabase credentials and must not enter an APK, public file, URL or source control.

`node server/scripts/set-local-receiver-mapping.mjs --file PRIVATE_JSON` reviews an approval; add `--apply` to record it. The file must be a regular private file and contain exactly `requestId`, `mapping`, `operator`, `reason`. Mapping fields are `assignmentId`, `guardId`, `vendorId`, `siteId`, `dashboardShiftId`, `destination`, `revision`, `active`. Use a fresh UUID per change and advance revision. Retry an uncertain request with the identical UUID and contents. A stale exact retry returns its original historical receipt without undoing a newer revocation. Approval requires the local database owner and records mapping/history atomically. The owner must verify the intended upstream ID; this local command does not establish a live Ops connection or infer identities from names or Vendor IDs.

The Guard sender mapping and the receiver mapping are independent approvals. This preserves individual guard attribution when a company Vendor ID represents several people.

## Opt-in sender

The local PostgreSQL service continues with sending off by default. To enable explicitly configured HTTPS routes, set `MERCURY_DASHBOARD_DELIVERY=on` and `MERCURY_DASHBOARD_DELIVERY_CONFIG` to a private regular JSON file:

```json
{
  "version": 1,
  "destinations": [{
    "destination": "approved-ops",
    "endpoint": "https://receiver.example.invalid/v1/mercury-one/observations",
    "mediaEndpoint": "https://receiver.example.invalid/v1/mercury-one/media",
    "token": "REPLACE_WITH_A_PRIVATE_DEDICATED_RECEIVER_TOKEN"
  }]
}
```

This is an example, not an enabled destination. Configuration is bounded, exact and rejects symlinks or group/world-readable files. Each destination binds its own endpoint and bearer credential. The router checks the immutable queued body/hash before selecting the route and rejects unknown destinations before network transmission. Redirects, insecure production URLs and mismatched receipts are rejected. Synthetic SQLite mode cannot enable this sender. Local HTTP is available only as an explicit test fixture option; the actual runtime configuration requires HTTPS.

## Verification

`node --test server/*.test.mjs`: 170 tests passed. `node server/scripts/check-local-postgres-limiter.mjs` replays migrations and exercises a sender and receiver in separate disposable PostgreSQL databases over actual loopback HTTP. It verifies concurrent retries, receiver-pool restart, original receipts, changed-body conflict, independent approvals, revocation between the preliminary read and commit, forced-audit rollback, restricted grants and unchanged synthetic business-table sentinels. Both disposable databases are removed.

`node server/scripts/check-local-dashboard-receiver.mjs` runs the actual local receiver process and owner CLI, tests review/apply, receipt recovery after process restart, revocation and stale approval retry, then removes only its unique synthetic rows and private temporary input. It passed. Migration `20261023222717_guard_dashboard_receiver.sql` was exported from the local database, reviewed, replayed in disposable databases and aligned with local migration history. Final advisors reported no warning/error findings; private-schema RLS without public policies and unused test indexes remain intentional informational notices.

Current official references used: [Supabase role separation](https://supabase.com/docs/guides/database/postgres/roles), [PostgreSQL transaction locks](https://www.postgresql.org/docs/17/explicit-locking.html).

## Still required

Protected presentation now exists in the Guard administration console. Actual Ops presentation, approved real source/destination credentials and mappings, production TLS/deployment and physical acceptance remain open. No hosted database, application, existing repository or phone was changed by this receiver work.

## Private photo delivery

Photo observations retain their original immutable `media_delivery: not_transferred` snapshot. Current delivery state is held separately. A PostgreSQL media worker claims only photo observations whose metadata was accepted by the receiver, whose original sender mapping remains active, and whose exact source bytes have arrived. It validates the original body/hash and image byte hash/length. Exclusive expiring leases, backoff and a separate receipt survive worker restarts; a stale attempt cannot acknowledge or release a newer lease. The runtime rechecks the mapping immediately before selecting the configured media route. Missing `mediaEndpoint` configuration leaves media sending disabled.

`POST /v1/mercury-one/media/<delivery_id>` uses the dedicated destination credential and `image/jpeg`, accepts at most the approved metadata's byte count (maximum 20 MiB), and requires the prior stored photo observation. It independently rechecks its current mapping within the byte-storage transaction, including retries. Exact retries return the original `media_stored_in_integration_inbox` receipt, bound to delivery/destination/event/evidence IDs, SHA-256 and length. Wrong bytes and revoked mappings are rejected. Bytes and their receipt commit together in a private PostgreSQL table. There is no public download URL or anonymous read route. This verifies byte identity and storage; image decoding/display and physical capture acceptance remain separate checks.

Migration `20261023224043_guard_dashboard_media.sql` adds independent media retry/receipt fields and the private receiver media table. Its marked receiver-only section can be reviewed without applying the sender schema. Complete replay passed. The projected-photo validator now restores the fixed local capture discriminator internally; it preserves the wire format and accepts valid queued photo metadata without exposing capture-grant fields.

Integration checks used a signed source photo-byte fixture, transferred it over HTTP between independent PostgreSQL databases, compared the stored bytes, retried concurrently across receiver restart, rejected incorrect/false receipts and stale leases, and denied both observation and byte retries after a revocation committed during upload. The actual local receiver process/owner CLI smoke also passed separate photo receipts across process restart and removed its own fixtures. These synthetic byte fixtures do not replace viewing real camera images on the Fold and in the protected operations interface.


## Protected report viewing

The Guard administration service provides a current-session/admin-protected `received_reports` catalog and `/v1/admin/media/<delivery_id>` JPEG read. The catalog keeps exact original attribution and independent photo state. Check-in images link only across the exact original device/evidence/scope/mapping. Reads check immutable observation/receipt hashes and private byte identity; mapping withdrawal preserves historical administrator audit. The browser decodes a generated synthetic JPEG and removes its object URL on navigation, session loss or sign-out. This local console does not alter or establish rendering in the existing Ops Dashboard. See [administration](administration.md).
