# Galaxy Z Fold6 test APK v0.5

This APK is a removable offline prototype. It does not replace Android or connect to existing Mercury applications. Use synthetic test notes only.

## Obtain and install

1. Open the successful GitHub Actions run for the exact commit. Download MercuryGuardOS-test-apk and unzip it.
2. Compare app-debug.apk against SHA256SUMS.txt from the same artifact.
3. Copy the APK to the Fold6 and open it. Permit installation from that specific source if Android asks. No reset/root/device-owner enrollment is needed.
4. Launch Mercury Guard. Keep location denied initially to test offline operation. Begin a simulated shift; optionally grant location later. Location is collected only after an explicit shift start and a precise-location grant.

Debug signing is for tests, not production updates. A fresh hosted runner may use a different debug certificate: an existing install with a different certificate will reject an update. Export synthetic data before uninstalling the previous test app if needed. Stable private release signing remains a production task.

## Acceptance checks

- Standby shows LOCAL DEMO ONLY and no active assignment. The pending-event count increases with new records; network sync is disabled, so normal use never marks records as delivered.
- Start shift with location denied: incidents and patrol/check-in records still work.
- Open the demo patrol route; record Main entrance, reopen the app, then record Perimeter and Control point. Verify progress is preserved and the completed route cannot be recorded again. End and start another shift; verify its route starts at zero. These manual entries do not prove physical presence.
- Record a synthetic incident; rotate and fold/unfold; verify records persist. Unsaved incident text and readiness choices should also survive activity recreation.
- If location is granted, verify the system's foreground tracking indicator. End shift and confirm it stops; no further GPS events should be recorded.
- Reboot: no tracking restarts and the session is invalidated.
- Confirm notification behavior on the installed Android/One UI version, cover/inner display usability, large text, back navigation, and battery consumption.
- Capture a synthetic test photo: confirm camera opening, take and accept the photo, then verify the photo_evidence event in audit export. No identity/uniform verification or upload occurs. Cancel a second capture and verify it is not retained. Physical camera behavior is unverified until this test.
- Export audit JSON after reading the decrypted-export disclosure, using Android's share chooser to a destination you choose. Photos are excluded.

Passing emulator tests does not establish Fold6 hardware compatibility. Record model, Android/One UI version, test steps and failures before fleet use.
