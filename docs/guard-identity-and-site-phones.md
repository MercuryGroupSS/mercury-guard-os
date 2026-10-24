# Guard identity and shared site phones

Confirmed operating decisions: site phones use biometric verification, then individual guard user ID and a private credential. Vendor IDs may represent companies or individual guards. Vendor identity is not sufficient to identify or authorize a person.

## Current contract through v0.35

The connected application now implements individual Guard ID/password sign-in through real local Supabase Auth, approved installation-key enrollment and device-proven assignment reads. PostgreSQL stores the distinct guard/vendor links and current Auth-session checks. The native screen gates credentials behind Android biometric verification and relocks foreground access after leaving. Configuration, individual identity, device approval and explicit shift confirmation remain separate requirements; preparing a public key does not approve a phone.

A company Vendor ID can link multiple individual guards. Each approved guard sees only authorized site/device assignments. Encrypted drafts retain their original individual subject and scope; pending delivery retains original event attribution. A later guard does not inherit the preceding foreground credentials or capture authority. Local biometrics do not identify which named person used a shared phone.

The current Preview is unconfigured. Real owner/guard enrollment, email delivery, actual Ops bindings and attended Fold acceptance remain open. Consult the [current project brief](project-brief.md) and [data protection notes](local-data-security.md) for the current boundary.

## Actual platform sign-in acceptance

The opt-in `HttpsSignInIntegrationTest` now passes through the real launcher, visible installation-key preparation and owner-fixture public-key approval, Android SystemUI strong biometric prompt, visible credentials and the production login/assignment handlers against real local Supabase Auth/PostgreSQL. It verifies cancel and unknown-finger denial, an enrolled fingerprint, rejected company Vendor ID login, individual A's assignment, background/reopen relocking, a second biometric verification, individual B under the same company with a different Auth subject and assignment, removal of A's upload authority, and exact A/B provider-session revocation after explicit sign-out. There is no injected biometric callback, foreground account/session or login result. The approved synthetic public-key fixture is not a real owner enrollment.

Run `MERCURY_ANDROID_SERIAL=emulator-5568 node server/scripts/run-signin-https-android-test.mjs` from the source root only with the owned local stack and disposable API35 English Google APIs emulator. CI selects its sole emulator explicitly. The runner refuses physical serials, non-qemu/wrong-API targets, a pre-existing PIN/fingerprint, competing fixture listeners and an existing runner/security claim. It uses actual Settings to enroll one temporary synthetic PIN/fingerprint, injects the sensor through the emulator console, and restores the original NONE-PIN/zero-fingerprint state. Unconfirmed cleanup retains ownership metadata for recovery. It changes only the separately packaged `ca.mercury.guard.httpstest` on the approved emulator. It does not operate the Fold or `ca.mercury.guard`.

The local run executed one test with no skip, and confirmed exact Auth/fixture/generated-asset cleanup and original emulator security restoration. CI separately runs the gate from a fresh x86_64 image; its terminal result belongs to the source verification record. Only a fixed sanitized status/cleanup summary is published under `app/build/reports/signin-acceptance/result.json`; raw credential/UI diagnostics and private runtime keys are withheld. The ordinary suite skips this opt-in case unless its dedicated fixture is requested. This proves the platform flow in an emulator; it does not establish physical Fold biometric performance, identify the named person touching a shared sensor, or activate real accounts.

## Retained implementation history

The following checkpoints preserve earlier stages and their then-pending work. Historical test counts, SQLite mode and statements that a feature is not yet wired are not the current completion record.

## Existing dashboard compatibility

Read-only source review on 23 October 2026 found `hr/migrations/M1_hr_schema_and_employees.sql` restricts employees to one record per vendor, with an EMP-vendor ID format. That payroll model cannot serve as a company guard roster. Source review does not prove which migrations are applied live. Keep payroll and billing unchanged. Create a separate guard roster with stable guard ID, unique authenticated subject, active state and explicit vendor link. Reuse confirmed links; never infer identity from a name or vendor login.

## Sign-in and assignment path

