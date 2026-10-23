# Mercury One v0.23 — verification and handoff

Source commit: 6ded6a3111ed5a4c3e8b1e5e8b773c283fed2019.

[GitHub Actions verification](https://github.com/MercuryGroupSS/mercury-guard-os/actions/runs/39876216631) passed build, lint, APK signature verification and both API28/API35 instrumented suites. The existing opt-in capture/hardware cases remain skipped; no physical biometric/camera success is inferred. Local Preview APK and instrumentation assembly, lint and 15 JVM tests passed. Seventeen Node tests passed and the saved synthetic Android Keystore proof verified independently in Node.

The five new runtime cases cover atomic photo audit/link/completion, late database failure with rollback and retry, unrelated photo rejection for check-in completion, saved-prompt/timing validation and rollback cache reuse. Photo file retention cannot be atomic with SQLite across process/power loss; unreferenced encrypted-file recovery remains a production requirement.

Preview package: ca.mercury.guard.preview, version 0.23.0 (23).
APK SHA-256: 8397f0beb4bf009aad60dac9d8f3f8d0a97bac9910e0f02e644e1883f87eb556.
APK signature verified: v2, local debug certificate SHA-256 75bebfd6ec9e69a3e952670511b235b3d82bafbb8677c5169a347678227c07ef. The same preview certificate permits an update from v0.22. Signing keys are excluded from packages and repository. This is not production signing.

No USB device is currently connected; v0.23 installation has not been attempted. Earlier v0.22 Preview launch/cover-screen visual evidence and old v0.13 user-confirmed workflows are historical observations, not v0.23 hardware acceptance. Reconnect the Fold6 to install the update without uninstalling either package. Physical acceptance follows the bundled checklist.

Live auth, authoritative assignments, two-way existing-app data transport, real geometry, retention/revocation/recovery and dedicated-device management remain disconnected or pending. No additional hosting charge or existing app/database change. Full-screen notification special access is omitted from Preview. No device reset, flashing or enrollment.


## Physical test follow-up

The earlier no-device/pending-install state above is superseded: Preview v0.23 installed and core physical workflows passed on the Fold6. The test shift ended with tracking stopped and no Preview service/notifications. See [physical results](fold6-physical-v0.23.md) for evidence and uncompleted long-duration/hardware checks.
