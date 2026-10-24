# Authorized location backend

Continuous operational collection requires explicit assignment policy, individual consent, an approved original device, a current confirmed shift and a short signed capture lease. No default cadence, displacement, notice or circle is approved by this implementation. Existing demonstration tracking and fresh check-in evidence are separate. Native continuous collection is being integrated; the backend checkpoint does not establish handset acceptance.

The [administration policy form](authorized-location-administration.md) binds the reviewed notice and its exact UTF-8 SHA-256 to the approved Ops assignment mapping. A changed/absent policy invalidates later location grants and ingestion under the old scope. A policy may omit geometry, yielding not_configured. It cannot infer a fence from a site label or address.

## Consent and proof

The PostgreSQL runner composes one PostgresLocationConsents dependency into grant issuance and ingestion, and exposes these bearer-authenticated, no-store JSON POST routes:

- `/v1/location-consents/challenge`: exact `{device_id,consent_id}`; a new consent uses null.
- `/v1/location-consents`: exact `{intent,proof}`; intent is canonical base64url of the retained exact UTF-8 JSON bytes.
- `/v1/location-consents/status`: exact `{consent_id,proof}`.

Intent includes version, request and consent UUIDs, consent/withdraw action, Guard ID, Vendor ID, Site ID, assignment, device ID/fingerprint, revocation version and the policy/notice revisions and digests. The individual Auth subject comes from the verified current provider session; it is never supplied as client authority. Signed proofs use a separate mercury-location-consent-proof-v1 domain and bind the exact intent digest, operation, one-time nonce and original device key. Status binds the exact consent UUID. UTF-8 BOMs or other encodings that would change retained bytes are rejected.

Consent and withdrawal receipts are immutable and request-ID-bound. Withdrawal can stop the original consent even after assignment/device operational authority is no longer active, but still requires its individual current session and original device possession. Collection must stop locally immediately while server confirmation is pending. A withdrawn consent is never reactivated by retry. Server insertion ordinals establish deterministic consent order even when timestamps match. The newest matching consent is considered before withdrawal, so a withdrawn newer consent cannot make an older one eligible for grant issuance. A withdrawal creates a permanent barrier for that consent and all earlier consents in the identical individual/assignment/device/revocation/policy scope; a genuinely later explicit consent uses a fresh UUID and authorizes only its own samples. Older consent grants never revive after the later consent.

## Grants, observations and withdrawal

A grant includes signed `{consent_id,policy_sha256,policy_payload}` only when the exact persisted consent and approved policy remain active inside the transaction. Its expiry is capped by the approved capture lease, assignment end and session expiry. Nonlocation actions remain available without location consent. SQLite synthetic mode cannot enable operational location.

Location samples contain only the defined original grant/consent/policy identifiers, fresh fix time, finite coordinates/accuracy and mock:false. Transactional validation rechecks current individual session, guard/vendor/site/device/revocation, the original confirmed shift, grant, policy and unwithdrawn consent. Late uploads retain the existing24-hour original-capture window and must still satisfy that original lease and current policy; this is not authority to collect after the lease or shift. Once withdrawal commits, subsequent location ingestion, including a retry and samples under an earlier matching consent, is denied. Shared/exclusive scope locks serialize cross-consent ingestion and withdrawal at commit. Accepted history stays immutable. Other observation kinds remain independently deliverable.

The server stores the original notice digest and a geofence assessment with the observation. Reported uncertainty overlapping a circle becomes uncertain; absent geometry becomes not_configured. These are device-reported observations, not proof of physical presence. No automatic geofence notification, dispatch, payroll update or emergency response is triggered.

## Verification and remaining acceptance

The full Node and disposable PostgreSQL suites cover exact policy/notice bytes, intent/proof replay and altered-body denial, independent identities/devices, current exact Auth sessions, revoked/ended/changed scopes, conditional grant issuance, lease bounds, typed samples, no-policy behavior, original historical capture, withdrawal races and private append-only table grants. Proof nonce locks precede consent locks to avoid status/withdrawal deadlocks. Failed transactions roll back nonce consumption.

Canonical migration20261024001402_guard_authorized_location.sql adds the nullable assignment policy and three private RLS-enabled consent tables, with explicit privilege revocation before service SELECT/INSERT only. Migration replay verifies that anonymous/authenticated reads and service UPDATE/DELETE are denied. Local advisors report no warning/error findings. `node server/scripts/check-local-location.mjs` replays all migrations in a disposable owned local database and removes it afterward. Additive migration20261024002355_guard_location_consent_order.sql adds a server-generated ordinal for future consent inserts. Existing historical rows keep NULL rather than receiving invented past order; their original bytes remain unchanged and a new explicit consent is required. Its canonical upgrade regression seeds pre-existing consent/grant/event evidence, applies the migration and proves fail-closed reads/grants/ingestion plus later fresh-consent recovery. The canonical full PostgreSQL runner includes the new verifier.

Production policy approval, retention and response rules, a configured reachable service, real identities, native lease/stop behavior, actual HTTPS integration, battery/background/fold behavior and attended Fold6 acceptance remain separate gates. This checkpoint creates no hosted project, charge, live assignment, geofence alert or phone change.
