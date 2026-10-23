# Current checkpoint — 23 October 2026

Mercury One v0.26 adds a clearer active-shift UI with Escalate first, white status cards, compact page headers and persistent readiness feedback. Particle sign-in and local demo workflows remain in place. See [v0.26 build notes](build-v0.26.md) for exact validation status. Physical testing is deferred. Production enrollment, signed grants and dashboard integration remain open; local backend validation is not live operations readiness.

The cumulative development history follows.

# Mercury Guard OS — development brief v1.3

Updated: 20 October 2026 (America/Toronto). Continues the v1.0–v1.2 cumulative brief. This public development summary does not replace the internal cumulative baseline.

## Accepted scope

Build Mercury Guard as an ordinary, removable native Android app for Galaxy Z Fold6 first, preserving Pixel portability. Develop dedicated-device controls separately. Custom firmware feasibility follows the APK milestone. Confine work to MercuryGroupSS/mercury-guard-os; do not modify existing apps, repositories, or the phone.

## Baseline and provenance

Recovered the original Mercury_Guard_OS_Android_Source_v0.1.zip from the user's ChatGPT Library and reviewed the complete v1.2 cumulative brief. The unchanged source is preserved in commit 5269cbeace7fb527fe73237628b38b12f568251e. No reconstruction was needed.

## Work completed

- Verified repository read/write access and published the source to main.
- Corrected the ScrollView Kotlin property; applied system-bar insets and explicit resizability.
- Added monotonic demo-session expiry (12 hours), reboot invalidation, and permission/session checks in the GPS service.
- Release path remains an explicitly labelled offline demo, with manual incident, patrol, readiness, check-in and dispatch simulation.
- Added six shift-policy unit tests and three Android integration tests for standby recreation, incident persistence/end-shift, and audit JSON round-trip.
- GitHub Actions builds the APK, runs unit tests/lint, verifies the signature, generates a checksum, and runs integration tests on Android API 28 and 35.
- Fixed the original workflow's retired Android SDK tools package and pinned Ubuntu 24.04.

## Verification status

APK compilation, Android lint (with non-blocking warnings), signature verification and all six unit tests passed. The original emulator run found an Android 9 test-only AutoCloseable incompatibility and an Android 15 scrolling problem. Both were addressed; all three integration tests pass on each of Android API 28 and 35. All build and emulator jobs in run 39528303326 completed successfully. The latest code is f74e58bd73d125dc3f624243cd01cb72022c1e91 and its build run is https://github.com/MercuryGroupSS/mercury-guard-os/actions/runs/39528303326. APK SHA-256: 589554326eb81f7832a0a063411724db63b2dd49f1c3e786f8bea5eb1dc25e14. Physical Fold6, folding continuity, battery, radio, GPS accuracy, and installation remain unverified until tested on hardware.

## Production requirements still open

Server-authorized assignments and identity; encrypted local data and media; authenticated staging sync; camera capture and retention; geofences and routes; randomized prompts and escalation; real dispatch/client messaging; signed update lifecycle; central policy/device management; recovery and emergency access. Demo data must not be represented as actual dispatch or attendance. Local SQLite remains unencrypted and must contain synthetic test data only.

## Decisions and boundaries

No new firmware choice, biometric method, carrier plan, station hardware design, or production management vendor is approved by this update. Existing mission, fixed-site/mobile deployment, operations authority, privacy requirements, role boundaries, station concept and outstanding decisions remain in the cumulative internal baseline. Do not flash, reset, root, enroll, or lock down the Fold6 as part of ordinary APK testing.


## Firmware and management research outcome

A dedicated-device experience can use DPC-allowlisted lock task mode, with management and guard workflows treated separately. Google Android Management API is restricted to eligible commercial providers serving external customers, so an internal fleet cannot simply assume direct use. No Fold6-compatible flash image has been validated; exact device SKU/unlock ability, signed images, recovery, vendor support and OTA maintenance are prerequisites. Research and source links are in [firmware track](firmware-track.md). No device was enrolled, reset, rooted or flashed.

## Test build delivery

Installable debug APK: `ca.mercury.guard`, version 0.2.0 (2), minimum Android 9/API 28, target API 35. No native ABI-specific libraries. Compiled APK and checksum are delivered with the Fold6 test guide. Debug signing is unsuitable for production updates; stable release signing and physical Fold6 acceptance are still required. This milestone is an emulator-tested standalone prototype, not completion of the production Guard ecosystem.


## Continuation v1.4 — app v0.3

The user approved continuing core functionality before a later clean, futuristic white Jarvis-inspired UI redesign. The Mac browser simulation still represents v0.2. See [v0.3 build continuation](build-v0.3.md), [local data security](local-data-security.md), and [proposed staging contract](staging-integration-contract.md).

New code encrypts retained event payloads and photos under Android Keystore; migrates existing logical demo records; adds a user-confirmed camera workflow and file-based audit export; preserves incident drafts/readiness choices during activity recreation; expires foreground shift screens; and stops GPS on protected-storage failure. No live backend, identity or uniform verification, fleet management, or production release signing is implemented by these changes. Test evidence and the exact APK checksum will be recorded in the continuation brief.


## v1.5 continuation — ordered demo patrol

Android v0.4 adds three ordered manual demo checkpoints with encrypted progress persistence, shift isolation and transactional duplicate protection. Six unit tests and ten device tests on each API 28 and 35 passed. See [v0.4 build](build-v0.4.md). Physical presence verification, live backend, release signing and Fold6 hardware testing remain pending. White futuristic Jarvis-inspired styling is deferred.


## v1.6 continuation — encrypted offline outbox

Android v0.5 adds stable event IDs, transactional v3 migration, durable encrypted batches, partial-receipt handling and pending counts. Large cipher input now uses bounded chunks after Android 9 regression testing found a failure. Corrected run 39622096255 passed six unit and fourteen device tests on each API 28 and 35. See [v0.5 build](build-v0.5.md). No transport, server authentication or production connection is enabled. Release signing, physical Fold6 testing and the deferred white Jarvis UI remain pending.


## v1.7 continuation — durable encrypted drafts

Android v0.6 adds encrypted draft autosave, resume after reopen, confirmed discard and transactional submission. Drafts are excluded from audit export/outbox until submitted, and from Activity saved-instance state. Six unit tests and nineteen device tests on each API 28 and 35 passed in run 39623542785. See [v0.6 build](build-v0.6.md). The single local demo draft has no guard identity separation. Physical Fold6 testing, authenticated backend, release signing and the deferred white Jarvis design remain pending.


