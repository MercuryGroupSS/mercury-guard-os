BEGIN;
CREATE TABLE mercury_guard.shift_sessions (
 assignment text PRIMARY KEY REFERENCES mercury_guard.assignments(assignment_id),
 guard text NOT NULL,
 vendor text NOT NULL,
 site text NOT NULL REFERENCES mercury_guard.sites(site_id),
 device text NOT NULL REFERENCES mercury_guard.devices(thumbprint),
 starts_at bigint NOT NULL CHECK(starts_at BETWEEN 1 AND 9007199254740991),
 ends_at bigint NOT NULL CHECK(ends_at BETWEEN 1 AND 9007199254740991 AND ends_at>starts_at),
 clocked_in bigint NOT NULL CHECK(clocked_in>=starts_at AND clocked_in<ends_at),
 clocked_out bigint CHECK(clocked_out>=clocked_in AND clocked_out<=ends_at+86400000),
 reason text CHECK(length(reason)<=2000),
 FOREIGN KEY(guard,vendor) REFERENCES mercury_guard.guards(guard_id,vendor_id),
 CHECK((clocked_out IS NULL AND reason IS NULL) OR (clocked_out IS NOT NULL AND reason IS NOT NULL))
);
CREATE UNIQUE INDEX one_active_guard ON mercury_guard.shift_sessions(guard) WHERE clocked_out IS NULL;
CREATE UNIQUE INDEX one_active_phone ON mercury_guard.shift_sessions(device) WHERE clocked_out IS NULL;
CREATE INDEX shift_sessions_guard_vendor_idx ON mercury_guard.shift_sessions(guard,vendor);
CREATE INDEX shift_sessions_site_idx ON mercury_guard.shift_sessions(site);
CREATE INDEX shift_sessions_device_idx ON mercury_guard.shift_sessions(device);
CREATE TABLE mercury_guard.shift_transitions (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 request text NOT NULL UNIQUE CHECK(request ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object' AND octet_length(receipt::text)<=16384)
);
CREATE TABLE mercury_guard.shift_rejections (
 request text PRIMARY KEY CHECK(request ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object' AND octet_length(receipt::text)<=16384)
);
ALTER TABLE mercury_guard.shift_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercury_guard.shift_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercury_guard.shift_rejections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mercury_guard.shift_sessions,mercury_guard.shift_transitions,mercury_guard.shift_rejections FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE mercury_guard.shift_transitions_sequence_seq FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON mercury_guard.shift_sessions,mercury_guard.shift_transitions,mercury_guard.shift_rejections TO service_role;
GRANT UPDATE(clocked_out,reason) ON mercury_guard.shift_sessions TO service_role;
GRANT USAGE ON SEQUENCE mercury_guard.shift_transitions_sequence_seq TO service_role;
COMMIT;
