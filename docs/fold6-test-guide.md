# Mercury One Preview — Fold6 review

The new white interface is installed as **Mercury One Preview**, alongside the old Mercury Guard test app. The separate package avoids erasing the old app's encrypted test records when debug signing certificates differ. No original app was uninstalled or updated. Preview data and permissions are separate; old test incidents/photos have not been migrated.

The cover-display login and particle field have been visually checked on the actual Fold6. Biometric entry and all new workflows still need hardware review. No test assignment or tracking was started in the preview.

## Review and test

- Open Mercury One Preview. The particle field is the sign-in surface; the face is decorative artwork, not identity recognition.
- **⋯** opens Prototype tools. Device readiness, device information and local audit tools are here.
- **!** opens Escalate, including off-shift reporting. This prototype sends no emergency or dispatch message.
- To test a shift, explicitly choose Create 8-hour demo assignment and confirm. The app then checks precise location, enabled GPS and notifications, and requests a supported secure Android biometric. These are synthetic assignments; no live schedule, payroll or named-guard identity is connected. Do not enroll new device biometrics just for this test without deciding to do so yourself.
- On an active demo shift, patrol points are selectable in any order. Each checkbox requests a new GPS fix for up to twenty seconds; failure keeps it unchecked. Completed points cannot be recorded again in that session.
- Device readiness now confirms a refresh tap. GPS retry re-registers the service listener; it cannot force a satellite fix. Assess freshness and accuracy separately from permission.
- Readiness/check-in use the saved timed workflow and calm color stages. Check-in also requires fresh GPS and a consented site photo. Notification delivery remains subject to system settings and service lifetime.
- Clock out appears at the scheduled demo end. Earlier exit is under Escalate and requires a reason and confirmation. End the demo shift after testing so its tracking stops.

The preview build omits full-screen notification access. No new OS special access, kiosk management, keyguard change, reset, flashing, Supabase project or hosting charge was applied. The default developer build includes a separately opt-in full-screen pathway, which remains outside this preview's hardware validation.
