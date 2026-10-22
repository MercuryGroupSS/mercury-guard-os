# Mercury One v0.21 — optional full-screen duty alerts

## Eligibility and scope

Google Play's current Full-Screen Intent Permission policy distinguishes automatic grants (core alarms/calls) from other uses that require explicit user permission. Mercury One is a guard workflow app, not an alarm clock/calling app, and claims no automatic-grant eligibility. Its requested urgent on-shift readiness/check-in alerts support preparing the disclosed, user-consented pathway. This is an engineering interpretation, not Google Play approval. Any future distribution must accurately declare this use and satisfy review and device/network-abuse requirements. No distribution occurred.

Sources checked 22 October 2026:
- https://support.google.com/googleplay/android-developer/answer/9888170 (current policy, Full-Screen Intent Permission)
- https://support.google.com/googleplay/android-developer/answer/13392821
- https://source.android.com/docs/core/permissions/fsi-limits
- https://developer.android.com/about/versions/14/behavior-changes-14

## Implementation

Adds USE_FULL_SCREEN_INTENT to the manifest. The new pathway is deliberately restricted to Android 14+ and disabled by default through a separate app consent preference. No testing enables either consent or OS access. Earlier versions retain notification-opened alerts.

Device readiness offers an optional explanation with Not now, plus a user-driven link to ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT for this package. It never changes Android settings itself. A missing/blocked settings activity leaves app consent off. Turning off app consent is always available.

Before attaching a full-screen PendingIntent, the app checks consent, canUseFullScreenIntent(), notification permission, enabled notifications, HIGH duty-channel importance, locked/screen-off state, active shift, unsilenced prompt and a persisted once-per-prompt attempt. No new foreground-service type, exact alarm, overlay, DND bypass, keyguard bypass or background direct-activity launch is added. Notification category remains REMINDER. Subsequent sound/vibration updates do not relaunch the screen.

The OS-launched activity rechecks the active pending prompt, silence and consent/access. It uses setShowWhenLocked and setTurnScreenOn, retaining screen-on only while the valid alert activity remains visible. The existing four-second pulse, steady option, silence and deadline remain. Android keyguard must still be dismissed through the system before entry to the main app. Back/system controls remain available; no kiosk restriction is introduced.

## Smallest owner setup, pending

On Android 14+: Device readiness → Set up optional full-screen alerts → read disclosure → I agree / review settings → owner enables Allow full screen notifications for Mercury One. Notifications must already be permitted and the Duty verification channel HIGH with the owner's desired sound/vibration. Owner can decline or revoke; ordinary notification fallback remains. We did not perform these actions.

The OS may choose heads-up presentation instead of launch, and delivery still depends on the existing service executing. This change does not solve doze/process-kill/reboot scheduling guarantees. No production lock-screen or pocket/table reliability claim is made.

## Validation and residual blockers

Debug APK, instrumentation APK compilation, lint and all 15 JVM tests passed. Three new tests use synthetic access snapshots: granted route; each missing requirement; all 128 combinations; revocation and persistent repeat suppression. These tests do not grant device permissions or claim OS launch validation.

No v0.21 runtime install was performed: sideload installers can give the manifest permission an initial grant, so granted/denied conditions were tested as doubles as requested. The earlier v0.20 API 28/35 regression evidence is historical, not a v0.21 runtime pass. The approved particle source is unchanged.

Pending owner approval/device validation: actual special access and secure-keyguard test setup on a spare device. No device credential was configured. Full-screen launch, screen wake, secure lock/unlock, physical sound/vibration, emergency access, doze and Fold6 folded/unfolded behavior still need actual validation. No screenshots are claimed for this new optional setup screen.

If a distribution reviewer rejects this use, retain notification fallback. An explicitly approved enterprise deployment can separately evaluate fully managed device-owner/lock-task architecture and OEM-supported alert delivery while preserving secure keyguard and emergency access. It must not relabel Mercury One as an alarm/calling app, grant itself access, or disable keyguard as a workaround. No enrollment or such architecture was implemented.