1. Approved site phone performs local Android strong biometric verification. This gates the UI; it does not identify which enrolled person touched the sensor and must not be claimed as remote biometric proof.
2. Guard enters individual user ID and private credential. An authenticated server resolves exactly one active guard and active linked vendor. Credential enrollment, recovery and rate limiting remain required before deployment. Prefer managed account passwords over a custom short-PIN authentication system.
3. The installation proves its enrolled key. A site phone can obtain only assignments for its registered site and the authenticated guard. A personal phone is bound to its guard. Future schedules may be displayed but do not authorize early clock-in.
4. A server issues short-lived signed shift authorization. Capture retains original guard, assignment, site and device scope. Vendor context must also be retained authoritatively rather than recomputed after a later vendor transfer.
5. Shift end removes the foreground guard session. Pending records keep their original ownership and use a separately authorized historical-upload policy; a new guard cannot inherit the previous guard's records or credentials.

## Implemented checkpoint

`server/guard-directory.mjs` implements trusted-provider identity resolution and assignment/device filtering. Four new tests cover multiple guards under one company, ambiguous/inactive mappings, cross-guard and cross-site access, revoked devices, personal devices and schedule boundaries. All 41 server tests pass locally.

This module is not yet wired into the HTTP service. No new accounts, migrations or live dashboard writes were made. Next: persist the roster locally, implement credential login and device enrollment, connect authoritative assignment reads and signed grants, then integrate Android session lifecycle. Live roster coverage remains unverified and no private HR or payroll records were fetched.

## Persistent identity endpoint checkpoint

The local synthetic-data service now accepts an optional persistent SQLite roster and serves GET /v1/me after remote Supabase token verification and guard/vendor resolution. Responses include only guard_id and vendor_id, with no-store headers. No self-enrollment or roster write endpoint exists. The local launch script opens the roster alongside the ingestion store. The roster stores no credentials or biometric templates; it is plaintext synthetic data, not a production directory.

Validation: 43 Node tests passed. The actual local HTTP smoke test signed in a temporary Supabase account, resolved its guard/vendor profile, disabled the guard and verified 403, then re-enabled it and completed signed ingestion, restart deduplication and revocation checks. Temporary account and files were removed. Profile identity does not establish device enrollment or issue a shift grant. When the roster is configured, batch authorization also checks the active guard/vendor and matching guard ID on every request, including retries. The real HTTP test confirmed a disabled roster identity receives 401 for a batch retry. The legacy no-roster test composition remains available for protocol fixtures; the launch script always supplies a roster.

## Device and assignment delivery checkpoint

LocalDeviceAssignments persists administrator-approved installation keys, site/personal phone bindings, explicit guard/vendor/site assignments and short-lived device challenges. POST /v1/device-challenge requires an authenticated active guard and enrolled phone. POST /v1/assignments requires the Android-compatible P-256 challenge proof. Challenges expire after 60 seconds, are tied to the authenticated subject, and are consumed atomically. A used challenge remains unusable after restart. Creating another challenge replaces that subject/device pair's pending challenge.

Only matching guard/vendor/site/device assignments are projected. Future assignments can be listed but cannot start; cancelled or expired assignments are omitted. Enrollment and assignment provisioning currently use trusted local administrative methods, not an unauthenticated enrollment API. No production device has been enrolled.

The default local launch supplies both roster and device stores. Batch authorization also checks the registered key, device state and active current assignment. Historical upload after expiry/cancellation is deliberately unavailable until a separate historical authorization policy is implemented; queued records must remain preserved. This does not constitute shift grant issuance or automatic enrollment.

Verification: all 47 server tests passed, including persistence/replay, expiry, wrong key/subject, revoked devices, cancelled assignments, guard/site filtering and bounded request bodies. The real local Supabase/HTTP smoke test passed identity lookup, signed device proof, scoped assignment delivery, replay denial, disabled guard upload denial, signed event ingestion, restart deduplication and authority revocation. Synthetic account and databases were cleaned up.

## Signed shift grant checkpoint

