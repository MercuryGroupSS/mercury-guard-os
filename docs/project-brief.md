# Mercury One — current project brief

Updated 23 October 2026. The product is still in development. This brief describes the current state; the [complete development history](development-history-through-shared-delivery.md) and internal cumulative baseline remain preserved.

## Accepted scope

Deliver an ordinary native Android app for Galaxy Z Fold6, preserving Pixel portability. Use individual guard identities even when one Vendor ID represents a company employing several guards. Keep biometric handset unlock distinct from proof of a named guard. Integrate assignments and observations with Mercury Ops through explicit mappings. Develop dedicated-device management and firmware feasibility separately after the APK track.

Work is confined to MercuryGroupSS/mercury-guard-os. Existing applications and repositories are unchanged. Hosting charges were deferred in favor of isolated local Supabase tests. Current physical-device testing is deferred.

## Packaged app

The latest saved immutable package is Mercury One Preview v0.29, package `ca.mercury.guard.preview`, version code 29, built from source `4a341521f78e0a8b9f0ae7df692d1d05c0824fa9`. Its APK SHA-256 was rechecked as `fc6dfe7054debeb7438d9f275007e2cead081edcf007bab5b25f4876a4f5a9dc`. Its source ZIP contains 206 tracked files. This debug-signed, unconfigured preview does not include all subsequent backend changes and has not received current Fold acceptance.

The Android implementation includes the white Mercury One interface, particle sign-in face, individually authenticated assignments, encrypted offline records/photos/drafts, selectable patrol checkpoints, explicit shift start/end and cancellation closeout, signed scoped batches/grants, check-in evidence, dispatch version acknowledgements and clearer GPS/readiness feedback. These features still require final configured-release and physical acceptance checks together.

## Backend now implemented and locally verified

PostgreSQL mode shares vendor/guard identities, approved device keys, assignments, Ops mapping approvals, confirmed shifts and idempotent transition/rejection receipts. It also shares capture grants, signed event/evidence records, check-in deadlines and scheduler state, dispatch versions/cursors, outbound mappings/history, queue leases/receipts and projection cursors. Default SQLite mode remains available for synthetic local tests. Existing SQLite records are not automatically migrated by selecting PostgreSQL.

Auth tokens are verified remotely. Vendor/company identity does not substitute for individual guard authentication. Current roster, device, assignment and grant state is rechecked at operational commit boundaries. Revoked access cannot recover a receipt to bypass authorization.

The [administration API](administration.md) now supports explicitly approved Auth administrators, bounded catalogs, reasoned idempotent mutations and append-only transactional audit. It can manage vendor/site status, link existing individual Auth accounts, approve/revoke devices and mappings, and publish scoped dispatch versions. Its console UI, first real owner setup and Auth-account creation/recovery remain unfinished. No real administrator was activated during these tests.

Recurring Ops reads are opt-in and use only explicitly approved shift IDs. Live reading/sending is not enabled. Isolated inbox receipts prove stored integration records; they do not prove Ops rendering, media transfer or payroll updates.

## Verification checkpoint

- 137 server tests pass.
- Disposable PostgreSQL migration replay and real concurrency/revocation/rollback/receipt tests pass, including audited administrator actions.
- Real local Supabase Auth and HTTP checks pass for sign-in, scoped assignments, confirmed shifts/grants, incident ingestion, dispatch acknowledgement, queue projection, administrator actions and revocation.
- Local database advisors report no issues. Exported migrations retain explicit private grants and RLS.
- The last checked GitHub backend and Android workflows for shared-delivery commit `ff5bcfc719b825de85e4ab2b3c19507e5310064f` both passed (server run 40016508645, Android run 40016508819). The administration changes require their own CI result after commit.

Detailed backend evidence and limits are in [PostgreSQL implementation notes](postgres-devices.md).

## Work still required for a finished product

1. Finish the administrator console, owner onboarding, account provisioning/recovery and real guard/site/device approval flows.
2. Configure real approved Ops bindings, source credentials, live receiver rendering and private media transfer. Verify end-to-end exchange against the actual connected apps without changing their existing data unexpectedly.
3. Complete production deployment, signing-key distribution/rotation, release signing/update recovery, retention/backups and capacity/security acceptance. Current global commit locks need throughput measurement before scaling.
4. Resolve operational acceptance for geofence/GPS behavior, background delivery/recovery, repeated patrol rounds, escalation/emergency delivery and dedicated-device controls.
5. Produce a current configured APK/source bundle and verify the full flow on the Fold6 when physical testing resumes. Preserve the existing app/data during installation and testing.
6. Keep [dedicated-device and firmware work](firmware-track.md) separate. No flashable Fold6 OS, bootloader unlock, recovery or OTA image has been validated. No phone was flashed, reset, rooted or enrolled by this continuation.

No completion claim is based solely on green unit tests or local fixtures. Hosted integration, real approved identities, release and hardware gates remain open.