## v1.8 continuation — local audit viewer

Android v0.7 adds a read-only, paged local audit viewer and event detail recovery. Viewing neither records nor acknowledges events. Drafts remain excluded until submitted; photo records show metadata only. Six unit tests and twenty-two device tests on each API 28 and 35 passed in run 39624625205. See [v0.7 build](build-v0.7.md). The demo has no guard sign-in, live sync or server verification. Physical Fold6 validation, release signing and the deferred white Jarvis UI remain pending.


## v1.9 continuation — device readiness

Android v0.8 adds permission/provider/notification checks and process-local GPS request/fix observations. Notification permission and GPS retries require explicit actions; readiness viewing is passive. Six unit tests and twenty-five device tests on each API 28 and 35 passed in run 39626672617. See [v0.8 build](build-v0.8.md). Physical Fold6 permission-dialog/GPS/notification/background validation, backend integration, release signing and the deferred white Jarvis UI remain pending.


## v2.0 continuation — signed-grant verification foundation

Android v0.9 adds a separate staging signed-grant verifier and scoped monotonic action gate. Fixed trusted-key RSA-SHA256 signatures, exact bindings/actions, malformed inputs, expiry and reboot/rollback checks passed in the test suite. Six unit tests and thirty-one device tests on each API 28 and 35 passed in run 39666296794. See [v0.9 protocol and limits](build-v0.9.md). There is no configured production issuer/key, authenticated identity/time source or transport. DemoSession remains explicitly simulated and does not consume grants. Staging integration, protocol review, release signing, physical Fold6 tests and the deferred white Jarvis UI remain pending.


## v2.1 continuation — installation identity foundation

Android v0.10 adds explicit P-256 Android Keystore installation-key creation, public SPKI fingerprint/continuity checks and scoped enrollment challenge signatures. It is separate from data encryption, server issuer and APK signing. Six unit tests and thirty-six device tests on each API 28 and 35 passed in run 39674984682. See [v0.10 proof format and limits](build-v0.10.md). No live enrollment, attestation, guard identity, grant enforcement or network sync is enabled. Recovery/rotation, staging integration, release signing, physical Fold6 checks and deferred white Jarvis UI remain pending.


## v2.2 continuation — signed outbound batches and two-way integration

Android v0.11 connects durable batch preparation to the installation key without sending or acknowledging data. Six unit tests and forty-one device tests on each API 28 and 35 passed in run 39796747895. See [v0.11 batch format and limits](build-v0.11.md). The user confirmed bidirectional exchange with existing applications as a core requirement; see [proposed inbound/outbound contract](bidirectional-sync-contract.md). Production should reuse authoritative existing data through restricted server adapters, developed against isolated staging first. No existing application/database was modified. Live inbound/outbound sync, staging/enrollment/identity/grants, release signing, physical Fold6 checks and deferred white Jarvis UI remain pending.


## v2.3 continuation — incoming assignment and dispatch cache

Android v0.12 adds encrypted, scoped versioned records and atomic cursor persistence, including replay/conflict checks, tombstones and transactional failure recovery. Six unit tests and forty-seven device tests on each API 28 and 35 passed in run 39799340947. See [v0.12 contract and limits](build-v0.12.md). Existing backend identity mappings are candidates for reuse, subject to authorization and completeness review. No existing app/database was modified. Live inbound/outbound transport, authenticated guard enrollment/grants, cache lifecycle management, release signing, physical Fold6 testing and deferred white Jarvis UI remain pending.


## v2.4 continuation — server proof verification reference

Adds an offline Node server reference with twelve passing local tests for the existing Android batch signature format, malformed/duplicate JSON, altered payloads, device/audience checks, authorization expiry and strict event validation. This does not deploy an endpoint or change Android v0.12. See [server reference and security gates](../server/README.md). Importantly the existing signed batch does not include assignment scope, so historical event-to-grant attribution must be added before live ingestion. Durable replay/sequence transactions, real identity/enrollment and two-way staging tests remain pending. Hosted staging cost approval is pending; no existing apps/databases were modified.


## v2.5 continuation — local synthetic round-trip tests

User chose local testing without additional hosting charges; this supersedes pending hosted staging selection/cost requests. No new hosted resource is authorized or created. Seventeen server reference tests pass locally, including synthetic receive/send, lost receipts, deduplication, altered-ID rejection, rollback and assignment-bound v2 signatures. The backend is an in-memory test double, not a live server or Android/Supabase integration. Android remains v0.12/v1 signatures until a separately tested client protocol update. Existing applications remain unchanged.


## v2.6 continuation — Android v0.13 scoped signing

Six unit tests and forty-nine device tests on each API 28/35 passed, along with seventeen local Node tests. An actual API 35 Android Keystore synthetic proof verified independently in Node. See [v0.13 limits](build-v0.13.md). This signer is not wired to unscoped demo records; authenticated capture-time scope persistence and transport remain pending. User reports Fold6 ready; physical connection/setup has not been confirmed. No new hosted resources or existing application changes.


## v2.7 continuation — combined Mercury One interface and workflows

User asked to recover all adjustments from Style Mercury Guard OS and include them in this rebuild. Reconciled the saved v0.21 UI/workflow baseline with newer signing/receive-cache code and Fold6 fixes; see [combined build](build-v0.22.md). User chose local testing without hosting charges. Earlier pure-visual constraints were superseded by the direct request to include the saved functional adjustments. Optional OS access remains owner controlled. Combined runtime checks passed in run 39854910053; the separate preview installed and its cover-screen login was visually verified. New workflow hardware revalidation remains pending.

Preview is a separate package to preserve old encrypted records across different debug signing certificates. It omits full-screen access; the original package remains installed. The first API35 focus failures were traced to Android's fullscreen tutorial and resolved in disposable-emulator setup only. No phone settings were changed for that fix.


## v2.8 continuation — v0.23 local pilot closeout

User requested completion of the software before returning to physical tests. Android v0.23 closes photo/audit/check-in transactional failure paths, rejects camera results from a changed/ended shift, validates saved duty prompts and invalidates event caches after insertion to handle row-ID reuse after rollback. Five new runtime regression cases passed with the complete API28/API35 suites in GitHub run 39876216631. Build, lint, signature verification, 15 JVM tests and 17 local Node tests passed. The saved actual Android-Keystore synthetic proof also verified in Node.

