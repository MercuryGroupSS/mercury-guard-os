# Mercury One on Netlify

This deployment uses a separate Guard site in the existing Netlify team and a dedicated Guard Supabase Auth/database project. Existing Ops applications stay unchanged. The direct HTTPS service remains available; Netlify uses the same authenticated application through a separate platform adapter.

The adapter is implemented and locally tested. Activation still requires the approved site/project, private credentials, owner and pilot enrollment, email delivery, a configured signed APK, deployed acceptance and the attended Fold tests. Local proofs do not establish hosted TLS, platform scheduling, real mail or physical-device behavior.

## Platform entry points

`netlify/functions/guard-api.mjs` serves `/v1/*`, `/v2/*`, `/account`, `/account/*`, `/admin` and `/admin/*`. The canonical HTTPS origin, actual Netlify site ID and production deployment context must all match before opening the runtime. Preview and branch deployments cannot use production authority. Forwarding/rewrite headers cannot choose an origin or application route.

`guard-sweep.mjs` is a scheduled function without a public path. It runs once per minute in UTC. Each invocation awaits a finite pass rather than starting persistent timers. The pass rechecks deployment authority and uses a PostgreSQL session advisory lock to avoid overlapping workers across cold instances. Busy is an explicit skip; incomplete or timed-out work fails visibly. Durable cursors, immutable receipts and bounded staging cleanup permit subsequent passes to continue.

The worker budget is at most 25 seconds, reduced by cold-start time, leaving time within Netlify's 30-second scheduled-function limit. Database calls and worker fetches use remaining-budget limits. Scheduling delays remain possible; a one-minute schedule is not a one-minute delivery guarantee. This changes the previous persistent runtime's nominal 30-second processing cadence and must be considered when accepting the pilot. The app must continue to distinguish service receipt, operator acknowledgement and external response.

## Private configuration

Use Functions-scoped environment variables through Netlify's UI/API. The Node Functions wrappers explicitly read `process.env`; the `Netlify.env` API belongs to the separate Edge runtime. No secrets belong in `netlify.toml`, Git, public assets, APK assets, URLs or build output. No server TLS private key is needed because Netlify terminates HTTPS.

`MERCURY_GUARD_NETLIFY_CONFIG` is strict JSON containing the public deployment description:

```json
{
  "version": 1,
  "deployment_id": "APPROVED_DEPLOYMENT_UUID",
  "public_origin": "https://APPROVED_GUARD_SITE.netlify.app",
  "platform": {
    "site_id": "APPROVED_NETLIFY_SITE_UUID",
    "deployment_context": "production"
  },
  "auth": {
    "origin": "https://APPROVED_GUARD_PROJECT.supabase.co",
    "publishable_key": "SUPPLIED_PROJECT_PUBLISHABLE_KEY"
  },
  "database": {"connection_mode": "session"},
  "issuer": {
    "issuer": "APPROVED_ISSUER",
    "audience": "APPROVED_AUDIENCE",
    "key_id": "APPROVED_KEY_ID"
  },
  "workers": {"batch_size": 5, "max_duration_ms": 20000},
  "ops_refresh": null,
  "dashboard_delivery": false,
  "dashboard_receiver": false,
  "mail_recipients": []
}
```

This template deliberately contains invalid placeholders and cannot activate a deployment. The worker numbers are a bounded starting configuration for measurement, not a supported production workload or SLA.

Supply these private values separately:

- `MERCURY_GUARD_DATABASE_URL`: the exact approved direct/session PostgreSQL connection, without URL query overrides.
- `MERCURY_GUARD_DATABASE_CA`: optional PEM CA chain; otherwise use platform trust. Certificate verification cannot be disabled.
- `MERCURY_GUARD_AUTH_SERVER_KEY`: server-only key for that Guard Auth project.
- `MERCURY_GUARD_ISSUER_PRIVATE_KEY`: the approved RSA private issuer key, at least 2048 bits. It is separate from the APK signing key.

Database connections use verified TLS and a small two-connection pool per warm instance. Every checkout awaits `SET ROLE service_role` and verifies the effective role. One control connection holds the worker lock while adapters use the other. This first adapter accepts direct/session mode only; transaction pooling is rejected because the role and worker lock require session semantics. Pool limits still multiply with concurrent function instances, so hosted capacity must be measured and monitored.

The Auth provider and private Guard tables must share the same database's `auth.users` and current `auth.sessions`. Applying migrations alone does not create the owner-installed deployment marker, an administrator, individual guard, device or assignment. Review and install the exact deployment identity before activation, following [configured service identity](configured-service.md).

## Pilot mail and integrations

Omitting `mail_recipients`, or setting it to `[]`, blocks every Guard account setup/recovery code and password path before the Auth provider is called. Only explicitly allowlisted lower-case addresses can use these paths. Confirm the operator-controlled pilot mailbox before adding it. This is a Guard portal control; provision the separate Auth/SMTP service consistently rather than relying on this control to restrict every direct provider API.

