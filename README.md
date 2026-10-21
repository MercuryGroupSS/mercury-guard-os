# Mercury Guard OS — Android prototype v0.8

Native Kotlin Android prototype for Samsung Galaxy Z Fold6, with portable Pixel-compatible APIs. This is **not** an actual replacement operating system, production guard tracking system, or production-ready deployment. See GitHub Actions for the current build/test result.

## Current functionality
- Mercury-branded native UI: standby, simulated shift, active shift, ordered persistent demo patrol, readiness challenge, incident note, dispatch acknowledgement, check-in, end shift
- Opt-in visible foreground-service GPS during a simulated shift; 30-second / 15-metre requests (Android may throttle); stops at end/expiry and never resumes after reboot
- Encrypted local SQLite event payloads using a per-install Android Keystore key; user-confirmed JSON file export
- Durable encrypted outbox with stable event IDs and local receipt validation; network sync remains disabled
- User-confirmed camera photo capture with encrypted local retention and hashed event metadata
- Device readiness shows permissions, GPS availability and process-local request/fix observations; explicit Android 13+ notification permission flow
- Read-only paged local audit viewer and event details; no delivery-state changes
- Encrypted durable incident drafts survive app reopen; transactional submission and confirmed discard
- Readiness choices preserved through activity recreation
- Device-owner and kiosk capability inspection (read-only)
- Resizable scrolling layout with system-bar insets; physical Fold6 folding tests pending

## Not yet implemented
Production server-side shift authorization; secure authentication; biometric/liveness confirmation; verified uniforms; evidence review and upload; automated randomized patrols; background alerts; messaging; backend synchronization; role permissions; MDM enrollment; tamper detection; proper credential-based export; remote management; financial and schedule integration.

**Test-only release:** Demo shifts remain locally simulated and no server verifies authorization. Retained event payloads/photos are encrypted; IDs/counts remain visible and the audit history is not immutable. Old plaintext remnants, temporary camera/export copies, key-loss recovery and production retention remain unresolved. Use synthetic data only. See [local data security](docs/local-data-security.md). Do not enroll real devices as device owner using this test build.

## Build

The original v0.1 source was recovered unchanged in commit `5269cbeace7fb527fe73237628b38b12f568251e`. Current changes add compilation fixes, bounded demo sessions, local encryption, photo capture and automated tests. See [v0.8 continuation](docs/build-v0.8.md). See [development brief](docs/project-brief.md) and [Fold6 test guide](docs/fold6-test-guide.md).

Requires Android SDK 35, Java 17, Gradle 8.10.2 and Android Gradle Plugin 8.7.3. Run `gradle :app:assembleDebug`. APK appears in `app/build/outputs/apk/debug/app-debug.apk`. GitHub Actions build workflow provided. Android developer installation: enable permitted app sideloading, install debug APK; **no root, flash, factory reset, or system takeover**.

## Roadmap
1. Validate camera, GPS, folding, battery and permission behavior on the physical Fold6.
2. Authenticated server shift grants (short TTL, signed), role/site rules, location policy, media review/upload and offline sync.
3. Patrol routes/checkpoint proof, randomized prompts, tamper indicators, incidents, dispatch, push notifications.
4. Add Android Enterprise management / dedicated-device kiosk for company-owned phones; separate administrator-controlled provisioning using factory-reset test unit.
5. Production diagnostics, audit logging, privacy notices, battery impact tests, staging API integration with Mercury Operations Dashboard.
6. Optional **Pixel-only** custom Android firmware feasibility track. Never flash the Galaxy Fold6 with an unverified image; bootloader unlock support depends on precise model/region.