POST /v1/shift-grant consumes a fresh authenticated device proof and selects only an eligible current assignment. A fixed RSA-SHA256 issuer signs the existing Android grant format. Expiry is the earliest of 15 minutes, session expiry and assignment end. Guard/site/assignment/key/revocation scope is signed; vendor and authenticated subject are retained in the issuer audit table. No client-selected actions are accepted. The local issuer key is generated once into the ignored .local-backend directory with owner-only permissions; existing invalid material causes failure instead of replacement.

Fifty Node tests pass. The local HTTP smoke test obtained and cryptographically verified a grant and rejected a repeated proof, alongside the existing identity, device, assignment and ingestion tests. A Node-generated public-key-only fixture and Android instrumentation test now cover the server-to-Android grant format; emulator execution is pending. This fixture is test-only and is not a trusted production issuer.

Remaining: Android account/session and assignment integration, trusted HTTPS and issuer distribution, grant-history validation on ingestion, authorization of post-shift uploads, operational roster provisioning and live dashboard integration. Grant issuance does not yet replace the separate pilot ingestion authority. The running prior service process must not be assumed to include new source until restarted; smoke tests launch their own isolated current-source service.

## Guard ID/password and Android client checkpoint

POST /v1/session/login resolves an exact guard ID through a server-only account-email mapping, exchanges its password with Supabase, verifies the resulting token subject, and rechecks the active mapping before returning it. Responses contain only access token, expiry and server time. Passwords are not stored; refresh tokens are not sent to the phone. Unknown IDs, disabled guards and bad credentials share the same 401 response; timing uniformity is not claimed. Persistent local limits allow at most five attempts per ID per five minutes and 100 globally per minute. Global capacity is checked before allocating per-ID buckets. Production requires distributed/per-origin abuse controls, account recovery and operational provisioning.

GuardAccountClient supports HTTPS sign-in, profile, device proof, assignment reads and grant requests. Access tokens live only in memory and are redacted in diagnostic string output. The session lifetime uses monotonic time anchored conservatively at request start; clearing or expiry prevents reuse. Caller password arrays are cleared, but JVM string copies cannot be guaranteed erased. No operational UI or trusted service configuration is enabled yet. Biometrics remain a local UI prerequisite to be wired into the sign-in flow, not a server identity claim.

Verification: 54 Node tests passed. The local HTTP round trip verified guard ID/password sign-in and the resulting Supabase identity, no refresh token in the response, device proof, assignment and grant delivery, upload/retry and revocation behavior, then removed synthetic data. Android account-client tests cover rejected origins, expiry, explicit clearing and diagnostic redaction; emulator results are pending. The Android client has not yet been exercised over a real HTTPS connection or on the Fold.

## Account UI checkpoint (v0.27)

GuardAccountActivity is a non-exported, screenshot-protected account screen accessible from prototype tools. It validates packaged trust configuration, requires a secure biometric before showing ID/password, loads the authenticated profile and device-proven assignments, and verifies requested shift grants against pinned issuer keys and expected scope. Backgrounding clears the session and invalidates pending callbacks. Unconfigured builds show setup status and never display credential fields. See service-configuration.md for provisioning and limits.

The Node-generated grant fixture passed API 28 and API 35 emulator execution in run 39983106703. The account UI itself still requires configured HTTPS end-to-end validation and physical testing. Operational capture is not yet connected to verified grants.

## Authorized incident capture and grant-backed ingestion

The configured account UI now saves incidents into ScopedEventStore using a verified grant and its original binding, with observation time derived from the server/monotonic anchor. It can send the oldest queued batch for the currently authenticated guard and marks only complete matching local-pilot receipts. Sign-in and grant verification still do not create a payroll clock-in. The default APK remains unconfigured. Configured Android HTTPS end-to-end execution is not yet verified.

When roster, devices and issuer are configured, /v2/batches now resolves authorization from persisted issued grant history rather than manually seeded guard_authorizations. Every capture_grant_id must belong to the current authenticated guard and original vendor, match the full signed batch scope, permit the event kind, and cover the claimed observation time. Records store original vendor attribution alongside scope. A device signature proves key possession, not that a reported observation occurred at the claimed time.

