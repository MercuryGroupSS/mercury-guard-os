# Mercury One — Mercury Guard OS Android prototype

A native Android local pilot for Mercury guard workflows. The current build combines the white Mercury One interface and particle-face sign-in surface with encrypted offline records, explicit demo assignments, native secure biometrics, patrols in any order, incident/photo capture, timed readiness/check-ins and calm alerts. Escalate is available off shift; scheduled clock-out and confirmed reasoned early exit control local tracking.

The face animation is decorative; native Android biometrics authenticate an enrolled device user, not a named Mercury guard. Assignments and site schematic are synthetic. GPS observations do not establish checkpoint presence. No emergency, dispatch, payroll or live backend message is sent.

See [v0.23 local pilot closeout and physical acceptance](docs/local-pilot-closeout.md), [combined interface/workflows](docs/build-v0.22.md), [development brief](docs/project-brief.md) and [Fold6 guide](docs/fold6-test-guide.md).

## Data and integration boundaries

Retained event payloads, drafts and photos are encrypted locally; IDs/counts remain visible and history is not immutable. Camera output is temporarily plaintext in private cache. Key-loss recovery, retention and crash recovery require production work. Use harmless synthetic data. See [local data security](docs/local-data-security.md).

Signed batches, installation keys, scoped grant verification, an encrypted incoming cache and offline Node reference tests provide integration foundations. Demo records are disconnected from production authority. No live transport, authenticated guard identity, authoritative schedules, real site geometry, durable production ingest or existing-app integration is enabled. No new hosted project or charge is required for this local pilot.

Timed local alerts depend on execution and Android settings; background/doze/process-death delivery is not guaranteed. The isolated Preview variant omits full-screen notification special access. The default developer variant retains a separately opt-in pathway. Device-owner/kiosk management is not enabled.

## Build and install

Requires Android SDK 35, Java 17, Gradle 8.10.2 and Android Gradle Plugin 8.7.3. Run `gradle :app:assembleDebug`; APK output is `app/build/outputs/apk/debug/app-debug.apk`. GitHub Actions compiles, tests, lints and verifies the APK, then runs instrumented suites on API 28 and 35.

For a separate review app, build with `-PlocalPreview=true -PlocalDebugKeystore=/absolute/path/to/your/debug.keystore`. The application ID becomes `ca.mercury.guard.preview`, labelled Mercury One Preview. Keep signing material private and stable for updates; never commit it. These are debug APKs, not production release signing.

Preserve the original installed application if signing certificates differ. Uninstalling it destroys access to its Keystore-protected local data. Preview data/permissions are separate; no automatic migration is performed. No root, reset, flashing or device enrollment is needed for APK testing.

The original v0.1 source was recovered in commit `5269cbeace7fb527fe73237628b38b12f568251e`. Subsequent design history and protocol work remain documented under docs.

## After physical acceptance

Connect authoritative identity/schedules through approved restricted adapters, persist capture-time scope and implement authenticated durable two-way sync. Complete privacy/retention/revocation, operational authorization, production distribution, background/battery testing and monitoring. Existing apps/data remain unchanged until a separately reviewed integration is authorized.

Dedicated-device management and [flashable OS feasibility](docs/firmware-track.md) are separate tracks after APK acceptance. No compatible Fold6 system image or bootloader/recovery route has been validated.
