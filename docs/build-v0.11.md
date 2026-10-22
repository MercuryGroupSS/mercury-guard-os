# Mercury Guard OS v0.11 — signed offline upload batches

Connects the durable encrypted outbox to the installation signing key through a transport-neutral SignedOutbox preparer. A signing identity must already exist; preparing a signed batch never creates or replaces it. It validates audience, batch/event UUIDs, exact fields, schema version, strictly increasing positive sequence values, unique event IDs, timestamps, kind/data types, at most 100 events and a 257 KiB full-batch serialized cap (the outbox separately uses a 256 KiB event-data budget).

The signature uses P-256/SHA256withECDSA over ASCII `mercury-event-batch-v1\n<audience>\n<deviceThumbprint>\n<payload>`, where payload is the unpadded base64url UTF-8 JSON batch snapshot. The proof returns version, algorithm, audience, device fingerprint, public SPKI, payload and base64url DER ECDSA signature. Keystore updates use bounded input chunks. A distinct signature domain separates batch proofs from enrollment proofs. DER signatures are not JOSE raw R||S.

Retries preserve the durable batch/event IDs and exact payload. ECDSA signature bytes may change on retry; idempotency must be enforced using batch/event IDs. Preparing/signing does not transmit, delete or acknowledge events. Partial receipts retain remaining event IDs in a new batch ID. Missing identity and invalid inputs fail without marking delivery. A signature proves possession of the installation key, not guard identity, authorization, true timestamps/location, immutable audit history or replay safety.

The future receiver must bind the supplied public key to an enrolled device record, validate signature/audience/grant scope, enforce per-device sequence/event idempotency, reject altered-content ID reuse and apply role/site isolation. Never trust an embedded public key alone. No production caller, credentials, transport, server receipt or network sync is enabled.

## Integration direction

Guard OS requires bidirectional data exchange with existing applications: receive assignments, site instructions, patrol routes, dispatch and revocation; send check-ins, GPS, incidents/evidence and acknowledgements. Existing business records should remain authoritative. Develop against an isolated staging environment based on the relevant current backend, then introduce narrowly scoped server adapters/API endpoints after testing. No existing application schemas, rows, permissions or credentials were modified. Multi-project data ownership and stable guard/site identity mappings must be confirmed before integration. Staging creation/deployment and production changes have not been performed.

White Jarvis UI, stable APK update signing and physical Fold6 validation remain pending. Validation passed: six unit tests and forty-one device tests on each API 28 and 35, build, lint and APK signature verification. Tests cover signed retries/reopen, tampered content/context, absent identity, malformed batches, queue preservation and a 200 KB event signature.

Source commit `164b684d25c53ae713a0968206ff74427b57c1cf`, [run 39796747895](https://github.com/MercuryGroupSS/mercury-guard-os/actions/runs/39796747895). APK SHA-256: `7fa299b0f83cfb4a529d3f7f9896d3c5ca8b0b8de64b0a71b001a81d190e9b54`. Downloaded artifact digest and APK checksum were compared locally. See [proposed two-way sync contract](bidirectional-sync-contract.md); it is not deployed.