Provisional local historical-upload policy: an active guard and vendor may upload records from an active, uncancelled assignment until 24 hours after its scheduled end, using the original enrolled key/revision and previously issued capture grants. Grant or device revocation still rejects retries. This bound is a pilot default pending operational review, not an assertion of an approved retention policy. It does not permit new capture after grant expiry. Queues remain intact on denial. The shared-device FIFO can block one guard behind another's records; multi-guard queue scheduling remains an open product requirement.

Verification: 57 Node tests passed. The local HTTP smoke test no longer seeds an upload authorization row; it completes sign-in, device proof, assignment lookup, grant issuance, capture-grant-backed ingestion, restart deduplication and grant revocation. Synthetic accounts and files are removed. Android capture/upload compilation and emulator verification are tracked separately; no physical test or live dashboard delivery is claimed.

## Shared-device queue isolation

The account flow now selects pending records by authenticated guard. Each guard has a separate encrypted immutable retry snapshot, with a hashed owner index and owner-bound encryption AAD. Older version-1 snapshots are adopted without changing batch/event IDs. Receipts can clear only the selected guard's matching snapshot. Displayed pending counts are limited to that guard. Capture sequence allocation remains device-wide and strictly increasing locally.

After full issued-grant validation, the server permits out-of-order arrival across batches. Device/event ID and device/sequence uniqueness, immutable content/scope checks and receipt idempotency still apply. Unvalidated legacy pilot contexts retain the old sequence rollback rule. Arrival order no longer blocks a guard behind another guard's unsent records; original capture order remains the recorded sequence. This is not evidence that a submitted observation is truthful.

Sixty Node tests pass, including two authenticated guards sharing a key: guard B uploads sequence 2 before guard A's sequence 1, each is forbidden from uploading the other's records, and duplicates/conflicts remain rejected. Android tests cover independent pending snapshots, cross-guard receipt denial, restart and version-1 migration; emulator execution is pending for this revision. Same-guard FIFO across assignments remains, so a permanently denied older assignment still needs a later recovery workflow without deleting or relabelling records.

The v0.27 account-screen build/emulator run 39984317451 completed successfully on API 28 and API 35. This does not establish configured HTTPS or physical-device execution.

## Authorized patrol checkpoint

Assignments can now carry an administrator-provided patrol route ID, positive revision and up to 100 uniquely identified/labeled checkpoints. Grant issuance persists an immutable route snapshot and returns it over the authenticated service response. The Android account UI uses that current returned route rather than a stale assignment-list copy.

Guards may select checkpoints in any order. The encrypted capture store prevents a second local record for a completed checkpoint and retains completion after restart. The server verifies route ID/revision/checkpoint against the capture grant's persisted policy, and enforces one checkpoint record per guard/assignment/route revision across devices. Exact event retries remain idempotent; another event ID for the same checkpoint is rejected. A manual checkpoint is not physical-presence verification. This implements one assigned route per revision; repeating patrol rounds/schedules remain to be implemented explicitly rather than inferred from reopening a screen.

Sixty-two Node tests pass, including out-of-order checkpoint choices, unknown checkpoints, old/new route revision checks, duplicate rejection and immutable policy snapshots. Android tests cover local order independence, duplicate rejection and restart persistence. The HTTPS test now covers an incident and two checkpoints. Emulator execution is still pending for these additions; physical testing is deferred.

The authorized-patrol source passed local APK/test APK compilation, JVM tests and lint using fresh temporary generated outputs after a duplicate generated filename invalidated the prior local output directory. See local-build-recovery.md. The expanded HTTPS patrol and API 28/API 35 suites are still running in workflow 39987088462; no result is inferred from compilation.

## Separate photo evidence delivery

Photo metadata is validated before grant-backed event ingestion. POST /v1/evidence/<event-id> then requires the authenticated owning guard, original vendor and capture grant, a still-authorized device/assignment, and a previously accepted photo event. The body is bounded to the recorded byte count and 20 MB maximum. SHA-256 must match the signed metadata. Access is rechecked after reading the body. A separate evidence_accepted_local_only receipt records media acceptance; a metadata receipt is not photo delivery.

The local pilot stores media bytes in SQLite alongside immutable event attribution. It remains a plaintext synthetic-data server store, not approved production media hosting. The endpoint does not expose a public download route. Hash verification does not establish that a photo is authentic or that its claimed dimensions are truthful; server image decoding and production storage/access/retention policy remain outstanding.

