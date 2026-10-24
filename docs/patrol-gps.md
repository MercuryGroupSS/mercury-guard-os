# GPS-backed checkpoints

A reasoned Ops assignment approval may include `patrolRoute.gps_required: true`. The flag accepts only literal `true`; omission preserves legacy manual checkpoints. The same approved binding must include a complete `locationPolicy`. Approval attests that its exact reviewed notice covers user-triggered checkpoint fixes. No notice purpose is inferred from keywords. Expanding a notice's purpose requires explicit route, policy and notice revisions and fresh guard consent. No production notice, sampling cadence, uncertainty limit or geometry is supplied by this feature.

The authenticated individual must have a confirmed shift, an enrolled device, a current exact Auth session, explicit consent for the original policy and a signed grant containing both `patrol` and `location`. A GPS-required route cannot accept a manual fallback. Consent for point fixes does not itself start continuous collection. Each point requires a new visible request and a fresh, nonmock SDK callback; denied permission, disabled GPS, stale/inaccurate fixes or expired authority leave the checkpoint unrecorded.

## Exact event contract

Existing checkpoint fields remain `capture_grant_id`, `route_id`, `route_revision`, `checkpoint_id`, and `round_id` only when the route declares rounds. A GPS-required route additionally requires `data.location` with exactly these fields:

| Field | Type and binding |
| --- | --- |
| `requested_at_ms` | Positive safe integer epoch milliseconds for this point request. |
| `fix_at_ms` | Positive safe integer epoch milliseconds derived from the fix's monotonic timestamp. |
| `consent_id` | Lowercase UUID from the original signed `grant.location`. |
| `policy_revision` | Positive safe integer matching the original signed policy. |
| `notice_revision` | Positive safe integer matching that policy's exact notice. |
| `policy_sha256` | Lowercase 64-hex digest of the exact signed policy payload bytes. |
| `notice_sha256` | Lowercase 64-hex digest of the exact approved notice UTF-8 bytes. |
| `latitude` | Finite number from −90 to 90. |
| `longitude` | Finite number from −180 to 180. |
| `accuracy_m` | Finite positive number no greater than the original policy's maximum uncertainty. |
| `mock` | Literal `false`. |

The request, fix and event must satisfy:

```
grant.not_before_ms <= requested_at_ms <= fix_at_ms <= event.at < grant.expires_at_ms
event.at <= server_received_at_ms
event.at - fix_at_ms <= original_policy.max_fix_age_ms
```

The phone derives these epoch times from the verified server anchor and same-boot monotonic timestamps. Wall time and cached last-known fixes do not authorize this path. The ordinary location validator checks the nested observation after its original fields are mapped to the existing typed location schema. The checkpoint validator also checks the request time and exact notice revision/digest.

## Acceptance and withdrawal

PostgreSQL acceptance rechecks current guard/vendor/site/assignment/device and original signed grant. It checks the original consent, current approved policy, permanent withdrawal barrier and exact Auth session inside the same transaction that inserts the event, checkpoint uniqueness row and receipt. The last session check occurs after insertion and before commit. Invalid mixed batches roll back completely. The local synthetic SQLite adapter rejects GPS-bearing checkpoint events because it cannot perform the PostgreSQL consent transaction.

Withdrawing consent denies new acceptance and exact retries under that consent, including already captured GPS checkpoints. A later same-scope withdrawal also permanently blocks older consent ordinals. A separately granted later consent can authorize its own new captures; it never relabels older events. Original encrypted phone records, accepted event bytes and receipts remain retained. The phone partitions GPS checkpoints with the original consent/policy owner, so a blocked location partition does not block independent incidents.

Checkpoint uniqueness remains guard + assignment + route ID + route revision + declared round + checkpoint ID. Guards can choose any approved point or round order. A manual checkpoint under an older original route policy remains a manual historical record and does not complete the GPS-required revision. A scheduled shift end still does not fabricate clock-out attendance.

## Delivery and Reports

Accepted GPS checkpoints store a separate `checkpoint_location_validation` object containing `version: 1`, `status: 'validated_device_observation'`, original consent/policy/notice identifiers and hashes, and the existing conservative geofence classification. The private receiver projection adds `observation.data.location` only for this validated GPS path, carrying the original nested fields and `server_validation`. The source-only capture grant marker is omitted from checkpoint projections, as it was for legacy records.

Legacy manual projection bytes remain unchanged. Reports explicitly labels them **Manual checkpoint**. Validated GPS checkpoints are labeled **GPS device observation**, with the original notice revision/fingerprint, request/fix times, uncertainty and server geometry assessment. Missing or mismatched proof is labeled unavailable. Neither the fix nor a circle classification proves physical presence, identifies the person operating the phone, triggers a geofence alert or establishes operator acknowledgement. No checkpoint coordinates or radius are invented. Source withdrawal does not rewrite an approved administrator's retained historical report.

## Verification and activation boundary

`server/patrol-location.test.mjs` covers the explicit policy pair, exact field/notice/timing validation, signed capability, nonmock uncertainty bounds, manual compatibility and receiver projection integrity. Admin console tests cover reasoned immutable GPS approval and explicit manual/GPS report labels. The existing `verifyPostgresLocation` replay verifier additionally exercises actual signed device batches, current-session rollback after insertion, wrong-scope denial, same-point concurrency, invalid-batch rollback, original manual revision isolation, private receiver/protected Reports delivery, withdrawal retry denial, permanent cross-consent barriers and independent incident delivery. Its local runner uses only a unique disposable database and removes it afterward.

These checks establish server protocol and local database behavior. Emulator SDK and physical Fold GPS delivery require separate attended acceptance. This source change does not enable a live route, create a policy or guard, modify hosted schema, contact an operator, or change an existing Ops application.
