BEGIN;
CREATE TABLE mercury_guard.missed_check_ins (
 guard_id text NOT NULL,
 assignment_id text NOT NULL REFERENCES mercury_guard.assignments(assignment_id),
 revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 slot bigint NOT NULL CHECK(slot BETWEEN 0 AND 9999),
 deadline bigint NOT NULL CHECK(deadline BETWEEN 1 AND 9007199254740991),
 detected_at bigint NOT NULL CHECK(detected_at BETWEEN deadline AND 9007199254740991),
 PRIMARY KEY(guard_id,assignment_id,revision,slot)
);
CREATE INDEX missed_check_ins_assignment_idx ON mercury_guard.missed_check_ins(assignment_id);
CREATE TABLE mercury_guard.check_in_alert_outbox (
 cursor bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 guard_id text NOT NULL,
 assignment_id text NOT NULL REFERENCES mercury_guard.assignments(assignment_id),
 revision bigint NOT NULL,
 slot bigint NOT NULL,
 body jsonb NOT NULL CHECK(jsonb_typeof(body)='object' AND octet_length(body::text)<=16384),
 status text NOT NULL DEFAULT 'pending' CHECK(status='pending'),
 PRIMARY KEY(guard_id,assignment_id,revision,slot),
 FOREIGN KEY(guard_id,assignment_id,revision,slot) REFERENCES mercury_guard.missed_check_ins(guard_id,assignment_id,revision,slot)
);
CREATE INDEX check_in_alert_assignment_idx ON mercury_guard.check_in_alert_outbox(assignment_id);
CREATE TABLE mercury_guard.check_in_worker_state (
 id integer PRIMARY KEY CHECK(id=1),
 cursor text NOT NULL
);
CREATE TABLE mercury_guard.check_in_worker_runs (
 assignment_id text NOT NULL REFERENCES mercury_guard.assignments(assignment_id),
 revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 finalized boolean NOT NULL,
 last_success bigint NOT NULL CHECK(last_success BETWEEN 1 AND 9007199254740991),
 PRIMARY KEY(assignment_id,revision)
);
ALTER TABLE mercury_guard.missed_check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercury_guard.check_in_alert_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercury_guard.check_in_worker_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercury_guard.check_in_worker_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mercury_guard.missed_check_ins,mercury_guard.check_in_alert_outbox,mercury_guard.check_in_worker_state,mercury_guard.check_in_worker_runs FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE mercury_guard.check_in_alert_outbox_cursor_seq FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON mercury_guard.missed_check_ins,mercury_guard.check_in_alert_outbox TO service_role;
GRANT SELECT,INSERT,UPDATE ON mercury_guard.check_in_worker_state,mercury_guard.check_in_worker_runs TO service_role;
GRANT USAGE ON SEQUENCE mercury_guard.check_in_alert_outbox_cursor_seq TO service_role;
COMMIT;
