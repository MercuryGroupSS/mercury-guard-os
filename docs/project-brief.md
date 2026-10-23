# Mercury One — current project brief

Updated 23 October 2026. The product is still in development. This brief describes the current state; the [complete development history](development-history-through-shared-delivery.md) and internal cumulative baseline remain preserved.

## Accepted scope

Deliver an ordinary native Android app for Galaxy Z Fold6, preserving Pixel portability. Use individual guard identities even when one Vendor ID represents a company employing several guards. Keep biometric handset unlock distinct from proof of a named guard. Integrate assignments and observations with Mercury Ops through explicit mappings. Develop dedicated-device management and firmware feasibility separately after the APK track.

Work is confined to MercuryGroupSS/mercury-guard-os. Existing applications and repositories are unchanged. Hosting charges were deferred in favor of isolated local Supabase tests. Current physical-device testing is deferred.

## Packaged app

The latest saved immutable package is Mercury One Preview v0.29, package `ca.mercury.guard.preview`, version code 29, built from source `4a341521f78e0a8b9f0ae7df692d1d05c0824fa9`. Its APK SHA-256 was rechecked as `fc6dfe7054debeb7438d9f275007e2cead081edcf007bab5b25f4876a4f5a9dc`. Its source ZIP contains 206 tracked files. This debug-signed, unconfigured preview does not include all subsequent backend changes and has not received current Fold acceptance.

The Android implementation includes the white Mercury One interface, particle sign-in face, individually authenticated assignments, encrypted offline records/photos/drafts, selectable patrol checkpoints, explicit shift start/end and cancellation closeout, signed scoped batches/grants, check-in evidence, dispatch version acknowledgements and clearer GPS/readiness feedback. Configured sign-in/enrollment screens now link to personal account setup/recovery at the same trusted HTTPS service origin, clearing credentials first. These features still require final configured-release and physical acceptance checks together.

## Backend now implemented and locally verified

PostgreSQL mode shares vendor/guard identities, approved device keys, assignments, Ops mapping approvals, confirmed shifts and idempotent transition/rejection receipts. It also shares capture grants, signed event/evidence records, check-in deadlines and scheduler state, dispatch versions/cursors, outbound mappings/history, queue leases/receipts and projection cursors. The local runner now defaults to PostgreSQL; SQLite remains an explicit synthetic protocol mode. Existing SQLite records are not automatically migrated by selecting PostgreSQL.

Auth tokens are verified remotely. Vendor/company identity does not substitute for individual guard authentication. Current roster, device, assignment and grant state is rechecked at operational commit boundaries. Revoked access cannot recover a receipt to bypass authorization.

The [administration console and API](administration.md) now support explicitly approved Auth administrators, bounded catalogs, reviewed reasoned mutations and append-only transactional audit. The white/cyan console can manage vendor/site status, link existing individual Auth accounts, approve/revoke devices and mappings, and publish scoped dispatch versions. Unconfirmed requests retain their exact ID/body and can resolve to the original receipt or a permanent not-applied closure. An owner-only local command provisions/revokes membership for a confirmed individual account with an atomic access-audit receipt. The console shows current administrators and access history. Personal account setup/recovery now verifies an emailed code, sets the user's password, and signs out sessions without returning tokens or granting roles. Real email transport and owner activation await configuration and the selected identity. No real administrator was activated during these tests.

Local Auth now requires email confirmation, a 12-character minimum password and 8-digit ten-minute codes. Mailpit captures local test messages only. A scoped startup helper enforces and inspects localhost-only published Docker ports, preserves volumes on restart, and stores runtime credentials privately. Existing hosted services, applications and global Docker/Mac network settings remain unchanged.

PostgreSQL requests now verify the token remotely and require its exact current Auth session to exist for the same individual subject and remain unexpired. Provider sign-out denies the old token immediately at the next Guard/admin request, independently of JWT expiry. The session reader uses three metadata columns; its new grants include no refresh credentials or Auth mutation rights. An already-authorized transaction may finish across a concurrent provider sign-out.

Recurring Ops reads are opt-in and use only explicitly approved shift IDs. Live reading/sending is not enabled. Isolated inbox receipts prove stored integration records; they do not prove Ops rendering, media transfer or payroll updates.

## Verification checkpoint

- 162 server tests pass.
- Disposable PostgreSQL migration replay and real concurrency/revocation/rollback/receipt tests pass, including audited administrator actions.
- Real local Supabase Auth and HTTP checks pass for sign-in, scoped assignments, confirmed shifts/grants, incident ingestion, dispatch acknowledgement, queue projection, administrator actions and revocation.
- Rendered console checks passed for sign-in, company creation, individual guard linking, reviewed changes, receipts/audit, failed-request resolution and revoked-session feedback. Temporary accounts and fixture rows were removed.
- Real owner CLI review/apply and initially unconfirmed-account denial passed. Disposable PostgreSQL checks proved owner-role enforcement, idempotent access receipts, stale-retry isolation after revocation and rollback on audit failure. Real Auth sign-out denied the old token at both API roles while an independent session continued.
- Real local email signup and password recovery passed, including wrong/replayed codes, no implicit roles, replacement credentials, old-token denial, preserved approved access, throttling, unknown-email privacy and fixture cleanup. Browser page/code-request checks and the existing full guard/assignment/report HTTP flow passed after the Auth changes. Effective local published ports were checked as loopback-only.
- Updated Android APK/test APK compilation, JVM checks and lint passed. The new trusted account-page URL assertions still require CI emulator execution; current physical Fold testing remains deferred.
- Local database advisors report no issues. Exported migrations retain explicit private grants and RLS.
- GitHub backend and Android workflows for owner/session commit `8c67115b36f59e9b97cbe4619a39d3be31e4c50b` passed (server run 40027047086, Android run 40027047057), including API 28/API 35 and HTTPS integration. The account-page changes require their own CI result after commit.

Detailed backend evidence and limits are in [PostgreSQL implementation notes](postgres-devices.md).

## Work still required for a finished product

1. Configure real email delivery and approved owner activation, then provision real guard/site/device approvals through the console. Verify setup/recovery through the chosen hosted origin and native browser handoff.
2. Configure real approved Ops bindings, source credentials, live receiver rendering and private media transfer. Verify end-to-end exchange against the actual connected apps without changing their existing data unexpectedly.
3. Complete production deployment, signing-key distribution/rotation, release signing/update recovery, retention/backups and capacity/security acceptance. Current global commit locks need throughput measurement before scaling.
4. Resolve operational acceptance for geofence/GPS behavior, background delivery/recovery, repeated patrol rounds, escalation/emergency delivery and dedicated-device controls.
5. Produce a current configured APK/source bundle and verify the full flow on the Fold6 when physical testing resumes. Preserve the existing app/data during installation and testing.
6. Keep [dedicated-device and firmware work](firmware-track.md) separate. No flashable Fold6 OS, bootloader unlock, recovery or OTA image has been validated. No phone was flashed, reset, rooted or enrolled by this continuation.

No completion claim is based solely on green unit tests or local fixtures. Hosted integration, real approved identities, release and hardware gates remain open.