The white Mercury One UI and previously recovered workflows remain included. See [local pilot closeout and acceptance plan](local-pilot-closeout.md). Local Preview APK SHA-256: 8397f0beb4bf009aad60dac9d8f3f8d0a97bac9910e0f02e644e1883f87eb556. Preview v0.23 uses the same local debug certificate as v0.22, permitting a data-preserving update of the separate Preview package. No USB handset was connected at final packaging, so v0.23 installation and all new hardware acceptance tests remain pending. The original Mercury Guard app was not touched.

This completes the local pilot build for acceptance, not production integration or firmware. Live authenticated identity/schedules/data exchange, approved server adapters, retention/recovery/revocation, production release signing, real site geometry and managed-device controls remain external implementation gates. No new Supabase hosted resource, hosting charge, existing-app change, device reset, flashing or enrollment. Dedicated-device research follows APK acceptance.


## v2.9 continuation — Fold6 physical acceptance

Preview v0.23 was updated and tested on the actual SM-F956W. Native sign-in, incident draft/save persistence, reverse-order GPS patrol and duplicate protection, biometric/GPS/photo check-in completion, camera cancellation, GPS retry, cover-screen recovery, timed readiness stages/miss, miss-reason preservation and confirmed early exit passed in the exercised paths. Android notification posting was observed, without claiming audible or prolonged background reliability. See [physical results and limits](fold6-physical-v0.23.md).

Final state: test shift ended, GPS tracking stopped, no running Preview service or active Preview notifications. Original app remained installed. Eight-hour clock-out, prolonged battery/doze/reboot tests, forced permission/GPS loss, audible delivery and an unfold-back cycle remain unverified on hardware. Minor status-copy/refresh clarity and identification of historical missed checks are follow-up polish. No live integration, hosting charge, phone enrollment or flashing.

## Ops Dashboard integration groundwork — 2026-10-22

User selected Mercury Ops Dashboard as the connecting application. Read-only source and schema inspection identified name-based shift identity and WhatsApp-specific ingestion as integration boundaries. Added a pure local adapter and five tests; full Node suite passes 22 tests. No live writes, deployment, cloud project or additional hosting. See ops-dashboard-integration.md. The APK remains v0.23 and is not connected to the dashboard yet.

## Durable local delivery continuation — 2026-10-22

Added SQLite-backed v2 ingestion with transactionally persisted events and receipts. Authorization is rechecked before replay receipts, original scope is included in event deduplication, and late conflicts roll back. All 24 Node tests pass, including close/reopen persistence. Local synthetic data only; no hosted changes or charges. Android remains v0.23, with real identity, grant issuance and HTTP transport still outstanding. No additional physical test is claimed. During active phone tests, interact at least every five minutes to prevent the user's ten-minute automatic lock; deliberate lock/background tests require separate handling.

## Local HTTP boundary — 2026-10-23

Added a Request/Response ingestion handler with mandatory injected server authentication, bounded request bodies, no-store responses, and generic failure responses. Three handler tests bring the local suite to 27 passing tests. This does not implement Supabase authentication or start an HTTP listener; socket-based and Android transport tests remain outstanding. Changes remain local and uncommitted. Phone wake was attempted but ADB could not start its local socket listener (Operation not permitted); no phone interaction or physical test occurred. Manual unlock alone does not resolve the Mac sandbox restriction.

## Composed delivery verification — 2026-10-23

A signed synthetic batch now passes the HTTP Request/Response handler into SQLite; the same persisted receipt is returned after restart. Invalid credentials do not reach storage and revoked authorization prevents replay. All 28 local server tests pass. This remains an in-process transport test with injected authentication, not a real Supabase session or Android network round trip. ADB remains blocked by the Mac local-listener restriction. No new APK or physical verification in this continuation.

## Authorization boundary continuation — 2026-10-23

The prior GitHub Android workflow completed successfully. Added server authorization assembly that resolves a verified subject through an independent authoritative provider, validates enrollment/revocation/binding/grant lifetime, and limits authorization to session expiry. User-editable claims are ignored. The composed signed-batch HTTP/storage test now exercises this boundary. All 32 local server tests pass. Providers remain synthetic: real Supabase session verification, enrollment/grant storage, Android capture scope and transport remain outstanding. Physical tests deferred at user request; no phone interaction.

## Local Supabase setup — 2026-10-23

Access restored using reviewed execution permissions. Docker Desktop running; isolated mercury-guard-os-local initialized on 55321/55322/55323/55324. CLI 2.122.0 pinned. Database/Auth health checks pass; synthetic sign-in and server identity verification tested, account removed. No hosted project or production changes. This provides local infrastructure, not completed phone integration. See local-supabase.md.

## v0.24 local authenticated backend — 2026-10-23

Local Supabase Auth is now used by the actual loopback HTTP ingestion service; protected PostgreSQL authorization records drive trusted context and device revocation. Signed reports persist in local SQLite with replay receipts. Actual network test verifies identity, denied client authority reads, signed ingestion, restart/retry, revocation, and cleanup. 37 server unit tests pass; local DB advisors clean. Android HTTPS transport foundation and receipt tests added; APK/assembly/JVM/lint pass. No physical testing or deployment; remaining operational integration listed in build-v0.24.md.

v0.24 verification closed: GitHub APK build and Android API 28/35 instrumentation suites passed (run 39954949196); server workflow also passed. Stable preview APK signature verified; source/review packages and cumulative master brief v3.0 saved. Local Supabase remains running. Physical acceptance and operational app integration remain pending, as detailed in build-v0.24.md.

## v0.25 authorized capture continuation — 2026-10-23

Added separate encrypted ScopedEventStore. Capture requires a verified permitted grant, current monotonic/boot state, matching original scope and device key. Atomic capture retains grant ID; scoped FIFO v2 batches survive restart and never relabel demo audit events. Local pilot receipts affect only the new queue. Instrumentation tests added; operational UI integration, enrollment/grant issuing and historical-upload authorization remain pending. Physical tests remain deferred.

v0.25 verification complete: GitHub run 39958027569 passed APK build and both API 28/35 instrumentation suites after correcting an API 28 test cleanup incompatibility. Encrypted capture recovery now fails closed on unreadable existing ciphertext. Local preview signature verified. Source/review package and master brief v3.1 updated. Operational UI wiring remains pending; no phone changes.

## 23 October 2026 — authorized identity, evidence and check-in integration

Vendor IDs can identify companies or individuals; individual guard identities remain separate. The local service and account screen now cover password authentication through local Supabase, approved device/assignment resolution, signed capture grants, per-guard encrypted queues, assigned any-order patrols, incidents, and separately receipted photo-file delivery. The photo/camera source 026042d passed Android build, HTTPS integration and API 28/API 35 in run 39989616073.

