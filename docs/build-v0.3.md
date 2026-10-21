# Mercury Guard OS — build continuation v0.3 / brief v1.4

Date: 20 October 2026 (America/Toronto). App version 0.3.0, version code 3.

## Accepted direction

Continue functionality before the visual redesign. The user wants the later UI to feel futuristic, clean and high tech, inspired by a white Jarvis interface. This is a future design direction; the current functional screens remain in place. The Mac simulation represents v0.2 and has not been upgraded to represent v0.3 camera or encryption behavior.

## Changes

- Encrypt complete retained audit events using per-install Android Keystore AES-256-GCM, with authenticated purpose separation and no plaintext fallback.
- Preserve and migrate version-1 logical events without replacing the database.
- Replace the photo placeholder with a user-confirmed camera-intent flow; validate returned JPEGs, encrypt retained photos and record hashes/metadata. This is capture, not identity/uniform verification.
- Preserve unsaved incident drafts and readiness challenge choices during activity recreation.
- Reject missing keys on decryption and authenticate existing encrypted database contents before accepting new writes.
- Handle GPS storage failures by stopping tracking; retain Android 9-compatible provider callbacks.
- Stop active screens when a demo shift expires while the app is foregrounded.
- Export decrypted audit records through a scoped file URI after a disclosure/confirmation, avoiding intent-size limits.
- Add device tests for encryption, migration, media validation, draft preservation and camera-consent cancellation.
- Document local threat/retention limitations and a proposed staging trust boundary. No live backend is connected.

## Verification

Build, lint (with non-blocking warnings), APK signature verification and all six unit tests passed. All nine instrumentation tests pass on each of Android 9/API 28 and Android 15/API 35. An initial database-configuration error was caught by the emulator tests and corrected before delivery.

Tested source commit: b97664ea17cd1c1a1a47fc6cbce7763d1f4237d5.
Successful run: https://github.com/MercuryGroupSS/mercury-guard-os/actions/runs/39531065069.
APK SHA-256: 4b66bf6c2e1b26bc8a7caf4f9c3ac91ba2cfecf26f0eea5b1b66114a4f71236c.

Physical Fold6 camera/folding/GPS/battery tests remain pending. Tests validate storage and the camera-consent boundary, not an actual Samsung camera capture or biometric verification. Do not infer production readiness from local encryption.

## Still outstanding

Production identity and server-signed grants; authenticated staging API and sync/retry/idempotency; geofences/routes; automated patrol/readiness scheduling and escalation; dispatch messaging; media review/upload/retention; stable release signing; fleet provisioning/device control; recovery; physical battery/GPS/camera tests; final white futuristic UI. Earlier cumulative briefs and firmware constraints remain in force. No phone reset, rooting, flashing, enrollment, existing-app modification or other-repository changes occurred.
