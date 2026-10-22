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
