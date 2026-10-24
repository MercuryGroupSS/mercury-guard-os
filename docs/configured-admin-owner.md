# Configured Guard administrator membership

`server/scripts/set-configured-admin.mjs` manages only the dedicated Guard application's administrator membership. It is an owner command, separate from the HTTP runtime. It does not create Auth accounts, send confirmation codes, retrieve stored credentials, create database roles, initialize a deployment marker, enroll phones, approve Ops/receiver mappings or modify another application.

The operator supplies an existing owner connection, the trusted database CA and Auth administration key, and all seven expected public deployment identity fields. The deployment marker must already exist and match exactly. A team or organization owner is not automatically a Guard Auth user or Guard administrator.

## Prepare the private request

Save a JSON file outside source control with mode `0600`, owned by the invoking user, and absolute paths. The command rejects leaf symlinks, additional fields, credentials in URL query parameters, HTTP Auth origins and missing/private-key substitutes for the CA. This template is incomplete until the owner supplies the actual approved values:

```json
{
  "version": 1,
  "expected_deployment": {
    "deployment_id": "<existing deployment UUID>",
    "auth_origin": "<exact approved HTTPS Auth origin>",
    "public_origin": "<exact approved HTTPS Guard origin>",
    "issuer": "<exact approved issuer>",
    "audience": "<exact approved audience>",
    "issuer_key_id": "<exact approved public issuer key ID>",
    "issuer_spki_sha256": "<exact approved public SPKI SHA-256>"
  },
  "database": {
    "url": "<supplied owner PostgreSQL session connection URL>",
    "ca_path": "/absolute/private/approved-database-ca.pem"
  },
  "auth": {
    "origin": "<same exact approved HTTPS Auth origin>",
    "server_key": "<supplied Auth server key>"
  },
  "request": {
    "requestId": "<fresh UUID for this exact membership request>",
    "subject": "<existing individual Auth account UUID>",
    "email": "<that account's exact lowercase email>",
    "active": true,
    "operator": "<responsible owner label>",
    "reason": "<specific reason this individual should administer Guard>"
  }
}
```

Do not put credentials in shell arguments, shell history, a public build configuration, a screenshot or a source file. Use the supplied owner credential only for this transient command; the runtime retains its separate restricted database role. The wrapper does not accept an issuer private key. Do not disable TLS or use a transaction-pooling connection for this owner operation.

## Review, then apply the exact request

```sh
node server/scripts/set-configured-admin.mjs --input /absolute/private/guard-owner-request.json
```

The default command verifies TLS peer trust and the PostgreSQL hostname, requires both `current_user` and `session_user` to be `postgres`, and checks the full existing deployment marker. To enable membership, it reads the supplied individual account from the exact trusted Auth admin endpoint with no redirects, then checks the database's current confirmed, unbanned, undeleted Auth account. Explicit revocation uses the existing exact membership and does not depend on a remote Auth lookup. The output is a review plan: **no membership or audit row is changed**. A review can become stale before execution; application rechecks its own current account and deployment transaction.

Apply only the same reviewed file and request UUID:

```sh
node server/scripts/set-configured-admin.mjs --input /absolute/private/guard-owner-request.json --apply
```

The existing `OwnerAdminMembership` operation writes the membership and immutable audit receipt together. The wrapper holds a shared row lock on the matching deployment marker from transaction start through the final pre-commit check, using the same verified owner connection. The Auth account is locked and checked again before an active membership is inserted. No HTTP self-grant path is introduced.

An uncertain response is not confirmation of success. Retry the identical request UUID and normalized body to recover its original receipt; a changed body using that UUID is rejected. Do not make a replacement UUID just because the connection failed. The command deliberately prints a generic failure without credentials or connection details. Preserve the private request until the original outcome is resolved.

For an explicit revocation, prepare a new reviewed request with `active: false`, the exact existing subject/email and a new UUID/reason. This disables Guard administrator membership and records its audit; it does not delete the person's Auth account, alter guard assignments or sign out other applications. An existing exact request may return its original historical receipt after a later change; that receipt describes that operation's result, not the person's current membership.

After applying an initial membership, the individual still signs in through the configured Guard account/admin flow. Mail delivery, code confirmation and the person's password are separate prerequisites. The command makes no mailbox-delivery claim and sends no email itself.

## Local acceptance and limits

Focused tests cover exact private inputs/CA, forbidden URL overrides, real TLS socket and hostname checks, and owner/marker failure before any Auth request. `check-local-configured-owner.mjs` uses a unique disposable database and synthetic accounts only. A loopback PostgreSQL STARTTLS proxy exercises the unmodified production wrapper's real verified TLS path to that child; a separate trusted local HTTPS Auth fixture implements only the bounded individual-account GET. Tests cover zero-write review, remote/locked account denial, marker-drift rollback of membership and audit, unchanged UUID retries/conflicts, revocation and clean connection shutdown. The runner verifies exact child ownership and removal and retains private recovery metadata if cleanup ownership is uncertain.

This local proof does not provision a hosted owner credential or authorize a hosted membership change. The actual approved database/Auth inputs and an existing human-confirmed account remain required. No production credentials, Auth accounts, emails, phones or existing Ops data are used by these tests.
