# Android automatic delivery

The configured Mercury One account flow schedules durable delivery after verified sign-in and after an incident, checkpoint, acknowledgement, missed-check explanation or photo is saved. Android JobScheduler runs a network-constrained JobService even when the account screen is locked or the app process has restarted. The unconfigured preview and offline demo cannot schedule service requests.

## Upload authority and sign out

Only the current guard's short-lived access bearer is retained. Android Keystore encrypts it in private no-backup storage, together with the individually verified guard and vendor IDs, exact trusted service configuration fingerprint, installation fingerprint, expiry and work generation. Passwords and refresh tokens are never retained. Expiry uses monotonic time within the same boot; phone restart, time reversal, configuration replacement or installation mismatch requires sign-in again. Background delivery cannot renew an expired session.

Leaving the activity clears its foreground session and capture grants while previously authorized uploads may continue. Explicit Sign out or beginning another guard's sign-in immediately removes local upload authority, cancels that application's upload job and disconnects an active upload request. A bounded best-effort request also asks the original trusted service to revoke the prior Auth session. If the phone is offline, remote sign-out can remain unconfirmed; the deleted bearer is not retained for a deferred logout. A request already accepted by the server can still have its receipt saved for its original guard. Local sign-out cannot undo that server transaction.

The worker verifies the current guard/vendor profile and enrolled device before draining. Every ingestion request is independently authorized by the server. Account or device denial stops automatic work until reauthentication. No credentials, guard identity or service configuration are placed in system job extras.

## Original records and retry behavior

Each original assignment/device/revocation scope has an independent encrypted immutable batch snapshot. Migration preserves previously saved batch IDs and event bodies. A verified receipt atomically acknowledges only those original events. Exact receipt retries are idempotent across store instances.

An unavailable old scope cannot block another assignment indefinitely. Generic request denials are retained as review state after the account and device are verified again. They are not labelled permanent rejection, acknowledged, discarded or relabelled. A new verified sign-in retries the original request. Missing local media similarly remains for review while other photos can proceed. The signed evidence and existing receipts remain preserved.

Network failures, throttling and server failures use JobScheduler exponential backoff. Each run is bounded to 40 operations or 90 seconds between requests, with an independent 95-second cancellation deadline for a slow in-flight request; remaining eligible work is rescheduled. New captures increment a durable work counter. New work also replaces a pending or finishing job when no runner is active, avoiding the asynchronous completion wakeup race.

## Android and acceptance limits

Android controls scheduling and can delay work because of connectivity, Doze, battery restrictions, quotas or force-stop. This is not an immediate alert transport. A job stopped by Android disconnects its request and retries only while the same upload authority remains valid. Persisted work after reboot cannot upload until the guard signs in again. Exact timing, process death, battery restrictions, background behavior and session expiry still require attended Fold acceptance.

This change does not add continuous authorized GPS tracking, geofences, repeated patrol rounds or operational escalation delivery. Service acceptance remains separate from downstream Ops delivery and payroll.

The implementation follows the official [JobService lifecycle and cancellation contract](https://developer.android.com/reference/android/app/job/JobService) and [JobInfo network, persistence and backoff settings](https://developer.android.com/reference/android/app/job/JobInfo.Builder). Job requests use the network supplied by JobParameters. The manifest declares the required network-state and boot permissions and protects the service with BIND_JOB_SERVICE.

Local API 35 instrumentation has passed the actual Keystore, encrypted SQLite migration, concurrent preparation, original-scope review, receipt isolation and scheduler declaration tests. The separate local API 35 HTTPS instrumentation passed using the actual scheduled service against a synthetic Auth adapter and real Guard ingestion behind localhost TLS, including photo bytes, duplicate receipts and scoped provider sign-out. Its generated trust configuration is consumed only by the debug source set under `httpsTest=true`, in the separate `.httpstest` package. Preview and release packages must not contain that test configuration or certificate. Test results do not establish a live service deployment or physical-device acceptance.
