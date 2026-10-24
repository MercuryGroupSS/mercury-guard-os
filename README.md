# Mercury One — Mercury Guard OS

Mercury One is a native Android guard application with a white/cyan interface and particle-face sign-in surface. It includes an offline demonstration and a separately configured, individually authenticated account flow. A valid trusted configuration launches enrollment/sign-in directly; a missing configuration opens the demo, and a malformed configuration blocks connected entry.

The connected implementation supports approved assignments and confirmed shifts, encrypted incidents/drafts/photos, any-order checkpoints and explicit patrol rounds, timed check-ins, dispatch acknowledgements, signed scoped grants/batches, durable queued delivery and separate receipt states. Escalate works without an active assignment and distinguishes service receipt from explicit operator acknowledgement. Optional shift location requires an approved exact notice/policy, separate individual consent and a short signed lease; withdrawal stops collection and blocks original location retries without blocking independent incidents.

The current [v0.35 Preview](docs/build-v0.35.md) is unconfigured and debug-signed. It fixes missed clock-out reservation and exact assignment resource cleanup while preserving explicit attendance. The immutable package record records its exact build, emulator and GitHub results. See the [current project brief](docs/project-brief.md) and [attended Fold checklist](docs/fold-acceptance-v0.35.md). Live deployment and current Fold acceptance remain open.

## Data and integration boundaries

Individual Supabase Auth subjects remain distinct from company Vendor IDs. Handset biometrics gate local access; they do not identify a named guard to the server. Demo records do not become operational records. GPS observations do not establish checkpoint presence. Camera output is temporarily plaintext in private cache; original records remain encrypted under their own scope. See [local data security](docs/local-data-security.md).

The PostgreSQL backend implements current Auth-session checks, guard/device/site approvals, reviewed administration, immutable ingestion/receipts, original-scope private photo transfer and receiver rendering. Source reads and observation/media sending require explicit approved mappings and credentials. An isolated receiver receipt does not prove processing or display in an existing Ops application. Existing repositories/applications remain unchanged; no hosted project, real contact, payroll action or alert transport is activated by this source.

There are two service paths: the existing loopback [local stack](docs/service-configuration.md), and the explicit [configured HTTPS service](docs/configured-service.md). The latter requires supplied private runtime/TLS/issuer files and an owner-installed deployment binding; it creates no accounts or approvals at startup. Inspect/check commands do not activate workers. Local Auth tests use the owned isolated stack and require no new hosted project.

Android controls scheduling, Doze and battery restrictions. Actual SDK GNSS, cover/inner-screen behavior, camera/biometric return and full-shift endurance remain attended hardware gates. Typed synthetic emulator transport is separately labelled and does not establish physical GPS. The Preview omits full-screen notification special access; the default developer variant has a separate opt-in pathway. Device-owner/kiosk management is not enabled.

## Build and install

Requires Android SDK 35, Java 17, Gradle 8.10.2 and Android Gradle Plugin 8.7.3. Run `gradle :app:assembleDebug`; APK output is `app/build/outputs/apk/debug/app-debug.apk`. GitHub Actions builds, tests, lints and verifies the APK, runs API 28/35 suites and separate HTTPS checks, and replays canonical PostgreSQL migrations/contracts. The location job explicitly uses synthetic typed observations and leaves SDK GNSS unverified.

For a separate review app, build with `-PlocalPreview=true -PlocalDebugKeystore=/absolute/path/to/your/debug.keystore`. The application ID becomes `ca.mercury.guard.preview`, labelled Mercury One Preview. Keep signing material private and stable for updates; never commit it. These are debug APKs. The separate [controlled release builder](docs/controlled-apk.md) verifies a supplied signing identity, exact clean source and public service configuration in an isolated release build. It neither generates production keys nor installs on a phone.

Preserve the original installed application if signing certificates differ. Uninstalling it destroys access to its Keystore-protected local data. Preview data/permissions are separate; no automatic migration is performed. No root, reset, flashing or device enrollment is needed for APK testing.

The original v0.1 source was recovered in commit `5269cbeace7fb527fe73237628b38b12f568251e`. Earlier immutable builds and [development history](docs/development-history-through-shared-delivery.md) remain preserved.

## Remaining activation

Supply the approved reachable HTTPS origin, owner/individual identities, enrollment and Ops source/destination configuration; verify real email and actual connected-app exchange. Complete production signing/update recovery, retention/backups, capacity/security acceptance and attended Fold testing. These operational inputs and hardware results are not inferred from local fixtures or green CI.

Dedicated-device management and [flashable OS feasibility](docs/firmware-track.md) are separate tracks after APK acceptance. No compatible Fold6 system image or bootloader/recovery route has been validated.
