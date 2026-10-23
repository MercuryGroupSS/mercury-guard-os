BEGIN;
CREATE TABLE mercury_guard.ops_assignment_sync (
 source_id text PRIMARY KEY CHECK (source_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'),
 source_at bigint NOT NULL CHECK(source_at BETWEEN 1 AND 9007199254740991),
 binding_revision bigint NOT NULL CHECK(binding_revision BETWEEN 1 AND 9007199254740991),
 source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'),
 binding_digest text NOT NULL CHECK(binding_digest ~ '^[a-f0-9]{64}$'),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 material text NOT NULL CHECK(material ~ '^[a-f0-9]{64}$'),
 assignment_id text REFERENCES mercury_guard.assignments(assignment_id),
 active boolean NOT NULL
);
CREATE INDEX ops_sync_assignment_idx ON mercury_guard.ops_assignment_sync(assignment_id);
CREATE TABLE mercury_guard.ops_binding_revocations (
 source_id text PRIMARY KEY CHECK(source_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'),
 revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991)
);
CREATE TABLE mercury_guard.ops_assignment_history (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 source_id text NOT NULL,
 source_at bigint NOT NULL CHECK(source_at BETWEEN 0 AND 9007199254740991),
 binding_revision bigint NOT NULL CHECK(binding_revision BETWEEN 1 AND 9007199254740991),
 assignment_id text REFERENCES mercury_guard.assignments(assignment_id),
 previous_assignment_id text REFERENCES mercury_guard.assignments(assignment_id),
 status text NOT NULL CHECK(status IN ('assignment_created','source_refreshed','assignment_cancelled','binding_revoked'))
);
CREATE INDEX ops_history_source_idx ON mercury_guard.ops_assignment_history(source_id,sequence);
CREATE INDEX ops_history_assignment_idx ON mercury_guard.ops_assignment_history(assignment_id);
CREATE INDEX ops_history_previous_idx ON mercury_guard.ops_assignment_history(previous_assignment_id);
ALTER TABLE mercury_guard.ops_assignment_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercury_guard.ops_binding_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercury_guard.ops_assignment_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mercury_guard.ops_assignment_sync,mercury_guard.ops_binding_revocations,mercury_guard.ops_assignment_history FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE mercury_guard.ops_assignment_history_sequence_seq FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON mercury_guard.ops_assignment_sync,mercury_guard.ops_binding_revocations TO service_role;
GRANT SELECT,INSERT ON mercury_guard.ops_assignment_history TO service_role;
GRANT USAGE ON SEQUENCE mercury_guard.ops_assignment_history_sequence_seq TO service_role;
COMMIT;
