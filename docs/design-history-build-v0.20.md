# Mercury One v0.20 — attention alerts

Local prototype, 22 October 2026. Approved v0.18 login animation is unchanged. No push, deployment, backend, enrollment or identity change.

## Behavior

Readiness/check-in surfaces now pulse between a stronger stage color and white on a four-second cycle. Green remains 0–2 minutes, yellow 2–5 and red 5–10; expiry persists a missed record. System reduced motion and a persistent steady-color option suppress animation.

Notification cues are bounded to one attempt per 30-second elapsed-time slot, at most 20 per prompt. Attempt identities survive recreation and avoid replay bursts. A new installation configures a soft 0.65-second chime and two 400ms vibration pulses separated by 200ms. Existing notification-channel choices are preserved. Silence, notification swipe, user biometric cancellation, verification and shift end stop applicable cues. Silence never completes a check. GPS/photo requirements remain intact. Missed notifications are silent.

A user-opened alert activity supports presentation over keyguard and requires Android unlock before opening the main app. It never launches itself over the lock screen. Device readiness exposes delivery constraints and a user-operated link to notification-channel settings.

## Validation

- Debug APK, instrumentation APK, lint and 12 JVM tests passed (`attention-build.log`).
- API 28 and API 35 complete regression runs each reported OK (55 tests), before the final silent missed-notification adjustment.
- After that adjustment, all three AlertAttentionTest cases passed on both APIs. They cover bounded cadence/recreation, silence/expiry, channel preservation and biometric verification retaining outstanding check-in evidence requirements.
- Actual in-app pulse capture passed on API 35. Delivered H264 MP4 contains 225 frames at 30fps, preserving captured timing; it is silent.
- API 28 screen-off capture passed: notification existed while screen was off; channel vibration was enabled; user-opened activity did not complete verification. This emulator has no secure keyguard. The screenshot demonstrates the alert layout, not secure lock-screen validation.
- Separate API 28 video capture produced an empty file and is excluded. The delivered animation preview is the successful API 35 in-app recording.
- Chime WAV is the configured sound asset, not a recording of a physical speaker. Emulators ran without audio. No physical vibration, pocket/table wake-up or Fold6 validation occurred.

## Remaining requirements

Automatic full-screen wake/flashing is not implemented or enabled. A separately authorized, eligible full-screen-intent implementation and owner special-access review are required; enabling a setting alone cannot add it to this build. No sensitive permission was granted. Only the normal VIBRATE manifest permission was added.

Notification permission, channel settings, silent mode/DND, doze and foreground-service lifetime constrain delivery. There is no guarantee of 30-second delivery while execution is suspended/killed. Reboot invalidates the demo session; no automatic reboot restart is added. Existing installations must review their own channel sound/vibration settings, which this update does not override.

Official Android references and the unconfirmed shared-device identity proposal are preserved in project-brief.md. Real dispatch and production identity/schedule integration remain absent.