Sixty-five Node tests pass. Android GuardTransport now has a bounded HTTPS photo upload method and exact receipt checks, with instrumentation tests pending. The encrypted queue now persists separate media receipts, and Send queued records retries up to three pending photo files after metadata acceptance. Camera UI, check-in linkage and background retry are not yet wired into the account flow. The earlier expanded patrol HTTPS and API 28/API 35 suites all passed in run 39987088462.

The Android HTTPS test now includes a generated JPEG, photo metadata ingestion, repeated media upload and a separate durable photo receipt. This expanded test is pending execution. The final media queue migration passed local APK and instrumentation APK compilation, JVM tests and lint (74 tasks, BUILD SUCCESSFUL). Emulator execution of the expanded media tests remains pending.


## Authorized camera capture

The assignment screen now offers explicit consent and external-camera capture. Login credentials clear before launching the camera, including multi-window launches. Only one pending photo retains the original verified assignment grant in memory; camera completion must still pass grant expiry, boot and device binding checks before the encrypted event is committed. Cancellation, invalid output or expired authority discards the temporary photo. Process recreation discards abandoned account-camera output rather than inventing authorization. A successful save requires the guard to sign in again before sending. No upload occurs from the camera callback.

This is a standalone authorized photo, not yet a timed check-in or an incident attachment. Physical camera testing remains deferred. The media delivery commit ef73dc7 passed server CI; Android media integration is running in 39989198947.

Local camera APK/test APK compilation, unit checks and lint passed. Unsaved incident text prevents camera launch so credential-clearing cannot silently discard it. Camera lifecycle behavior still needs an attended device check.

## Scheduled authorized check-in

An administrator-supplied assignment checkInPolicy defines revision, interval, response window, maximum evidence age and accuracy. The issuer persists the policy snapshot with the grant and returns it over authenticated HTTPS. No policy means no authorized check-in; demo cadence is not silently copied into real assignments. Slot zero opens at assignment start, later slots at the configured interval, and every window is bounded by assignment end.

The account screen now starts a scheduled check-in with a new local biometric prompt, then requests a fresh GPS observation. Server-time estimates use the authenticated monotonic anchor, not the editable phone clock. Mock fixes, insufficient accuracy, stale evidence and closed windows cannot complete capture. The final consented camera result retains the original grant and scope. Local check-in and photo metadata share one SQLite transaction, with duplicate slot protection and rollback on late failure. Credentials still clear before camera launch; sending requires sign-in again.

The server checks ordered evidence timestamps, original scope, exact photo link and policy revision before ingestion. Its unique guard/assignment/revision/slot record prevents duplicate captures across devices. Photo bytes have a separate receipt; metadata acceptance never means the photo was delivered or that dispatch received the check-in. Biometric and GPS data are signed client observations, not hardware attestation, named-person biometric identification or proof of physical presence.

69 Node tests pass. APK/test APK compilation, JVM checks and lint pass locally. The expanded HTTPS test now sends a scheduled synthetic check-in with its JPEG and separate media receipt; these new tests await CI execution. The prior photo/camera commit 026042d passed all jobs in Android run 39989616073, including HTTPS and API 28/API 35. No physical phone check is claimed. Background scheduled alerts, missed-check reasons and dashboard dispatch for this authorized flow remain to be connected; the existing demo implements those separately.

## Check-in delivery deadlines and reason history

The service now stores server receipt timestamps separately from capture timestamps and reconciles the explicitly assigned schedule when the guard refreshes authorization. Metadata alone leaves photo delivery pending. A complete evidence receipt after the window retains a missed-delivery record, including after service restart. The wording is deliberately about delivery: delayed/offline transport is not proof the guard failed to capture on time. Old records without receipt timestamps remain unknown rather than being assigned fabricated receipt times.

The authenticated, device-proven grant response includes a scoped delivery snapshot. Android shows the latest ten due checks, the original missed-deadline count, and a refresh action. Guards can append a nonempty reason under their current capture grant. The reason is encrypted locally and sent as an immutable observation; retry deduplication prevents duplicate notes, and adding a reason does not clear the original miss or claim dispatch notification. The service rejects reasons for an open window, wrong policy revision or a deadline that was not missed.