The next source checkpoint adds administrator-defined check-in schedules and biometric/fresh-GPS/consented-photo linkage, with atomic local capture and server duplicate-slot enforcement. 69 server tests and local Android build/lint checks pass; check-in emulator/HTTPS execution is pending. See guard-identity-and-site-phones.md for exact controls and limitations. This remains an isolated synthetic-data pilot: no existing dashboard or hosted Supabase changes, no added hosting charge, no new physical installation, and no claim of payroll clock-in or dashboard delivery. Production identity provisioning, operational lifecycle, authorized-flow alerts, background transport, live adapters and the deferred Fold tests remain outstanding.

The authorized check-in flow now distinguishes local capture from metadata receipt and photo delivery. Server receipt times support persistent missed-delivery deadlines; late delivery and appended guard reasons preserve the original miss. The assignment screen exposes a scoped service snapshot and reason capture. Reconciliation is request-triggered, so automatic background escalation is still outstanding. 73 server tests, local Android build/lint and the real local Supabase round trip pass; expanded status-response CI tests are pending. No existing application or hosted data changed.

Automatic local check-in deadline reconciliation now runs in the service, with a durable cursor, bounded batches, shutdown cleanup and retry of failed schedules. Missed deadlines create deduplicated pending alert records. 77 server tests, including a real timer test, and the isolated Supabase round trip pass. This is local automatic processing only; outbound dispatch, hosted scheduling and Android background prompts are still outstanding.

Authorized assignments now have optional phone check-in reminders with encrypted schedule persistence, generic notification text, boot/device binding, guard-switch cleanup and explicit stop controls. Precise alarm access is owner-controlled; an inexact fallback is labelled as potentially delayed. The check-in database lookup is indexed without exposing guard/assignment text in the index. Local build/lint and timing tests pass; new emulator migration/reminder tests await CI. The previous server-worker source passed every job in run 39992013384. No physical Fold operation or new hosted deployment occurred.

A separate dashboard delivery path now projects approved, explicitly mapped observations into a durable outbox and validates exact receipts from an isolated integration inbox. 84 server tests pass, including actual local HTTP delivery. The local runner queues only; outbound sending remains disabled. No existing dashboard/WhatsApp/payroll writes occurred, and media transfer plus downstream dashboard display remain unfinished. The Android 15 reminder-suite process termination was traced to shared notification-permission manipulation in a new state test; that test is isolated now, with local build/lint passing and CI rerun pending.

The corrected reminder/dashboard checkpoint 5ce0454 passed all Android CI jobs in run 39994578058 (API 28, API 35 and HTTPS). The notification-permission test interference is resolved in that run. Subsequent work adds persisted-payload receipt checks and an authenticated, device-scoped inbound dispatch feed with immutable versions, retractions and bounded cursor pages. 91 server tests pass. The phone inbox and acknowledgement UI remain outstanding, and no live application integration has been activated.

## Encrypted assignment inbox — 23 October 2026

The account assignment screen now opens an encrypted, guard/vendor/site/assignment/device-scoped message inbox. Authenticated pages apply message versions and the cursor in one transaction; conflicts, stale versions and racing refreshes roll back. Retractions hide messages, and expired-cursor recovery hides old content until the full authenticated feed restores current versions. Viewing stores local read time for the exact version only; it does not acknowledge a message to dispatch. Offline cached content is labelled potentially stale. Plain text message content cannot execute commands or open links automatically.

The prior feed commit acd94ac passed all Android jobs in run 39995542555, including API 28, API 35 and HTTPS. This inbox change passes local APK/test APK compilation, JVM tests and lint. New instrumentation tests cover scope isolation, encryption/restart, transaction rollback, version conflicts, retractions and cursor reset. HTTPS coverage now also persists and reopens the inbox. New emulator execution remains pending CI. Signed acknowledgements, live dispatch provisioning and operational integration remain unfinished; physical testing is deferred and existing applications remain unchanged.

## Version-bound acknowledgement service foundation

The signed batch service now validates dispatch acknowledgements against immutable published message history and the original guard/vendor/site/assignment. The capture grant must explicitly permit dispatch_ack. Unknown versions, foreign scope, retractions, extra fields and observations before publication are rejected before storage. Delayed acknowledgement of an older active version is retained as that version only; it cannot acknowledge a replacement instruction. Event replay uses the existing immutable batch/event receipts. Dashboard projection carries only message ID and version alongside the original attribution.

94 server tests pass, including signed ingestion, denied authority, historical versions, publication boundaries and projection. This is a service foundation: assignment grants do not yet issue the new action, and the phone confirmation button is not yet connected. No acknowledgement is silently generated by opening an inbox message. The inbox commit 68dea4a is undergoing Android CI; physical testing and live deployment remain deferred.

## Phone acknowledgement capture

The message view now offers an explicit acknowledgement for the displayed version. It rechecks the active session, current message version and signed grant, then records the observation in the encrypted upload queue. Transactional duplicate protection survives restart and receipts; newer versions remain independently acknowledgeable. The UI distinguishes a locally recorded acknowledgement from service acceptance. Sending uses the existing assignment upload action and immutable retry receipts. Assignment grants permit this action only when a dispatch feed is configured; Android accepts the new signed permission.

Local APK/test APK compilation, JVM tests and lint pass; all 94 server tests pass. Instrumentation adds duplicate/restart/receipt and cross-guard/version checks. The HTTPS fixture now captures and uploads an acknowledgement alongside the existing evidence events. Emulator execution of this new flow remains pending CI. No physical tests or live dashboard changes were performed.

## Authenticated shift transition service

A durable shift ledger and /v1/shift-transition route now record explicit start/end confirmations using service time, authenticated guard/vendor identity and a fresh single-use enrolled-device proof. Starts must fall within the schedule. Early ends require a nonblank reason. Scheduled end does not automatically clock out. One active shift per guard and per phone is enforced transactionally. Exact request retries return the original receipt; changed retries and cross-guard/device access are rejected. A bounded 24-hour historical assignment projection permits scheduled clock-out and lost-response recovery without reopening ordinary assignment capture. Cancelled assignments and revoked devices still deny access.

