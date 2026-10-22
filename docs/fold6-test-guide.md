# Galaxy Z Fold6 test APK v0.11

This APK is a removable offline prototype. It does not replace Android or connect to existing Mercury applications. Use synthetic test notes only.

## Obtain and install

1. Open the successful GitHub Actions run for the exact commit. Download MercuryGuardOS-test-apk and unzip it.
2. Compare app-debug.apk against SHA256SUMS.txt from the same artifact.
3. Copy the APK to the Fold6 and open it. Permit installation from that specific source if Android asks. No reset/root/device-owner enrollment is needed.
4. Launch Mercury Guard. Keep location denied initially to test offline operation. Begin a simulated shift; optionally grant location later. Location is collected only after an explicit shift start and a precise-location grant.

Debug signing is for tests, not production updates. A fresh hosted runner may use a different debug certificate: an existing install with a different certificate will reject an update. Export synthetic data before uninstalling the previous test app if needed. Stable private release signing remains a production task.

## Acceptance checks

- In Device information, viewing must not initialize an installation identity. Cancel key creation and confirm no fingerprint appears. Explicitly create it, reopen/rotate and verify the same public fingerprint. No enrollment/upload or guard authentication should occur. This key is separate from APK signing; hardware backing and attestation are unverified.
- Signed upload-batch preparation is a tested code boundary only; this build has no network upload or successful-sync button. Review must keep events pending.
- Device information should state that server authorization is disabled because no staging issuer/trusted key is configured. A local demo shift remains a simulation; this build cannot enroll/authenticate a real guard or fetch grants.
- Standby shows LOCAL DEMO ONLY and no active assignment. The pending-event count increases with new records; network sync is disabled, so normal use never marks records as delivered.
- Start shift with location denied: incidents and patrol/check-in records still work.
- Open the demo patrol route; record Main entrance, reopen the app, then record Perimeter and Control point. Verify progress is preserved and the completed route cannot be recorded again. End and start another shift; verify its route starts at zero. These manual entries do not prove physical presence.
- Record a synthetic incident; rotate and fold/unfold; verify records persist. Incident drafts and readiness choices should also survive activity recreation. Type a synthetic draft, close/reopen the app and resume it. Cancel should keep it; Discard should require confirmation. Submit it once and verify one incident event and an empty draft. Drafts remain across demo shifts on this test device; there is no per-guard identity separation.
- Open Device readiness before starting a shift: no GPS request should start. Verify precise-location, GPS provider and notification states against system settings. On Android 13+, request notifications explicitly and test both allow/deny; changing notifications must not grant location. During an active shift, retry GPS only through its button. Disable/re-enable GPS in settings and refresh; distinguish requesting updates from a received fix.
- If location is granted, verify the system's foreground tracking indicator. End shift and confirm it stops; no further GPS events should be recorded.
- Reboot: no tracking restarts and the session is invalidated.
- Confirm notification behavior on the installed Android/One UI version, cover/inner display usability, large text, back navigation, and battery consumption.
- Capture a synthetic test photo: confirm camera opening, take and accept the photo, then verify the photo_evidence event in audit export. No identity/uniform verification or upload occurs. Cancel a second capture and verify it is not retained. Physical camera behavior is unverified until this test.
- Open Review local audit events from standby and active shift. Open an incident record, rotate/fold and verify detail recovery. Browse Older records and Newest records when enough events exist. Review must not change event or pending counts. Drafts must not appear before submission; photo records show metadata only.
- Export audit JSON after reading the decrypted-export disclosure, using Android's share chooser to a destination you choose. Photos are excluded.

Passing emulator tests does not establish Fold6 hardware compatibility. Record model, Android/One UI version, test steps and failures before fleet use.
