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
