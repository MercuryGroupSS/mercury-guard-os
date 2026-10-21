# Mercury Guard OS — Android prototype v0.2

Native Kotlin Android prototype for Samsung Galaxy Z Fold6, with portable Pixel-compatible APIs. This is **not** an actual replacement operating system, production guard tracking system, or production-ready deployment. See GitHub Actions for the current build/test result.

## Current functionality
- Mercury-branded native UI: standby, simulated shift, active shift, patrol checkpoint, readiness challenge, incident note, dispatch acknowledgement, check-in, end shift
- Opt-in visible foreground-service GPS during a simulated shift; 30-second / 15-metre requests (Android may throttle); stops at end/expiry and never resumes after reboot
- Local SQLite audit event queue and JSON export; clearly labelled offline/demo records
- Device-owner and kiosk capability inspection (read-only)
- Resizable scrolling layout with system-bar insets; physical Fold6 folding tests pending

## Not yet implemented
Production server-side shift authorization; secure authentication; encrypted media storage; biometric/liveness confirmation; actual camera capture; verified uniforms; automated randomized patrols; background alerts; messaging; backend synchronization; role permissions; MDM enrollment; tamper detection; proper credential-based export; remote management; financial and schedule integration.

**Privacy/security warning:** Prototype uses unencrypted SQLite and an unrestricted local demo shift button. Do not use real employee/client data. Prototype local events are not cryptographically tamper-evident, and no server verifies authorization. Do not enroll real devices as device owner using this test build.

## Build

The original v0.1 source was recovered unchanged in commit `5269cbeace7fb527fe73237628b38b12f568251e`. Current changes add compilation fixes, bounded demo sessions and automated tests. See [development brief](docs/project-brief.md) and [Fold6 test guide](docs/fold6-test-guide.md).

Requires Android SDK 35, Java 17, Gradle 8.10.2 and Android Gradle Plugin 8.7.3. Run `gradle :app:assembleDebug`. APK appears in `app/build/outputs/apk/debug/app-debug.apk`. GitHub Actions build workflow provided. Android developer installation: enable permitted app sideloading, install debug APK; **no root, flash, factory reset, or system takeover**.

## Roadmap
1. Compile and test on clean Android emulator and Fold6; camera integration / permission review.
2. Authenticated server shift grants (short TTL, signed), role/site rules, encrypted local audit queue, media capture, location policy, offline sync.
3. Patrol routes/checkpoint proof, randomized prompts, tamper indicators, incidents, dispatch, push notifications.
4. Add Android Enterprise management / dedicated-device kiosk for company-owned phones; separate administrator-controlled provisioning using factory-reset test unit.
5. Production diagnostics, audit logging, privacy notices, battery impact tests, staging API integration with Mercury Operations Dashboard.
6. Optional **Pixel-only** custom Android firmware feasibility track. Never flash the Galaxy Fold6 with an unverified image; bootloader unlock support depends on precise model/region.
