# Approved patrol rounds

Repeated patrols use explicit rounds approved in the assignment's route snapshot. Checkpoints and rounds may be selected independently of order. The service never creates a new round because time has passed, a grant was refreshed, the app restarted or the phone changed guards.

An administrator can include rounds when approving an Ops assignment link. Under **Patrol route**, enter checkpoints and optionally patrol rounds using one `ID | Label` per line. Leave rounds empty to preserve the existing single-pass route. Round IDs and labels must be unique; labels are compared after trimming and without case. At most 100 rounds are accepted. The review displays the complete route in the same reasoned, immutable action request as the assignment approval. An existing link prefills its saved rounds.

Example trusted route:

```json
{
  "routeId": "building-patrol",
  "revision": 3,
  "checkpoints": [
    {"id": "entrance", "label": "Main entrance"},
    {"id": "perimeter", "label": "Perimeter"}
  ],
  "rounds": [
    {"id": "opening", "label": "Opening patrol"},
    {"id": "closing", "label": "Closing patrol"}
  ]
}
```

The imported assignment retains that route. Material route changes create a replacement assignment through the existing Ops synchronization rules. The grant issuer copies the approved route into its stored policy; PostgreSQL issuance also compares the proposed route with the locked assignment row. Modifying a returned route or passing another in-memory route cannot authorize a different round.

For a declared-round route, a signed `patrol_checkpoint` includes `round_id` in addition to the existing capture grant, route ID/revision and checkpoint ID. The round must exist in the event's original grant policy. A route with no rounds keeps the old event shape and rejects an invented `round_id`. An empty string is reserved internally for migrated single-pass ledger entries and is never an accepted explicit round ID.

```json
{
  "capture_grant_id": "11111111-1111-4111-8111-111111111111",
  "route_id": "building-patrol",
  "route_revision": 3,
  "checkpoint_id": "entrance",
  "round_id": "closing"
}
```

The same checkpoint can be recorded in both `opening` and `closing`. A second new event for that checkpoint in `closing` is rejected. Uniqueness binds the guard, assignment, route, route revision, round and checkpoint; it spans capture grants and devices for that same assignment. An exact retry returns its original receipt. Changing an existing event's round, content or scope cannot rewrite it. Rejected batches roll back all their new events and checkpoint entries.

PostgreSQL checks the persisted capture grant policy again in the committing transaction. The legacy ledger migration retains existing rows with the reserved empty round. The local synthetic SQLite store upgrades its ledger transactionally and preserves old checkpoint entries; restart does not reset completed rounds.

Dashboard observations preserve `round_id` only when the original event contains it. Old projections retain their prior shape. A saved delivery cannot acquire another round under the same delivery ID. The Reports catalog displays the recorded round ID and labels events without a round as a single pass. It does not substitute a label from a newer route snapshot.

Focused checks cover route and binding validation, original policy copies, independent round selection, same-round duplicate denial, wrong guard/assignment/route revision, immutable event and delivery retries, atomic rollback and SQLite restart/migration. `verifyPostgresPatrolRounds(connectionString, owner)` replays these rules against a disposable PostgreSQL database, including transactional policy checks, current assignment/shift authority, exact concurrent retries, original grant revocation and legacy single-pass behavior. The local security advisors returned no issues after the ledger change. No hosted data or phone state was changed by these backend checks.