98 server tests pass, including restart persistence, conflicts, early exit, shared-vendor isolation, authenticated route/proof replay and scheduled-end boundaries. The local runner opens the ledger, but its previously running process is not assumed restarted. Phone start/end UI, active-shift gating of capture grants, shift-aware check-in reconciliation and dashboard attendance delivery remain to be integrated. These local receipts are not payroll or live dashboard confirmations. The preceding encrypted-inbox CI has passed build and HTTPS; API 28/35 were still running at this checkpoint.

## Confirmed-shift capture boundaries

When the local shift ledger is configured, capture grants now require a confirmed active shift on the same guard/vendor/site/assignment/device. Signed ingestion independently checks each event observation time against the confirmed start and the earlier of confirmed clock-out or scheduled end. The interval is half-open: capture at clock-out is rejected. Previously valid events and exact receipt retries remain uploadable after early exit, subject to existing authentication, enrollment, cancellation and historical-upload checks. A closed shift cannot regain live capture authority by replaying an earlier time.

101 server tests pass, including the actual grant handler before/after shift transitions and signed ingestion of delayed pre-exit versus post-exit records. Legacy isolated fixtures without a lifecycle dependency retain their protocol behavior; the default local runner supplies the ledger. The phone transition controls and HTTPS lifecycle fixture are still pending, so the complete new attendance flow is not yet end-to-end verified. Phone acknowledgement CI has passed APK build and was still running API 28/API 35/HTTPS at this checkpoint. No device installation or existing app changes occurred.

## Durable phone shift confirmation client

ShiftTransitionStore persists an encrypted, scope-bound confirmation intent before transmission. Retry reuses its original request ID and reason after restart; a mismatched receipt cannot mark it complete. Exact receipts validate guard/vendor/site/assignment/device, action, server timestamps and confirmation result. No credentials are persisted. GuardAccountClient now sends transitions with a fresh device challenge proof. The HTTPS fixture supplies the lifecycle ledger and exercises clock-in, lost-response retry, early clock-out, denied post-exit grants and valid pre-exit upload retry. Phone screen controls are still to be connected.

Inbox CI 39996927728 passed build, HTTPS and API 35; API 28 failed specifically because Kotlin use cast SQLiteOpenHelper to AutoCloseable, which that Android version does not implement. The inbox, scoped-event store and new shift store now explicitly implement java.io.Closeable so cleanup works across supported APIs. This corrects a runtime compatibility defect rather than suppressing a test. New Android emulator execution is required to confirm the correction. No new physical installation occurred.

## Phone shift controls and authoritative status

Authenticated assignment responses now include scoped not-started/active/ended status and service time when lifecycle enforcement is configured. Ended or overdue active shifts remain visible within the bounded recovery window so the guard can resolve a confirmation or clock out; expired assignments that were never started are omitted. This historical status projection does not reopen capture grants.

The phone assignment overview now presents a separately confirmed clock-in, active-shift entry, an Escalate early-exit dialog requiring a reason, and scheduled clock-out confirmation. It persists confirmation intent before transmission, exposes exact pending-request retry, and clears capture authority while resolving transitions. Confirmed clock-out signs out and stops reminders. Refreshing assignments also removes reminders for shifts no longer active. Queued reports remain preserved and can still be sent separately. Legacy fixture responses without shift status retain the existing protocol-only account view.

101 server tests pass, including status before/after transitions and post-schedule recovery. Local APK/test APK build, JVM tests and lint pass. The preceding durable-transition/Android-9-fix CI 39998375078 has passed its server workflow and is still running Android checks. The new phone controls await emulator and physical UI validation. Check-in reconciliation still needs to respect confirmed shift boundaries; live attendance/dispatch integration remains unfinished.

## Check-in deadlines within confirmed shifts

Configured lifecycle reconciliation now uses the persisted confirmed shift window in the background worker, grant status response and missed-reason validation. An unstarted shift creates no delivery-missing alerts. Only complete scheduled check-in windows contained within the confirmed start and earlier of confirmed end/scheduled end generate automatic missed-delivery records. Partial-window captured evidence remains visible with full_confirmed_window=false; it does not itself cause an automatic miss. Existing full-window misses and reasons remain retained. This conservative pilot rule avoids assigning a full-window failure to a late start or confirmed early exit; it does not silently change payroll or excuse an existing miss.

103 server tests pass, including a chronological worker scenario with no shift, confirmed start, early exit and later reconciliation, plus partial-window evidence retention. Android CI for the preceding transition/recovery build remains in progress. Production dispatch, completed UI/device validation and attendance integration remain outstanding.

## Attendance delivery queue

Confirmed shift transitions now project from their durable service receipts into the dashboard outbox, using deterministic event IDs, original guard/vendor/site/device attribution, approved assignment mappings and exact server times. Early-exit reason and flag are retained. The bridge has a separate bounded persistent attendance cursor; missing mappings are revisited and retrying or restarting projection does not create duplicate deliveries. Existing mapping-revocation checks and exact downstream receipt validation still govern sending. Attendance records do not originate from arbitrary phone event kinds.

104 server tests pass, including no-map withholding, later mapping, multi-page projection, original start/end timestamps, reason retention and repeated pumping without duplicate rows. The local runner queues only: no send adapter, payroll write or live dashboard update has been activated. Android checks remain under verification and the next preview has not yet been packaged or installed.

## Verified local Auth and shift recovery

Android source 320b010 passed every job in run 39998375078: APK build, API 28, API 35 and HTTPS. This confirms the explicit Closeable correction on Android 9 and the encrypted shift intent/receipt integration test on the emulator. It does not establish physical handset behavior or the later screen controls.

The real isolated local Supabase smoke test now supplies the lifecycle ledger. It passed guard ID/password login, device proof, denial of capture grants before clock-in, confirmed clock-in with exact retry, RSA grant verification, signed ingestion, persisted ledger/service restart, early clock-out with exact retry, post-exit grant denial, valid pre-exit upload retry and revocation. Its synthetic Auth account and temporary files were removed. No hosted project was created or changed. The current phone-screen CI run 39998713518 remains in progress; its server workflow passed. Live dashboard transmission and physical acceptance remain outstanding.

## v0.28 preview candidate packaging

Version code 28 / 0.28.0 consolidates the account, authorized evidence/check-in, message acknowledgement and confirmed-shift work. The separate Preview package uses the existing local preview signer; the original installed application is untouched. See build-v0.28.md for verification boundaries and operational gaps. The default APK remains unconfigured and is not a production deployment. Physical testing remains deferred.

## Missed-delivery notice bridge

