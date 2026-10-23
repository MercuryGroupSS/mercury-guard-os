BEGIN;
CREATE TABLE mercury_guard.dashboard_bindings (
 assignment_id text NOT NULL REFERENCES mercury_guard.assignments(assignment_id),
 guard_id text NOT NULL,
 vendor_id text NOT NULL,
 site_id text NOT NULL REFERENCES mercury_guard.sites(site_id),
 dashboard_shift_id text NOT NULL,
 destination text NOT NULL,
 revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 active boolean NOT NULL,
 PRIMARY KEY(assignment_id,guard_id,vendor_id,site_id),
 FOREIGN KEY(guard_id,vendor_id) REFERENCES mercury_guard.guards(guard_id,vendor_id)
);
CREATE INDEX dashboard_bindings_guard_vendor_idx ON mercury_guard.dashboard_bindings(guard_id,vendor_id);
CREATE INDEX dashboard_bindings_site_idx ON mercury_guard.dashboard_bindings(site_id);
CREATE TABLE mercury_guard.dashboard_mapping_history (
 assignment_id text NOT NULL REFERENCES mercury_guard.assignments(assignment_id),
 guard_id text NOT NULL,
 vendor_id text NOT NULL,
 site_id text NOT NULL,
 revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 body jsonb NOT NULL CHECK(jsonb_typeof(body)='object' AND octet_length(body::text)<=8192),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(assignment_id,guard_id,vendor_id,site_id,revision)
);
CREATE TABLE mercury_guard.dashboard_outbox (
 id text PRIMARY KEY CHECK(id ~ '^[a-f0-9]{64}$'),
 hash text NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'),
 body text NOT NULL CHECK(octet_length(body)<=64000),
 assignment_id text NOT NULL,
 guard_id text NOT NULL,
 vendor_id text NOT NULL,
 site_id text NOT NULL,
 mapping_revision bigint NOT NULL,
 destination text NOT NULL,
 dashboard_shift_id text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivered')),
 attempts bigint NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 9007199254740991),
 next_at bigint NOT NULL DEFAULT 0 CHECK(next_at BETWEEN 0 AND 9007199254740991),
 lease uuid,
 lease_until bigint CHECK(lease_until BETWEEN 1 AND 9007199254740991),
 receipt jsonb CHECK(octet_length(receipt::text)<=4096),
 FOREIGN KEY(assignment_id,guard_id,vendor_id,site_id,mapping_revision) REFERENCES mercury_guard.dashboard_mapping_history(assignment_id,guard_id,vendor_id,site_id,revision),
 CHECK((lease IS NULL)=(lease_until IS NULL)),
 CHECK((status='pending' AND receipt IS NULL) OR (status='delivered' AND receipt IS NOT NULL AND lease IS NULL))
);
CREATE INDEX dashboard_outbox_mapping_idx ON mercury_guard.dashboard_outbox(assignment_id,guard_id,vendor_id,site_id,mapping_revision);
CREATE INDEX dashboard_outbox_pending_idx ON mercury_guard.dashboard_outbox(next_at,id) WHERE status='pending';
CREATE TABLE mercury_guard.dashboard_bridge_state (
 channel text PRIMARY KEY CHECK(channel IN ('events','shifts','alerts')),
 cursor bigint NOT NULL CHECK(cursor BETWEEN 0 AND 9007199254740991)
);
ALTER TABLE mercury_guard.dashboard_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercury_guard.dashboard_mapping_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercury_guard.dashboard_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercury_guard.dashboard_bridge_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mercury_guard.dashboard_bindings,mercury_guard.dashboard_mapping_history,mercury_guard.dashboard_outbox,mercury_guard.dashboard_bridge_state FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON mercury_guard.dashboard_bindings,mercury_guard.dashboard_mapping_history,mercury_guard.dashboard_outbox TO service_role;
GRANT UPDATE(dashboard_shift_id,destination,revision,active) ON mercury_guard.dashboard_bindings TO service_role;
GRANT UPDATE(status,attempts,next_at,lease,lease_until,receipt) ON mercury_guard.dashboard_outbox TO service_role;
GRANT SELECT,INSERT,UPDATE ON mercury_guard.dashboard_bridge_state TO service_role;
COMMIT;
