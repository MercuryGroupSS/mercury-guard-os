# Bounded local capacity baseline

Run from the Guard source root with the owned local Supabase stack already running:

```sh
node server/scripts/check-local-capacity.mjs > capacity-result.json
```

The command accepts no endpoint, credential, concurrency or duration overrides. It reads the existing bounded, owner-private `supabase-start.log` through the private-file validator (no leaf symlink or group/other permissions) and requires the exact local API origin `http://127.0.0.1:55321` and PostgreSQL `127.0.0.1:55322/postgres`. Keep that credentials file private. The JSON result contains no tokens, identities, private keys, connection strings or request bodies.

The runner creates one randomly named `mercury_capacity_<32hex>` database, marks its ownership with a run-specific database comment and replays the current canonical migrations there. It creates eight synthetic individual guards under one company Vendor ID, eight enrolled site phones and confirmed shifts. It generates ephemeral RSA2048 and ECDSA P256 keys in memory. It never reads business data, calls Supabase Auth, opens a listener, runs background workers, stops the stack or modifies the main database/global limiter. No global role or schema changes are made. It closes its clients, rechecks the exact owner/comment, drops only its confirmed child database and verifies that database is absent before reporting success; it never terminates unrelated sessions or uses force-drop. If creation has an uncertain outcome and a database exists, it retains it for explicit recovery rather than adopting or deleting it.

Eight warm-up grants and incident batches plus initial pool creation are excluded from the measured stages. Each of the production assignment/grant handler and signed incident batch handler then completes exactly 24 operations at each of one, four and eight worker lanes. The service-role pool remains capped at four connections, matching the configured runtime. Lanes use separate enrolled device/individual scopes. The workers perform finite closed-loop requests: this is not an open-loop arrival-rate, soak, overload or maximum-capacity test.

The synthetic opaque-token registry does **not** verify JWTs or emulate a real Auth provider. Every handler request uses the production PostgreSQL current-session reader against this child database's `auth.sessions`; directory resolution, device challenge consumption, ECDSA enrollment proof, confirmed-shift scope, RSA grant signature, signed batch verification and transactional persistence use production components. The real Auth/TLS composition has separate acceptance tests. This run measures the in-process handlers and database adapters, not whole HTTPS/runtime or handset capacity.

Each stage reports completion count, elapsed time, operations/second and min/p50/p95/max handler latency. Percentiles use the nearest-rank definition on only 24 observations. Handler latency includes Request construction, synthetic session registry/real session-table check, authorization/database pool waits, cryptographic verification and transaction commit, then JSON response consumption. Grant challenge generation/device proof signing and result RSA verification occur outside that latency window. Batch construction/signing and receipt assertions also occur outside it. Stage throughput includes that preparation/validation and lane scheduling, so it has a broader timing boundary. There is no direct lock-wait measurement or attempt to attribute elapsed time to individual components. Machine load, local Docker/filesystem, Node and PostgreSQL versions, crypto and pool queueing all affect the result.

The current grant/shift path uses one global advisory transaction lock; signed event ingestion uses another to preserve commit ordering, immutable receipts and event cursors. PostgreSQL transaction advisory locks are released when the transaction ends; queued work therefore contributes to observed latency. See the [PostgreSQL advisory-lock documentation](https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS). The baseline leaves these production locks unchanged. Eight worker lanes over four physical connections do not represent eight simultaneous database transactions or eight application servers.

After timing, a bounded mixed wave checks eight new commits, eight exact concurrent retries returning the original receipt, four unsigned-payload alteration denials and four cross-individual denials. Deleting one synthetic current session must deny four grant and four batch requests. Revoking a different synthetic device must deny four batch requests. Another session/device must still commit. The script checks all 80 original grant payloads, 89 immutable event/receipt pairs, unchanged receipts through the revocation probes, eight original unclosed shifts, append-only service privileges and zero child login-limiter rows. These exact correctness outcomes determine success; speed has no pass threshold. They are a concurrency/security regression sample, not a security certification.

The runner stops scheduling new work after 120 seconds or SIGINT/SIGTERM and drains outstanding lanes before cleanup. Connections use 5-second connect, 10-second statement and 12-second query timeouts. Cleanup also uses bounded owner queries. This is a cooperative deadline, not a promise of a hard wall-clock kill at 120 seconds. A failure reports a sanitized stage/code; inspect private local tooling separately if diagnosis is needed. `cleanup.database_removed` must be true. A failed cleanup writes exclusive owner-private recovery metadata under `.local-backend/` with the exact database name/marker but no credentials. Check that record before a new run; the command does not delete older databases by prefix.

The result fingerprints all server-root `.mjs` files, this runner and the canonical migrations, and verifies that fingerprint again after the workload. It records each migration hash, Node/PostgreSQL version, OS/architecture, logical CPU count, fixed parameters and UTC run times. Preserve the JSON beside the source snapshot used for the run. Coordinate with other local verifiers so backup/restore drills or builds do not distort the measurement.

No production SLA, supported guard/device count, scaling factor or deployment capacity follows from these small local observations. Deployment acceptance still needs the approved real hosting/database/network configuration, a representative workload and explicitly agreed performance/security criteria, followed by measurement there. This baseline provides repeatable local evidence and exact outcomes without inventing those inputs.

## Recorded local observation

The final source passed on October 24, 2026 UTC using Node 24.19.0, PostgreSQL 17.11, macOS/arm64, ten logical CPUs and the four-connection pool. Every row below completed 24 requests. These are one small run's observations; the stage-throughput and handler-latency boundaries above apply.

| Operation | Worker lanes | Stage operations/second | Handler p50 ms | Handler p95 ms | Handler max ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Shift grant | 1 | 108.788 | 7.314 | 8.486 | 9.941 |
| Shift grant | 4 | 257.742 | 11.177 | 14.231 | 17.955 |
| Shift grant | 8 | 259.089 | 22.706 | 28.643 | 30.195 |
| Signed incident | 1 | 99.423 | 7.730 | 21.096 | 41.002 |
| Signed incident | 4 | 207.285 | 18.222 | 22.040 | 25.433 |
| Signed incident | 8 | 225.167 | 30.498 | 42.826 | 46.367 |

The 80 grant payloads, 89 event/receipt pairs, eight exact retries, all 20 signature/scope/session/device denials, independent new commit and append-only privileges matched the expected outcomes. Final exact database ownership and absence checks passed. The sanitized full result is `.local-backend/capacity-baseline-final.json`; source fingerprint `a6c098bda17e01f063d1efd595cb3d1128eafaf571486f2e1d8ef8efe63533d9`. The private result directory is excluded from source releases, so copy the sanitized JSON into the release verification record when packaging the evidence.