The dashboard bridge now also reads the durable missed-check outbox through its own bounded cursor. It derives original vendor/site/device attribution from the confirmed shift ledger, retains the original deadline and detection time, and generates a deterministic notice identity. Missing mappings are revisited; foreign or absent shift scope cannot be inferred from vendor/name matches. Repeated pumping queues one notice. Existing approved-mapping checks and receipt validation govern downstream delivery. The original miss remains preserved; queuing does not claim dispatch notification.

105 server tests pass. Phone-screen source b5cc0e8 passed all jobs in run 39998713518: build, Android API 28/API 35, and HTTPS. The v0.28 package remains the immutable preview candidate from source 53fbbaa; this later server bridge change is not retroactively claimed as part of that bundle. No live sending or physical installation occurred.

## Repeatable local provisioning

An operator CLI now validates a complete synthetic vendor/individual-guard/device/assignment/mapping manifest before filesystem writes. It rejects duplicate subjects/emails/IDs, unknown fields, mismatched links, invalid public keys and assignments without an eligible phone. Multiple guards under a company vendor are supported. Optional output creates owner-only SQLite files in a new inactive directory; existing destinations are refused and no current service or account is changed. See local-provisioning.md. Real Auth-subject ownership and device possession remain separately verified requirements.

107 server tests pass, including snapshot reopening, separate company-guard logins, file permissions and invalid-manifest rejection before directory creation. This addition is source after the v0.28 candidate, not a retroactive update to its saved bundles. Production provisioning and live integration remain unfinished.

## Dedicated-device review after v0.28

Refreshed official Android/Samsung documentation and inspected current camera/device-policy source. The dedicated-device acceptance matrix now explicitly includes external camera allowlisting or embedded-camera work, reboot/escape paths, shared guard identity, fold transitions, notification policy, emergency access and production update/recovery. Samsung platform support does not establish acceptance on the exact Fold. Direct Android Management API use cannot be assumed available for an internal-only fleet. Flashable OS support remains unvalidated; no phone changes were made. See firmware-track.md for sources and exact evidence boundaries.

## Operational entry and phone enrollment details

LauncherActivity now selects the account workflow when valid administrator-packaged trust configuration is present. A missing configuration opens the existing clearly labelled preview/demo; invalid configuration shows a setup error and cannot silently fall back. Intent extras cannot choose the destination. MainActivity and GuardAccountActivity are no longer exported entry points; the launcher is the sole external app entry.

The configured account flow can prepare a new installation signing identity and display its public key/fingerprint and configured device ID for administrator review. The private key remains in Android Keystore. Preparation does not enroll the device or create a guard account; signed server challenge/enrollment checks still gate access. An unreadable existing identity is preserved rather than replaced. Public enrollment details remain accessible from sign-in.

Local APK/test APK build, JVM tests and lint pass. Added instrumentation checks cover valid/missing/invalid trust routing and exported-component boundaries; full emulator validation remains pending. This source follows the saved v0.28 candidate and is not yet installed on the Fold. Dedicated-device policy, production enrollment and physical acceptance remain outstanding.

## v0.28 CI closure and configured sign-in branding

The exact v0.28 source 53fbbaa passed all jobs in run 39999653726: build, API 28, API 35 and HTTPS. The saved Preview APK checksum remains unchanged. An additive CI verification supplement and cumulative-brief update record this result without rewriting the immutable source/review bundles. This is emulator/source verification, not physical acceptance or live provisioning.

Subsequent source now reuses the existing Mercury One particle-face renderer in configured guard sign-in. The decorative visual is separate from the accessible biometric button and never represents facial recognition. Motion stops when leaving the screen, pausing or destroying the activity, and biometric cancellation resets the animation. Repeated taps cannot open concurrent biometric prompts. The existing reduced-motion renderer remains in use. New configured-screen visual acceptance is still pending and this later source is not included in the saved v0.28 APK.

## Definitive shift rejection recovery

Business-rule refusals now have immutable, scope-bound service receipts: an early/invalid start, active-phone/guard conflict, invalid end, or missing early-exit reason cannot remain an ambiguous network outcome. A refused request ID cannot later execute, even after restart or after its schedule becomes valid. Changing the same ID's content is rejected. Authentication, proof, transport and malformed-response failures still do not become a definitive business rejection.

Android accepts only the exact bounded rejection receipt returned for its pending request and scope. It retains encrypted rejection history, migrates the shift store from schema 1 to 2 without dropping pending intents, and creates a new ID only after another explicit confirmation. Success receipts cannot overwrite rejections and stale rejection replies cannot clear a newer intent. The UI distinguishes a declined request from an unresolved network request and does not sign out or stop reminders for a rejected clock-out.

108 server tests pass, including persisted rejection replay and the actual HTTP response. Local Android build/JVM/lint pass; new migration/history and HTTPS early-exit correction assertions compile and await CI execution. Physical testing and live operational integration remain incomplete.

## Shift-store integrity and request-size guard

Opening the encrypted shift database now authenticates existing active and archived ciphertext before permitting new work. Missing/unusable keys or corrupted initial records block a new request rather than silently establishing unrelated new encrypted state. Secure-delete is enabled for replaced SQLite pages. The early-exit form and durable store also validate the serialized reason size before persistence, leaving room for the proof/envelope within the request limit. Oversized escaped content cannot become an unsendable pending confirmation.

Instrumentation adds corruption-blocking and encoded-size checks alongside the existing scope, migration and stale-receipt cases. Local Android build, test APK compilation, JVM tests and lint pass; full emulator execution of these additions remains pending. The definitive-rejection CI run 40001723635 was observed running and has not been assumed complete. No phone or existing application was modified.

### Vendor-wide access suspension — October 23

Added persistent administrative vendor activation/suspension to the isolated local directory. Company and individual vendor types retain separate guard authentication subjects. Suspending a vendor denies all linked guard logins and server identity resolution; reactivation does not reactivate individually disabled guards. Restart, unaffected-vendor isolation, company-ID login denial and individual-vendor coverage pass. Full local server suite: 109 tests passed. No live vendor records or dashboard application were changed; cached/offline handset authority is not synchronously revoked by this local method.

### Integrated vendor-access verification — October 23

Extended the real local Supabase Auth smoke flow to suspend the synthetic vendor after confirmed clock-in and signed incident ingestion. New login, existing-token profile access, device challenge and signed batch retry all deny access while suspended. Reactivation restores eligible access and returns the original receipt without duplicating the incident. Shift restart recovery, early exit and device revocation checks also pass; the temporary Auth account is removed. This is isolated local evidence, not live Ops integration.

