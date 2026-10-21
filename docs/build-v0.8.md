# Mercury Guard OS v0.8 — device readiness and notification permissions

Adds a device-readiness screen reachable from standby and active demo shifts. It reports precise-location permission, GPS provider availability, notification permission/app/channel state and process-local GPS request observations. Viewing/refreshing it does not start a shift, collect GPS or write audit events. A last-fix age is an observation, not proof of current accuracy or physical presence. Process death resets these observations.

Android 13+ notification permission is requested only through an explicit button. Notification/location settings open for the user to change. An active demo shift can explicitly retry GPS or request precise location. Approximate-only location is insufficient for this GPS service. Permission denial keeps offline notes/photos/manual patrols available. No notification permission is used as a location grant. Foreground-service notification text now says GPS is requested instead of claiming a fix is active.

Android may run a foreground service even if notification permission is denied; device readiness labels notifications blocked without falsely claiming tracking must be off. See [Android notification-permission documentation](https://developer.android.com/develop/ui/views/notifications/notification-permission). Foreground-service/system indicator behaviour, Samsung One UI settings, GPS acquisition and battery use still need physical Fold6 checks.

No production backend, network sync, management/enrollment, other repo or existing app changes. White Jarvis-inspired design remains deferred. Stable release signing remains pending.

Validation passed: six unit tests and twenty-five device tests on each API 28 and 35, build, lint and APK signature verification. Automated coverage checks denied permissions and passive readiness viewing; real system permission-dialog choices and live GPS are not validated by those tests.

Source commit `ff522ba4f85012a21f1b4334e1467b83485df0d1`, [run 39626672617](https://github.com/MercuryGroupSS/mercury-guard-os/actions/runs/39626672617). APK SHA-256: `9f2602560d813f5b39fd3f64394fb5ea8e048bf1fadf7cb512bd66e30a2924a9`. Downloaded artifact digest and APK checksum were compared locally.
