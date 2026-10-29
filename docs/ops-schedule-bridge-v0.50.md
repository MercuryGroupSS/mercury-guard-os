# Restricted Ops schedule bridge

Guard can now use an explicit `schedule_bridge` source transport in both server runtimes. Its existing Data API transport and disabled default are unchanged. The bridge solves the source-credential boundary without copying Ops' broad database/API key into Guard.

## Two independent deployments

The Guard consumer is part of this repository. `integration-drafts/ops-schedule-bridge/entry.mjs` is a proposed additional function for the existing Ops Netlify project. It is outside Guard's deployed function directory. Building or deploying Guard does not install it in Ops or enable source refresh.

Run `npm run build:ops-bridge` to create a self-contained `mercury-one-schedule.mjs` plus a source/digest receipt under `.local-backend/ops-schedule-bridge-draft/`. The builder uses pinned esbuild and loads the distributed file outside the source/dependency tree to check credential denial and a synthetic five-field read. No real key or source record is needed. Only after explicit permission to modify the existing Ops application, add that one reviewed file at `netlify/functions/mercury-one-schedule.mjs`. No existing function or database policy needs editing.

## Narrow source authority

The Ops function uses its existing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in place. The URL must match the reviewed Ops Supabase project. Its new token is a separate random 32-byte base64url value, held only in Functions secrets on the two services. No token belongs in the APK, public configuration, source, browser or logs.

The Ops-side `MERCURY_GUARD_SCHEDULE_CONFIG` is a version-1 object with exactly `version`, `site_id`, `public_origin`, `allowed_ids` and `allow_history`. `allowed_ids` is an explicit list of 1–1000 approved source shift IDs. Production site identity, deployment context, canonical request origin/path and the token must all match. A source ID approval does not identify a guard; Guard still requires its separate approved individual/vendor/site/device mapping.

Every request accepts at most 25 unique approved IDs. Only GET is available. The fixed upstream tables are `public.shifts` and, when both services opt in, missing-ID fallback to `public.shift_history`. Exactly five fields may leave Ops: `id`, `scheduled_start`, `scheduled_end`, `status`, `updated_at`. No names, contacts, clock events, reports, photos, billing data or payroll writes are part of this endpoint. Missing IDs are not cancellations. A failed current/history read rejects the entire response.

## Guard configuration

For Netlify, set `ops_refresh` to the following public shape inside the existing private Functions configuration:

```json
{"origin":"https://ops.example.invalid","transport":"schedule_bridge","history_fallback":true}
```

Place the matching token in `MERCURY_GUARD_OPS_SCHEDULE_TOKEN` on Guard and `MERCURY_GUARD_SCHEDULE_TOKEN` on Ops. The old `MERCURY_GUARD_OPS_SERVER_KEY` is unnecessary in bridge mode. The direct configured runtime instead carries `schedule_token` in its existing private configuration file and requires `interval_ms` as before. Both loaders reject mixed/unknown credential shapes and receiver/delivery token reuse. Keep `ops_refresh:null` until the separate source deployment and secret installation are approved and verified.

Requests and responses use normal verified HTTPS, reject redirects, have a five-second source deadline and a 64 KiB response bound. Responses are noncacheable and the consumer rejects timestamps more than 60 seconds from its clock. The consumer never logs provider bodies or credentials. Refresh errors retain the previous assignments; existing source-version and binding-revision checks prevent regressions.

## Acceptance and rollout

1. Review and approve the one-file Ops addition, its explicit ID allowlist and the two dedicated token secrets. Existing Ops remains unchanged until then.
2. Build/deploy Ops with its normal pipeline; privately configure the approved token and list. Deny unauthenticated, wrong-token, unapproved-ID, foreign-origin, preview and non-GET calls.
3. Read the approved real source using the bridge and compare the exact five fields with a separate read-only source query. Test history only for IDs absent from the current feed.
4. Enable the explicit Guard transport, verify a scheduled pass imports only approved mappings, and exercise actual cancellation/missing-source behavior without writing Ops attendance.
5. Authenticate the real pilot device and complete attended biometric/camera/GNSS/shift acceptance. A stored schedule or green CI is not this result.

Reversal: set Guard `ops_refresh` back to null, revoke the dedicated token and remove only the added Ops function. Preserve original mapping/history and recorded pilot receipts. Do not delete operational records or change RLS to make the connection work.