Keep actual guard/vendor/client email addresses and phone numbers out of the test account. Selecting a guard's business record is not account creation, mailbox ownership or a confirmed shift. Do not change existing contact data to redirect pilot email. No SMS or external dispatch transport is enabled by this deployment. Real setup/recovery delivery needs an authorized SMTP sender; Supabase's default sender is restricted and unsuitable for an external guard rollout.

Optional Ops reading requires `ops_refresh: {"origin": "APPROVED_HTTPS_OPS_ORIGIN"}` plus `MERCURY_GUARD_OPS_SERVER_KEY` and independently approved individual/site/shift mappings. No display-name match may grant authority. Reads are bounded to explicitly mapped source IDs.

Optional delivery requires `dashboard_delivery: true` and `MERCURY_GUARD_DELIVERY_CONFIG`, using the strict existing `{version:1,destinations:[...]}` shape. Optional receiver activation requires `dashboard_receiver: true` and `MERCURY_GUARD_RECEIVER_CONFIG` containing exactly `version`, `destination` and a dedicated machine token. Receiver credentials cannot reuse Auth/Ops keys or authorize an individual/admin. Both directions and their mapping approvals are independent. All optional integrations default off.

The existing Ops WhatsApp ingestion route is not a Guard receiver. The first pilot can use Guard's protected Reports console. Rendering or projecting Guard reports inside the existing Ops application requires a separate reviewed change.

## Full-size private photos

The ingress caps buffered request/response bytes at 4 MiB, below Netlify's effective binary limit. Reads also have a five-second deadline and observe request cancellation; stalled cancellation cannot hold an invocation open. The platform may buffer an incoming request before calling the function, and this ingress reads its bounded body before handler-level authentication. Do not describe that boundary as credential verification before upload.

Native uploads preserve original JPEG bytes and their full hash, up to the existing 20 MiB maximum. They use bounded one-MiB pieces and explicit finalization. Each source piece also carries a signature from the original phone's enrolled key, binding the original event/photo hash and exact piece. A stolen bearer without that phone key cannot poison the immutable staging pieces. A retained-piece receipt does not mean the photo is accepted. Finalization verifies original metadata, complete bytes, JPEG and hash before returning the original evidence receipt. Current session, guard/company, device, assignment, grant and deployment checks remain mandatory. Existing direct upload routes remain compatible outside the smaller platform boundary.

Private Reports downloads use authenticated one-MiB ranges for large photos. Each range rechecks current administrator authority and returns exact framing and the original strong hash ETag. The browser verifies the whole original image before creating a temporary local image URL. It does not fall back to a large unauthenticated or whole-file download.

Machine delivery uses the independently approved receiver token, resumable retained-piece progress and a final immutable receipt. A time-limited scheduled pass can continue on the next invocation rather than restarting every large photo. Stale staging remains bounded and can expire without deleting accepted original evidence. Source/receiver JPEG bytes consume PostgreSQL database space; they do not use a separate Supabase Storage allowance.

## Build and activation

Netlify's build command installs locked production dependencies and checks the explicit source/publish boundary. Only `netlify/public/index.html` is a public static asset. Page assets are included privately in both function bundles; the exact source/bundled layouts are supported without cwd/environment path discovery.

Local verification:

```sh
npm ci --ignore-scripts
npm run check:netlify
npm run test:netlify-bundle
node --test server/*.test.mjs
node server/scripts/check-local-postgres-limiter.mjs
```

The PostgreSQL command requires the owned local stack. Its independent Netlify gate explicitly injects local database transport and a synthetic Auth HTTP provider. It verifies real PostgreSQL roles, current sessions, deployment identity, transactions, media and finite workers; it is not proof of hosted database TLS or actual email delivery.

The bundle gate uses pinned `@netlify/zip-it-and-ship-it`, packages both modern Node 24 functions, checks archived dependencies and all eight page assets, and loads the resulting modules outside the checkout. Unconfigured requests are denied without network calls. This proves local packaging, not the version or behavior of a future hosted build.

Before publishing, verify actual team billing/usage controls, approved Guard project cost, deployment identity, mailbox delivery, owner and pilot enrollment, secrets/key custody and hosted checks. Netlify Pro alone does not prove that additional usage costs nothing. Keep existing services unchanged and preserve the prior APK, signing identity, encrypted local evidence and original receipts. Never uninstall or clear the Fold to bypass an update-signature mismatch. Finish with [attended Fold acceptance](fold-acceptance-v0.35.md) before relying on device behavior.

## Provider references

- [Netlify Functions](https://docs.netlify.com/build/functions/overview/)
- [Scheduled Functions](https://docs.netlify.com/build/functions/scheduled-functions/)
- [Functions configuration and limits](https://docs.netlify.com/build/functions/configuration/)
- [Node Functions environment variables](https://docs.netlify.com/build/functions/environment-variables/)
- [Functions usage and billing](https://docs.netlify.com/build/functions/usage-and-billing/)
- [Supabase PostgreSQL connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
