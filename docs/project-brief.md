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
