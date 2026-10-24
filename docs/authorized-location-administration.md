# Explicit location approval and received observations

Continuous operational location is disabled when an approved Ops assignment link omits `locationPolicy`. Existing check-in location evidence and demonstration tracking do not enable this policy. The administration console supplies no sampling cadence, displacement, notice, lease or site geometry by default.

An administrator may include **Authorized location policy** in an `ops_binding.approve` change. The individual account, Guard ID, Vendor ID, Site ID and Ops shift remain part of that same reasoned approval. Approval is separate from the guard's explicit consent, a current authorized shift, operating-system permissions and a bounded capture lease. A saved policy does not establish that collection started.

The optional payload has these exact fields:

| Field | Accepted configuration bounds |
| --- | --- |
| `version` | `1` |
| `revision`, `notice_revision` | Positive safe integers |
| `notice_text` | Complete reviewed notice, trimmed; 1–2,000 UTF-16 units and at most 6,000 UTF-8 bytes; line feeds allowed, other ASCII controls rejected |
| `notice_sha256` | Lowercase SHA-256 of the exact trimmed UTF-8 notice |
| `sample_interval_ms` | Integer 1,000–3,600,000 milliseconds |
| `min_distance_m` | Finite 0–10,000 metres |
| `max_fix_age_ms` | Integer 1,000–300,000 milliseconds |
| `max_accuracy_m` | Finite, greater than 0 and at most 1,000 metres |
| `max_capture_lease_ms` | Integer 1,000–900,000 milliseconds |
| `geofence` | `null`, or an explicitly approved circle |

These are validation bounds, not recommended operational settings. The console requires every enabled-policy value to be entered. It computes the notice fingerprint during review and includes the full notice and fingerprint in the immutable pending request. A late digest computation cannot prepare a request after the operator changes accounts or changes forms. No password, bearer or guard consent is included in this approval.

A circle has exactly `{type:'circle',id,revision,latitude,longitude,radius_m}`. Its ID is a stable identifier, revision a positive safe integer, coordinates finite and within latitude ±90 and longitude ±180, and radius greater than 0 and at most 100,000 metres. The circle stays absent unless deliberately enabled and completely entered. Do not infer geometry from a site label, vendor address or historical demonstration radius.

Review, apply, retry and resolve use the existing administration envelope and request ID. An interrupted response keeps the identical actor-bound payload and reason. Resolve retrieves the saved outcome or permanently closes that request without applying it; a later retry cannot reopen a closed ID. Editing the original notice or collection bounds requires an explicit new reviewed approval rather than changing an in-flight request.

## Received location details

The protected **Reports** catalog presents `observation.kind:'location'` as **Location observation**. Its receipt means the protected inbox received the observation; it does not establish physical presence, current whereabouts or an alert.

The typed sample contains original `capture_grant_id`, `consent_id`, `policy_revision`, `policy_sha256`, `fix_at_ms`, `latitude`, `longitude`, `accuracy_m` and `mock:false`. The existing outer report retains the observed time, device fingerprint, Guard ID, Vendor ID, Site ID, assignment and delivery attribution. The console displays those original identifiers rather than adopting the current policy or account.

The server adds `server_validation` with `version:1`, `status:'validated_device_observation'`, matching policy revision/fingerprint and consent ID, the original `notice_sha256`, and a geofence result. The console only displays a server assessment when those typed fields match the original sample. Missing, malformed or mismatched validation is labelled **Validation unavailable**.

| Server state | Console meaning |
| --- | --- |
| `inside` | The server calculated distance plus reported accuracy within the configured circle. |
| `outside` | The server calculated distance minus reported accuracy beyond the circle radius. |
| `uncertain` | The reported accuracy overlaps the boundary. |
| `not_configured` | No approved geofence was attached; fence identifiers and distance are `null`. |

The console uses the server's result without recalculating or inventing an inside/outside assertion. It shows configured fence identity/revision and server distance when supplied. Every location detail states that this is a device-reported observation and that it neither proves physical presence nor triggers a geofence alert. No map or external location URL is loaded.

Private details use text nodes. Filtering, paging, navigation, expiry, access revocation and sign-out retain the existing private-view clearing and stale-response protection. Historic receipts remain distinct from current authorization to collect new samples.

## Verification boundary

Focused console tests cover disabled omission, explicit bounds and circle validation, exact Unicode notice hashing, immutable retries, original attribution and each server result, plus malformed/mismatched validation. The existing session, sign-out, stale response and private-image checks continue to pass. This does not establish production policy approval, completed native service integration, deployment, background reliability or Fold6 GPS and battery acceptance. Those require separate integration and attended hardware checks with explicitly approved configuration.
