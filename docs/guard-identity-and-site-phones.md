# Guard identity and shared site phones

Confirmed operating decisions: site phones use biometric verification, then individual guard user ID and a private credential. Vendor IDs may represent companies or individual guards. Vendor identity is not sufficient to identify or authorize a person.

## Existing dashboard compatibility

Read-only source review on 23 October 2026 found `hr/migrations/M1_hr_schema_and_employees.sql` restricts employees to one record per vendor, with an EMP-vendor ID format. That payroll model cannot serve as a company guard roster. Source review does not prove which migrations are applied live. Keep payroll and billing unchanged. Create a separate guard roster with stable guard ID, unique authenticated subject, active state and explicit vendor link. Reuse confirmed links; never infer identity from a name or vendor login.

## Sign-in and assignment path

1. Approved site phone performs local Android strong biometric verification. This gates the UI; it does not identify which enrolled person touched the sensor and must not be claimed as remote biometric proof.
2. Guard enters individual user ID and private credential. An authenticated server resolves exactly one active guard and active linked vendor. Credential enrollment, recovery and rate limiting remain required before deployment. Prefer managed account passwords over a custom short-PIN authentication system.
3. The installation proves its enrolled key. A site phone can obtain only assignments for its registered site and the authenticated guard. A personal phone is bound to its guard. Future schedules may be displayed but do not authorize early clock-in.
4. A server issues short-lived signed shift authorization. Capture retains original guard, assignment, site and device scope. Vendor context must also be retained authoritatively rather than recomputed after a later vendor transfer.
5. Shift end removes the foreground guard session. Pending records keep their original ownership and use a separately authorized historical-upload policy; a new guard cannot inherit the previous guard's records or credentials.

## Implemented checkpoint

`server/guard-directory.mjs` implements trusted-provider identity resolution and assignment/device filtering. Four new tests cover multiple guards under one company, ambiguous/inactive mappings, cross-guard and cross-site access, revoked devices, personal devices and schedule boundaries. All 41 server tests pass locally.

This module is not yet wired into the HTTP service. No new accounts, migrations or live dashboard writes were made. Next: persist the roster locally, implement credential login and device enrollment, connect authoritative assignment reads and signed grants, then integrate Android session lifecycle. Live roster coverage remains unverified and no private HR or payroll records were fetched.

## Persistent identity endpoint checkpoint

The local synthetic-data service now accepts an optional persistent SQLite roster and serves GET /v1/me after remote Supabase token verification and guard/vendor resolution. Responses include only guard_id and vendor_id, with no-store headers. No self-enrollment or roster write endpoint exists. The local launch script opens the roster alongside the ingestion store. The roster stores no credentials or biometric templates; it is plaintext synthetic data, not a production directory.

Validation: 43 Node tests passed. The actual local HTTP smoke test signed in a temporary Supabase account, resolved its guard/vendor profile, disabled the guard and verified 403, then re-enabled it and completed signed ingestion, restart deduplication and revocation checks. Temporary account and files were removed. Profile identity does not establish device enrollment or issue a shift grant. When the roster is configured, batch authorization also checks the active guard/vendor and matching guard ID on every request, including retries. The real HTTP test confirmed a disabled roster identity receives 401 for a batch retry. The legacy no-roster test composition remains available for protocol fixtures; the launch script always supplies a roster.

## Device and assignment delivery checkpoint

LocalDeviceAssignments persists administrator-approved installation keys, site/personal phone bindings, explicit guard/vendor/site assignments and short-lived device challenges. POST /v1/device-challenge requires an authenticated active guard and enrolled phone. POST /v1/assignments requires the Android-compatible P-256 challenge proof. Challenges expire after 60 seconds, are tied to the authenticated subject, and are consumed atomically. A used challenge remains unusable after restart. Creating another challenge replaces that subject/device pair's pending challenge.

Only matching guard/vendor/site/device assignments are projected. Future assignments can be listed but cannot start; cancelled or expired assignments are omitted. Enrollment and assignment provisioning currently use trusted local administrative methods, not an unauthenticated enrollment API. No production device has been enrolled.

The default local launch supplies both roster and device stores. Batch authorization also checks the registered key, device state and active current assignment. Historical upload after expiry/cancellation is deliberately unavailable until a separate historical authorization policy is implemented; queued records must remain preserved. This does not constitute shift grant issuance or automatic enrollment.

Verification: all 47 server tests passed, including persistence/replay, expiry, wrong key/subject, revoked devices, cancelled assignments, guard/site filtering and bounded request bodies. The real local Supabase/HTTP smoke test passed identity lookup, signed device proof, scoped assignment delivery, replay denial, disabled guard upload denial, signed event ingestion, restart deduplication and authority revocation. Synthetic account and databases were cleaned up.

## Signed shift grant checkpoint

POST /v1/shift-grant consumes a fresh authenticated device proof and selects only an eligible current assignment. A fixed RSA-SHA256 issuer signs the existing Android grant format. Expiry is the earliest of 15 minutes, session expiry and assignment end. Guard/site/assignment/key/revocation scope is signed; vendor and authenticated subject are retained in the issuer audit table. No client-selected actions are accepted. The local issuer key is generated once into the ignored .local-backend directory with owner-only permissions; existing invalid material causes failure instead of replacement.

Fifty Node tests pass. The local HTTP smoke test obtained and cryptographically verified a grant and rejected a repeated proof, alongside the existing identity, device, assignment and ingestion tests. A Node-generated public-key-only fixture and Android instrumentation test now cover the server-to-Android grant format; emulator execution is pending. This fixture is test-only and is not a trusted production issuer.

Remaining: Android account/session and assignment integration, trusted HTTPS and issuer distribution, grant-history validation on ingestion, authorization of post-shift uploads, operational roster provisioning and live dashboard integration. Grant issuance does not yet replace the separate pilot ingestion authority. The running prior service process must not be assumed to include new source until restarted; smoke tests launch their own isolated current-source service.

## Guard ID/password and Android client checkpoint

POST /v1/session/login resolves an exact guard ID through a server-only account-email mapping, exchanges its password with Supabase, verifies the resulting token subject, and rechecks the active mapping before returning it. Responses contain only access token, expiry and server time. Passwords are not stored; refresh tokens are not sent to the phone. Unknown IDs, disabled guards and bad credentials share the same 401 response; timing uniformity is not claimed. Persistent local limits allow at most five attempts per ID per five minutes and 100 globally per minute. Global capacity is checked before allocating per-ID buckets. Production requires distributed/per-origin abuse controls, account recovery and operational provisioning.

GuardAccountClient supports HTTPS sign-in, profile, device proof, assignment reads and grant requests. Access tokens live only in memory and are redacted in diagnostic string output. The session lifetime uses monotonic time anchored conservatively at request start; clearing or expiry prevents reuse. Caller password arrays are cleared, but JVM string copies cannot be guaranteed erased. No operational UI or trusted service configuration is enabled yet. Biometrics remain a local UI prerequisite to be wired into the sign-in flow, not a server identity claim.

Verification: 54 Node tests passed. The local HTTP round trip verified guard ID/password sign-in and the resulting Supabase identity, no refresh token in the response, device proof, assignment and grant delivery, upload/retry and revocation behavior, then removed synthetic data. Android account-client tests cover rejected origins, expiry, explicit clearing and diagnostic redaction; emulator results are pending. The Android client has not yet been exercised over a real HTTPS connection or on the Fold.
