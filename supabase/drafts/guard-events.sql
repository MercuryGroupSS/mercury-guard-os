BEGIN;
CREATE TABLE mercury_guard.ingested_events (
 cursor bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 device text NOT NULL REFERENCES mercury_guard.devices(thumbprint),
 id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence BETWEEN 1 AND 9007199254740991),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 body jsonb NOT NULL CHECK(jsonb_typeof(body)='object' AND octet_length(body::text)<=360000),
 received_at bigint NOT NULL CHECK(received_at BETWEEN 1 AND 9007199254740991),
 guard_id text NOT NULL,
 vendor_id text NOT NULL,
 assignment_id text NOT NULL REFERENCES mercury_guard.assignments(assignment_id),
 PRIMARY KEY(device,id), UNIQUE(device,sequence),
 FOREIGN KEY(guard_id,vendor_id) REFERENCES mercury_guard.guards(guard_id,vendor_id)
);
CREATE INDEX ingested_events_assignment_idx ON mercury_guard.ingested_events(assignment_id);
CREATE INDEX ingested_events_guard_vendor_idx ON mercury_guard.ingested_events(guard_id,vendor_id);
CREATE INDEX ingested_events_id_idx ON mercury_guard.ingested_events(id);
CREATE TABLE mercury_guard.ingest_receipts (
 device text NOT NULL REFERENCES mercury_guard.devices(thumbprint),
 id uuid NOT NULL,
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 body jsonb NOT NULL CHECK(jsonb_typeof(body)='object' AND octet_length(body::text)<=32768),
 PRIMARY KEY(device,id)
);
CREATE TABLE mercury_guard.ingested_checkpoints (
 guard_id text NOT NULL,
 assignment_id text NOT NULL REFERENCES mercury_guard.assignments(assignment_id),
 route text NOT NULL,
 revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 checkpoint text NOT NULL,
 device text NOT NULL,
 event_id uuid NOT NULL,
 PRIMARY KEY(guard_id,assignment_id,route,revision,checkpoint),
 FOREIGN KEY(device,event_id) REFERENCES mercury_guard.ingested_events(device,id)
);
CREATE INDEX ingested_checkpoints_event_idx ON mercury_guard.ingested_checkpoints(device,event_id);
CREATE INDEX ingested_checkpoints_assignment_idx ON mercury_guard.ingested_checkpoints(assignment_id);
CREATE TABLE mercury_guard.ingested_check_ins (
 guard_id text NOT NULL,
 assignment_id text NOT NULL REFERENCES mercury_guard.assignments(assignment_id),
 revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 slot bigint NOT NULL CHECK(slot BETWEEN 0 AND 9007199254740991),
 device text NOT NULL,
 event_id uuid NOT NULL,
 PRIMARY KEY(guard_id,assignment_id,revision,slot),
 FOREIGN KEY(device,event_id) REFERENCES mercury_guard.ingested_events(device,id)
);
CREATE INDEX ingested_check_ins_event_idx ON mercury_guard.ingested_check_ins(device,event_id);
CREATE INDEX ingested_check_ins_assignment_idx ON mercury_guard.ingested_check_ins(assignment_id);
CREATE TABLE mercury_guard.ingested_media (
 device text NOT NULL,
 event_id uuid NOT NULL,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 1 AND 20971520),
 received_at bigint NOT NULL CHECK(received_at BETWEEN 1 AND 9007199254740991),
 PRIMARY KEY(device,event_id),
 FOREIGN KEY(device,event_id) REFERENCES mercury_guard.ingested_events(device,id)
);
ALTER TABLE mercury_guard.ingested_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercury_guard.ingest_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercury_guard.ingested_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercury_guard.ingested_check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercury_guard.ingested_media ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mercury_guard.ingested_events,mercury_guard.ingest_receipts,mercury_guard.ingested_checkpoints,mercury_guard.ingested_check_ins,mercury_guard.ingested_media FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE mercury_guard.ingested_events_cursor_seq FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON mercury_guard.ingested_events,mercury_guard.ingest_receipts,mercury_guard.ingested_checkpoints,mercury_guard.ingested_check_ins,mercury_guard.ingested_media TO service_role;
GRANT USAGE ON SEQUENCE mercury_guard.ingested_events_cursor_seq TO service_role;
COMMIT;