GitHub Android run 40001957185 for source 915e306 passed build, API 28 instrumentation, API 35 instrumentation and HTTPS integration. This verifies the newer shift-store integrity changes; it does not change the immutable v0.28 review bundle or establish physical Fold acceptance.

### Local vendor administration — October 23

Added an operator command to inspect, suspend and reactivate an existing synthetic directory vendor. It reports affected guard counts and records operator label, reason and prior/requested status atomically with each change. Audit failure rolls back the access change; reactivation preserves individually disabled guards. Inspection is read-only; missing and symbolic-link database paths are refused. Operator labels are not authenticated identity evidence. All 110 local server tests pass. This is local administration only; production RBAC and live Ops controls remain outstanding.

### Ops vendor identity reconciliation — October 23

Read-only inspection confirms Invoice Desk vendor IDs may be renamed and HR's employee table cannot represent multiple guards per company vendor. Added a pure vendor-snapshot reconciliation boundary using separate internal and Ops IDs, explicit type and binding revision. Renamed/reused/ambiguous IDs require review; contact details and historical aliases cannot establish guard identity. No existing application or business data was changed. All 113 local server tests pass. The boundary is not yet wired to live snapshot retrieval or provisioning activation.

### Preview 0.29 packaging — October 23

Version 0.29 (code 29) gathers the configured account launcher, particle sign-in branding, installation-key enrollment details and encrypted shift rejection/recovery improvements since the immutable 0.28 package. The separate preview application remains unconfigured and debug-signed; live Auth and Ops activation are not implied. Physical testing remains deferred. See build-v0.29.md; artifact checksums and exact-source verification are recorded alongside the saved APK.

### Cancelled assignment close-out — October 23

A confirmed shift on a cancelled assignment now remains visible for close-out by its original guard on the same enrolled phone, within the existing historical window. New clock-in, capture grants, ordinary assignment reads and event uploads remain denied. Never-started cancelled assignments are hidden and cannot be closed. Repeated end requests return their original receipt. The account screen hides Continue shift for cancelled assignments and clears reminder eligibility. Revoked devices and disabled identities retain their denial rules. Pending start confirmations and administrative closure beyond the historical window still need a separate recovery path. All 114 server tests passed; targeted cancellation checks also cover never-started denial. This change is newer than the saved 0.29 APK.

### Lost clock-in receipt after cancellation — October 23

Cancelled-assignment transition requests can now recover an exact previously committed clock-in receipt, allowing the phone's unresolved confirmation to clear before close-out. The server derives allowStart from the stored assignment state, never from request input. With start disabled, only the exact existing receipt is returned; a new request receives a durable shift_cannot_start rejection without creating a shift session. All 114 server tests pass, including original receipt equality after cancellation, new-request denial and no session for a never-started cancelled assignment. This supersedes the preceding pending-start recovery limitation within the existing historical window; longer-term administrative closure remains unfinished.

### Local assignment synchronization — October 23

Added transactional source-row refresh into the local assignment store with independent upstream timestamp and approved-binding revision checks. Material changes create new internal assignments and cancel earlier ones while preserving historical schedules. Stale/conflicting updates fail; missing rows do not imply cancellation. Cancellation, replacement and refresh history commit together. All 116 server tests pass, including failed replacement rollback. This administrative adapter remains disconnected from live transport and recurring synchronization pending source validation and approved mappings.

### Bounded Ops source reader — October 23

Added a server-only GET adapter for explicitly mapped Ops shift IDs and schedule fields. It bounds IDs, time and body size, rejects redirects/partial or out-of-scope results, excludes roster display names and reports missing IDs without cancelling assignments. Synthetic contract coverage and the full server suite pass (118 tests). No hosted read or credential retrieval occurred; actual Data API connectivity and recurring sync activation remain unverified.

### Ops refresh worker — October 23

Added opt-in bounded refresh orchestration connecting approved mappings, source reads, trusted roster checks and transactional assignment updates. It rechecks mapping approval after network/directory reads, preserves missing-source assignments, coalesces overlapping runs and stops in-flight activation when stopped. All 120 server tests pass. The worker is not enabled in the service runner and no hosted application or data was changed; credential provisioning and persistent approved mappings remain deployment requirements.

### Persistent source binding approvals — October 23

Added a bounded local store for versioned Ops-shift-to-guard/vendor/site/Auth-subject approvals. Current mapping and full approval history commit atomically, survive restart and support exact retries without permitting stale revisions. Disabling retains history. All 122 server tests pass. No real guard mapping was approved; production administrator authentication and storage remain outstanding.

### Offline source-binding revocation — October 23

Disabled approved mappings now revoke local assignment eligibility without waiting for upstream reads. A durable revision watermark prevents stale source retries from reactivating the revoked mapping; a later explicit approval must use a newer revision. Tests confirm no network read is needed for revocation and stale revocation cannot cancel a subsequent approval. All 123 server tests pass. Live worker deployment and physical acceptance remain outstanding.

### Real local Ops REST integration — October 23

Verified the source reader and refresh pipeline against the isolated local Supabase REST API. Persisted synthetic approvals plus trusted roster checks create an assignment from the selected source row, and a subsequent source cancellation disables it while retaining original schedule fields. Unmapped rows are excluded; missing IDs are reported. Temporary fixture creation refuses an existing public.shifts table, and cleanup ownership/removal were verified. Hosted Ops was untouched. Added a reproducible local smoke script; production connectivity remains unverified.

### Ops-to-phone authorization smoke — October 23

Extended the real local REST smoke through temporary Supabase Auth login, enrolled-device proof and the actual assignment handler. The imported assignment is visible to the authenticated guard; replay is denied, and source cancellation removes assignment availability. Temporary account and table cleanup passed. This is local handler integration evidence, not physical-device testing or hosted activation.

### Private PostgreSQL identity schema — October 23

Created mercury_guard vendors/guards/guard_login in isolated local Supabase. Multiple individual guards can reference one company vendor; Auth subjects and lowercase login mappings are unique, activation defaults off, and referenced identities cannot be deleted. All tables have RLS and no anon/authenticated privileges; the server role has SELECT/INSERT/UPDATE only. Transactional fixtures rolled back, local advisors reported no issues, migration history is aligned, and generated migration replay passed in a disposable database that was then removed. Runtime remains on SQLite pending a PostgreSQL adapter. No hosted schema or application was changed.

### PostgreSQL directory adapter — October 23

