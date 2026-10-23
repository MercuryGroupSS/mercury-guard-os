BEGIN;
CREATE TABLE mercury_guard.dispatch_changes (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 scope text NOT NULL CHECK(scope ~ '^[a-f0-9]{64}$'),
 id text NOT NULL CHECK(id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'),
 version bigint NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
 body text NOT NULL CHECK(octet_length(body)<=65536),
 guard_id text NOT NULL,
 vendor_id text NOT NULL,
 site_id text NOT NULL REFERENCES mercury_guard.sites(site_id),
 assignment_id text NOT NULL REFERENCES mercury_guard.assignments(assignment_id),
 UNIQUE(scope,id,version),
 FOREIGN KEY(guard_id,vendor_id) REFERENCES mercury_guard.guards(guard_id,vendor_id)
);
CREATE INDEX dispatch_latest ON mercury_guard.dispatch_changes(scope,id,sequence DESC);
CREATE INDEX dispatch_guard_vendor_idx ON mercury_guard.dispatch_changes(guard_id,vendor_id);
CREATE INDEX dispatch_site_idx ON mercury_guard.dispatch_changes(site_id);
CREATE INDEX dispatch_assignment_idx ON mercury_guard.dispatch_changes(assignment_id);
CREATE TABLE mercury_guard.dispatch_cursors (
 token uuid PRIMARY KEY,
 scope text NOT NULL CHECK(scope ~ '^[a-f0-9]{64}$'),
 sequence bigint NOT NULL CHECK(sequence BETWEEN 0 AND 9007199254740991),
 expires bigint NOT NULL CHECK(expires BETWEEN 1 AND 9007199254740991),
 UNIQUE(scope,sequence)
);
CREATE INDEX dispatch_cursors_expiry_idx ON mercury_guard.dispatch_cursors(expires);
ALTER TABLE mercury_guard.dispatch_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercury_guard.dispatch_cursors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mercury_guard.dispatch_changes,mercury_guard.dispatch_cursors FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE mercury_guard.dispatch_changes_sequence_seq FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON mercury_guard.dispatch_changes TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON mercury_guard.dispatch_cursors TO service_role;
GRANT USAGE ON SEQUENCE mercury_guard.dispatch_changes_sequence_seq TO service_role;
COMMIT;
