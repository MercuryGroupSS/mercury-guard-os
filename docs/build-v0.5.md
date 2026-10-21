# Mercury Guard OS v0.5 — offline outbox foundation

Adds stable UUIDs inside encrypted events, schema-v3 transactional migration from v1/v2, encrypted durable batches, row-sequence ordering and a pending-event count. Preparing a batch retries the same persisted content and ID across reopen. New batches select at most 100 events with a 256 KiB serialized event-data budget; an oversized first event remains queued and raises an error for future operator resolution.

Receipt handling is transport-neutral and has no production caller. It validates batch identity and event membership before changing delivery state transactionally. Partial acceptance generates a new batch ID for the remaining unchanged event IDs. Accepted records stay in local audit history. Stale/mismatched receipts fail without discarding records. This does not authenticate a server or provide device signatures or immutable audit history.

No network transmission, endpoint, credentials, server receipt or simulated success button is enabled. All existing records remain pending in normal app use. Production integration still requires isolated staging identity, signed grants, authenticated transport, server idempotency/access tests, media handling and release signing. Existing Mercury apps and other repositories remain untouched. The white Jarvis-inspired visual redesign remains deferred.

Validation pending: six unit tests, thirteen instrumented tests on API 28 and 35, build, lint and signature verification. Physical Fold6 testing remains pending.