Reconciliation is currently request-triggered, not a deployed background scheduler. A policy is limited to 10,000 slots; responses include at most the latest 100 slots and explicit omitted counts. Full after-shift history, automatic escalation/notifications and dashboard delivery remain outstanding. 73 server tests pass, including restart retention, late first reconciliation, legacy timestamp migration, separate photo acceptance, reason validation and retry deduplication. Local Android APK/test APK build, JVM tests and lint pass. The real isolated local Supabase Auth/issued-grant HTTP round trip also passes and removes its synthetic account. HTTPS assertions for the status response are added; CI execution of this change is pending.

The preceding scheduled check-in commit de10bf9 has now passed all Android workflow jobs in run 39990538894: APK build, API 28, API 35 and the HTTPS check-in/JPEG integration. This verifies synthetic protocol behavior, not real biometric/GPS/camera hardware operation.

## Automatic local deadline reconciliation

The local service now runs a check-in worker at startup and every 30 seconds while the process remains running. It processes at most 20 assignment rows per tick, persists its cursor, resumes after restart, skips cancelled/future assignments, and records final reconciliation for ended schedules. A full sweep may take multiple ticks. Failed schedules are retried on later sweeps without starving subsequent assignments. Shutdown cancels the timer; cumulative failure counts are available to the local service runner without exposing guard identities or credentials.

Each missed delivery deadline creates one durable pending alert-outbox row in the same transaction as the miss. Repeated ticks, service restarts and later evidence do not duplicate or delete it. These are pending local notices, not sent dispatch messages. No notification adapter, hosted worker or phone background-alert service has been activated. Host sleep/process shutdown can delay detection; durable catch-up runs when the service resumes.

77 server tests pass, including an actual timer firing, cursor recovery, cancellation, finalized schedules, failure isolation and alert deduplication. The real isolated local Supabase round trip also passes. Existing hosted projects and applications remain unchanged.

## Authorized phone reminders

The assignment screen can enable one reminder schedule on the phone after grant verification and notification permission. It persists only an encrypted schedule, binding and boot-bound time anchor, never account credentials or capture authority. Notifications contain no guard or site name and open ordinary sign-in. A different authenticated guard, an assignment no longer returned by the service, assignment end, or reboot invalidates the reminders. Check-in completion suppresses the current cue; attempts persist before notification to prevent replay bursts. Stopping reminders does not remove records or alter server deadlines.

The app now declares SCHEDULE_EXACT_ALARM and offers the owner-controlled Alarms & reminders settings page. If access is available, it uses exact one-shot alarms; otherwise it uses an explicitly labelled inexact fallback. Permission settings, Doze, force-stop, restart and vendor power management can affect delivery. This is not a guaranteed safety channel. No full-screen activity or background sign-in is launched by this feature. Exact-alarm access is separate from notification permission. Reference: https://developer.android.com/develop/background-work/services/alarms

The encrypted event database upgrades to schema 4 with a hashed check-in lookup and validation against its original encrypted record. This avoids decrypting the full captured-event history during an alarm callback. Migration preserves existing events and queued receipts. Local APK/test APK compilation, JVM timing-boundary tests and lint pass; the newest instrumentation migration checks compile successfully and await execution on API 28/API 35 in CI. Physical notification timing on the Fold remains deferred.

The preceding server-worker commit 9a59bb3 passed build, HTTPS integration and API 28/API 35 in run 39992013384.

## Reminder test isolation correction

Reminder commit fae9938 passed the APK build, HTTPS integration and API 28 in run 39993160726. API 35 stopped during DeviceReadinessTest: its log shows notification-permission revocation followed by signal 9 termination of the instrumented app. The new reminder state test had previously granted that shared permission. It now injects notification readiness for its isolated schedule-state checks instead of changing the process-wide permission. Production still uses Android's real notification permission/channel checks. The corrected APK/test APK, JVM checks and lint pass locally; full emulator rerun is pending.
