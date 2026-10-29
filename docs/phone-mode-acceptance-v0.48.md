# Personal and shared site phone acceptance

A shared site phone must identify the individual guard using it. A personal
phone should allow biometric return sign-in after its initial account setup.
These are distinct requirements: a handset fingerprint alone is not a server
identity, and an approved company vendor can represent several guards.

## Current build

The backend supports two approved enrollment modes:

- `site`: one installation key is bound to one site. Each authenticated guard
  receives only their own assignments at that site.
- `personal`: the installation key is bound to one guard. That guard receives
  their own assignments across approved sites; another guard cannot use it.

The v0.47 Android Preview still uses biometric verification followed by Guard ID
and password in both cases. It does not implement personal biometric return
sign-in. It persists neither the interactive session nor refresh tokens. A login
prompt does not establish that a phone has approved site enrollment.

Personal return sign-in needs an approved individual binding and a revocable
account credential protected by strong Android biometrics. It must recheck
current server identity, enrollment and revocation. A stored password, caller
biometric flag, vendor ID or enrolled fingerprint is not an individual server
identity. Shared phones must not inherit personal return credentials.

## Actual local Auth gate

`server/scripts/verify-configured-phone-modes.mjs` runs inside the existing
`check-configured-real-auth.mjs` gate using actual local Supabase Auth, real
PostgreSQL/service-role queries, the configured application and verified local
TLS. It creates two disposable `.invalid` accounts at one company vendor and
two synthetic phone enrollments with independently generated fixture keys.

It verifies concurrent per-person challenges on one site phone; person/site
assignment isolation; personal-phone access for only its bound guard across
approved sites; cross-person proof, altered signature and replay denial; caller
mode/biometric flag rejection; no capture grant before explicit clock-in; site
deactivation and device revocation; and actual provider logout stopping only
the original guard. No attendance row, worker, message, phone action or hosted
operational write occurs. Exact owned Auth/session/domain/account-limiter rows
and private markers are removed; existing global limiter state is preserved.

Only sanitized results enter the existing CI artifact. This gate does not test
a human biometric or claim personal biometric return sign-in is implemented.

## Remaining physical and live acceptance

The Fold's real fingerprint check opened the normal Guard credential screen.
That is separate from account login and hosted device/site/assignment approval.
Standalone camera/GPS diagnostics and isolated device tests remain separate from
authenticated Guard shift capture. Live acceptance must use the intended
individual account, exact installation public key, approved mode/site/source
mapping and read-only Ops integration, then verify normal clock-in, reporting,
check-in, logout and background behavior.
