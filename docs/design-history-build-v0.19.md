# Mercury One v0.19 — duty workflow prototype

Approved login particle rendering is unchanged. This build adds any-order patrol checkboxes, automatic timed readiness, check-in evidence collection, missed-check reasons and touch/route issue-location selection.

## Operational behavior

- Demo readiness is due every 15 minutes; demo check-in every 30 minutes. The app states this assumption; no live schedule is connected. Immediate shift check-in is also available.
- Readiness automatically opens a secure Android biometric prompt. Face or fingerprint availability is controlled by Android; the result does not identify a named guard. Unavailable, cancelled or failed authentication does not complete a check.
- Green is [0,2) minutes, yellow [2,5), red [5,10). A slow five-second color cycle is used, or a static color with system animations disabled. A successful readiness check stops the alert. Check-in also requires a fresh GPS fix and a consented site photo before completion.
- At ten minutes the original miss is persisted once with local pending delivery. Dispatch acknowledge records a nonempty reason without deleting the miss or claiming notification.
- Each new patrol checkbox requests a fresh fix, with a 20-second timeout. Successful records contain completion time, coordinates, fix timestamp, accuracy and mock-provider status. Failure/denial/cancellation leaves the checkbox unchecked. GPS is evidence, not proof of precise indoor presence.
- Tap the demo map or choose a named demo route point. The amber issue pin is separate from guard GPS. Actual site geometry, georegistration and roster authorization remain unavailable.

## Android constraints

The existing foreground location service can post normal notifications with the existing permission. No full-screen-intent access or additional security permission is added. A flashing/waking lock screen is not implemented or promised. The app recovers elapsed-time deadlines after background/lifecycle transitions and same-boot process restart. If service execution is stopped or suspended, reconciliation happens on next execution; no exact-time background escalation guarantee exists. Existing demo sessions invalidate on reboot.

Biometric success on a shared device is not named-person face identification. Production shared-site face login, device-owner kiosk management, physical-key admin access and authenticated site/guard schedules remain future architecture documented in the cumulative brief.

## Review captures

All images are actual emulator UI using synthetic data. Colored stages use separately seeded elapsed-time fixtures; they are not a ten-minute real-time recording. The photo-step screenshot uses synthetic biometric/GPS evidence to expose the UI; it is not evidence of successful hardware face authentication or measured site GPS. No actual site photo, real shift, live alert or external location transmission occurs. The walkthrough demonstrates app navigation, any-order patrol state, secure-verification-unavailable behavior, slow color pulsing and route issue selection.

## Validation

Local Java 17 / Gradle 8.10.2 / SDK 35 build, unit, lint and API 28/35 emulator results are recorded with the review deliverables. Physical Fold6 testing, successful enrolled biometric authentication, real GPS reception and camera hardware remain unvalidated. The debug APK is for testing and may have a different signer from CI; do not erase an existing installation to resolve a signature mismatch.

Recorded results: debug and instrumentation build, 10 JVM tests, and lint passed. Clean API 28 and API 35 regression runs each reported `OK (51 tests)` (46 executed regressions plus five opt-in/skipped captures/hardware cases). The initial Android 9 helper failure was corrected; identity-creation reruns require a clean synthetic app fixture. Final targeted checks also cover preservation of legacy v0.18 checkpoint records. No physical-device validation or remote action occurred.