Added asynchronous parameterized guard/vendor/login lookup against the private identity schema. Login now awaits the limiter and directory before and after authentication, preserving revocation checks with asynchronous storage. The real local PostgreSQL service-role smoke passes; fixtures were rolled back. All 124 server tests pass. Driver pinned with lockfile and no lifecycle scripts. Production connection configuration, durable shared login throttling and runner activation remain unfinished.

### Shared PostgreSQL login throttling — October 23

Added a private database-time limiter with serialized global/account counters and expiry cleanup. PostgreSQL directory defaults to this limiter. Two concurrent service-role connections verified account and global limits, expiry, private execution grants and migration replay in a disposable database; cleanup passed. Local advisors are clear, migration history is aligned, directory integration passes and all 124 server regressions pass. Hosted deployment remains untouched.

### PostgreSQL identity runtime option — October 23

Local service can explicitly select PostgreSQL identity through MERCURY_IDENTITY_STORE=postgres. It validates loopback connection scope, service-role session and required schema, uses bounded pooling/timeouts and fails without fallback. Real local HTTP login/Auth/profile plus vendor suspension passed; synthetic fixtures were removed. All 125 server tests pass. No persistent service restart or hosted deployment occurred; remaining stores are still local SQLite.

### PostgreSQL CI coverage — October 23

Added a dedicated PostgreSQL 17 job to server-contract.yml and included supabase source paths in workflow triggers. It installs pinned dependencies without scripts, replays identity/throttle migrations and checks constraints, grants and concurrent limits in a disposable database. The reusable verifier passes locally; exact-source CI results are pending. No hosted credentials or data are involved.

### PostgreSQL device and assignment schema — October 23

Added private relational device/site/assignment/challenge tables with guard/vendor pairing, site-or-personal enrollment constraints, unique keys/challenges and bounded schedule/policy fields. Server role may cancel assignments but cannot rewrite historical scope/schedule or enrolled keys. RLS and restricted grants are verified. Corrected a PostgreSQL regex quantifier limit found by tests. Local SQL checks and disposable migration replay pass, advisors are clear and migration history aligns. PostgreSQL CI includes the new schema checks; runtime device storage remains SQLite. Earlier PostgreSQL CI run 40007427240 passed both protocol and postgres-identity jobs.

### PostgreSQL device proof and asynchronous authorization checkpoint

Implemented the PostgreSQL device/assignment adapter and verified one-time signed challenge consumption under concurrent requests using a disposable local database. Verified challenge replacement, rejected-signature rollback, expiry, device/site scope, cancellation and revocation. Shared company Vendor IDs remain separate from individual guard identities. Updated HTTP handlers to await database-backed device authorization; 125 server tests pass with asynchronous device providers. No hosted data or phone changes. Remaining before runtime activation: asynchronous check-in scheduler and PostgreSQL-compatible Ops assignment synchronization.

### Asynchronous check-in scheduler

Updated schedule reads for PostgreSQL compatibility. Concurrent sweeps share one operation; read failures retain the cursor for retry. Shutdown cancels future ticks, drains pending reads, and prevents stale results from creating alerts or advancing state. Verified recovery, stop-during-read, queued callback, existing deadline behavior and confirmed-shift bounds. 127 server tests pass locally. Runtime device-store selection and PostgreSQL Ops synchronization are still pending; no hosted deployment or handset changes.

### Ops refresh asynchronous persistence boundary

Ops refresh now awaits assignment writes and approval revocations, reports rejected database operations accurately, and drains in-flight work before shutdown completes. Stop prevents the next batch item; a transaction already started is allowed to finish. Verified asynchronous failure/retry and delayed-write shutdown behavior; 129 server tests pass. The existing SQLite synchronization ledger remains in use pending the PostgreSQL ledger implementation. No live Ops data changed.

### PostgreSQL Ops ledger implementation

Added transactional PostgreSQL assignment synchronization, revocation watermarks and append-only sync history. Concurrent imports serialize per upstream shift, including first import. Failed replacement rolls back cancellation and history; revoked revisions cannot restore access. Verified real PostgreSQL concurrency, rollback, cancellation/reopen and restricted history privileges in a disposable database. Local advisors found no issues; exported migration replay and 129 server tests passed. The runtime still uses SQLite devices until the PostgreSQL composition is wired and tested. No hosted deployment, source-app write or handset action.

### PostgreSQL local service composition verified

The local runner can now select PostgreSQL identity/device/assignment/sync components together through MERCURY_IDENTITY_STORE=postgres, sharing one restricted pool. Default SQLite behavior remains; no existing records are migrated automatically. Real HTTP plus real local Supabase Auth verified device proof, assignment import, confirmed shift start, signed scoped capture grant, cancellation closeout, replay rejection, revocation and vendor suspension. Synthetic rows cleaned up; 130 server tests pass. Shift/event/grant persistence still uses SQLite, and recurring Ops imports are not yet configured in the runner. No hosted deployment or physical-device testing performed.

### Recurring Ops refresh composition

Added explicit off/local/remote Ops refresh modes to the local runner, default off. Refresh uses persisted approvals, scoped read-only GET requests, the selected assignment adapter, immediate/30-second polling and shutdown draining. No remote source enabled. 132 server tests passed, plus a real local REST/Auth test confirmed timer-driven cancellation became unavailable at the assignment endpoint. Fixtures cleaned up. Remote credentials/approved real mappings, hosted approval administration and outbound integration remain outstanding.

### Shared PostgreSQL Ops approvals

Added private centralized mapping approvals with revisioned audit history and shared input validation. PostgreSQL refresh now reads this store rather than a local approval file. Real database tests verified concurrent retries, capacity enforcement, audit rollback, and approval-to-refresh composition. 132 server tests pass; advisors clear. Corrected an unintended constraint drop in the prior, not-hosted Ops-sync migration and added direct database schedule-constraint checks to replay verification. Local running schema was unaffected. Authenticated administrator provisioning/UI and remaining shift/event persistence are still outstanding.

### Shared confirmed shift lifecycle

Moved PostgreSQL-mode confirmed shifts and transition/rejection receipts into the shared private database. Added one-active-guard/phone constraints, immutable receipts, current-authority locking, exact retry recovery and cancellation closeout. Updated HTTP capture checks, scheduled reconciliation and dashboard projection for asynchronous shift state. Real PostgreSQL concurrency/replay checks and local Auth/HTTP grant/closeout smoke passed; 132 server tests pass; advisors clear. Clock events currently serialize globally for reliable receipt cursor ordering; production throughput needs measurement. Grant/event/media/outbound persistence and authenticated administrator provisioning remain outstanding.
