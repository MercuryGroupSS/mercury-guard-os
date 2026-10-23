CREATE TABLE "mercury_guard"."ingest_receipts" (
  "device" text  NOT NULL,
  "id"     uuid  NOT NULL,
  "digest" text  NOT NULL,
  "body"   jsonb NOT NULL,
  CONSTRAINT "ingest_receipts_body_check" CHECK (((jsonb_typeof(body) = 'object'::text) AND (octet_length((body)::text) <= 32768))),
  CONSTRAINT "ingest_receipts_digest_check" CHECK ((digest ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "ingest_receipts_pkey" PRIMARY KEY (device, id)
);

ALTER TABLE "mercury_guard"."ingest_receipts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "mercury_guard"."ingested_check_ins" (
  "guard_id"      text   NOT NULL,
  "assignment_id" text   NOT NULL,
  "revision"      bigint NOT NULL,
  "slot"          bigint NOT NULL,
  "device"        text   NOT NULL,
  "event_id"      uuid   NOT NULL,
  CONSTRAINT "ingested_check_ins_pkey" PRIMARY KEY (guard_id, assignment_id, revision, slot),
  CONSTRAINT "ingested_check_ins_revision_check" CHECK (((revision >= 1) AND (revision <= '9007199254740991'::bigint))),
  CONSTRAINT "ingested_check_ins_slot_check" CHECK (((slot >= 0) AND (slot <= '9007199254740991'::bigint)))
);

ALTER TABLE "mercury_guard"."ingested_check_ins"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "mercury_guard"."ingested_checkpoints" (
  "guard_id"      text   NOT NULL,
  "assignment_id" text   NOT NULL,
  "route"         text   NOT NULL,
  "revision"      bigint NOT NULL,
  "checkpoint"    text   NOT NULL,
  "device"        text   NOT NULL,
  "event_id"      uuid   NOT NULL,
  CONSTRAINT "ingested_checkpoints_pkey" PRIMARY KEY (guard_id, assignment_id, route, revision, checkpoint),
  CONSTRAINT "ingested_checkpoints_revision_check" CHECK (((revision >= 1) AND (revision <= '9007199254740991'::bigint)))
);

ALTER TABLE "mercury_guard"."ingested_checkpoints"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "mercury_guard"."ingested_events" (
  "cursor"        bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "device"        text   NOT NULL,
  "id"            uuid   NOT NULL,
  "sequence"      bigint NOT NULL,
  "digest"        text   NOT NULL,
  "body"          jsonb  NOT NULL,
  "received_at"   bigint NOT NULL,
  "guard_id"      text   NOT NULL,
  "vendor_id"     text   NOT NULL,
  "assignment_id" text   NOT NULL,
  CONSTRAINT "ingested_events_body_check" CHECK (((jsonb_typeof(body) = 'object'::text) AND (octet_length((body)::text) <= 360000))),
  CONSTRAINT "ingested_events_cursor_key" UNIQUE (cursor),
  CONSTRAINT "ingested_events_device_sequence_key" UNIQUE (device, SEQUENCE),
  CONSTRAINT "ingested_events_digest_check" CHECK ((digest ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "ingested_events_pkey" PRIMARY KEY (device, id),
  CONSTRAINT "ingested_events_received_at_check" CHECK (((received_at >= 1) AND (received_at <= '9007199254740991'::bigint))),
  CONSTRAINT "ingested_events_sequence_check" CHECK (((sequence >= 1) AND (sequence <= '9007199254740991'::bigint)))
);

ALTER TABLE "mercury_guard"."ingested_events"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "mercury_guard"."ingested_media" (
  "device"      text   NOT NULL,
  "event_id"    uuid   NOT NULL,
  "sha256"      text   NOT NULL,
  "bytes"       bytea  NOT NULL,
  "received_at" bigint NOT NULL,
  CONSTRAINT "ingested_media_bytes_check" CHECK (((octet_length(bytes) >= 1) AND (octet_length(bytes) <= 20971520))),
  CONSTRAINT "ingested_media_pkey" PRIMARY KEY (device, event_id),
  CONSTRAINT "ingested_media_received_at_check" CHECK (((received_at >= 1) AND (received_at <= '9007199254740991'::bigint))),
  CONSTRAINT "ingested_media_sha256_check" CHECK ((sha256 ~ '^[a-f0-9]{64}$'::text))
);

ALTER TABLE "mercury_guard"."ingested_media"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "mercury_guard"."ingest_receipts"
  ADD CONSTRAINT "ingest_receipts_device_fkey" FOREIGN KEY (device) REFERENCES mercury_guard.devices(thumbprint);

ALTER TABLE "mercury_guard"."ingested_check_ins"
  ADD CONSTRAINT "ingested_check_ins_assignment_id_fkey" FOREIGN KEY (assignment_id) REFERENCES mercury_guard.assignments(assignment_id);

ALTER TABLE "mercury_guard"."ingested_checkpoints"
  ADD CONSTRAINT "ingested_checkpoints_assignment_id_fkey" FOREIGN KEY (assignment_id) REFERENCES mercury_guard.assignments(assignment_id);

ALTER TABLE "mercury_guard"."ingested_events"
  ADD CONSTRAINT "ingested_events_assignment_id_fkey" FOREIGN KEY (assignment_id) REFERENCES mercury_guard.assignments(assignment_id);

ALTER TABLE "mercury_guard"."ingested_events"
  ADD CONSTRAINT "ingested_events_device_fkey" FOREIGN KEY (device) REFERENCES mercury_guard.devices(thumbprint);

ALTER TABLE "mercury_guard"."ingested_events"
  ADD CONSTRAINT "ingested_events_guard_id_vendor_id_fkey" FOREIGN KEY (guard_id, vendor_id) REFERENCES mercury_guard.guards(guard_id, vendor_id);

ALTER TABLE "mercury_guard"."ingested_check_ins"
  ADD CONSTRAINT "ingested_check_ins_device_event_id_fkey" FOREIGN KEY (device, event_id) REFERENCES mercury_guard.ingested_events(device, id);

ALTER TABLE "mercury_guard"."ingested_checkpoints"
  ADD CONSTRAINT "ingested_checkpoints_device_event_id_fkey" FOREIGN KEY (device, event_id) REFERENCES mercury_guard.ingested_events(device, id);

ALTER TABLE "mercury_guard"."ingested_media"
  ADD CONSTRAINT "ingested_media_device_event_id_fkey" FOREIGN KEY (device, event_id) REFERENCES mercury_guard.ingested_events(device, id);

CREATE INDEX ingested_check_ins_assignment_idx ON mercury_guard.ingested_check_ins USING btree (assignment_id);

CREATE INDEX ingested_check_ins_event_idx ON mercury_guard.ingested_check_ins USING btree (device, event_id);

CREATE INDEX ingested_checkpoints_assignment_idx ON mercury_guard.ingested_checkpoints USING btree (assignment_id);

CREATE INDEX ingested_checkpoints_event_idx ON mercury_guard.ingested_checkpoints USING btree (device, event_id);

CREATE INDEX ingested_events_assignment_idx ON mercury_guard.ingested_events USING btree (assignment_id);

CREATE INDEX ingested_events_guard_vendor_idx ON mercury_guard.ingested_events USING btree (guard_id, vendor_id);

CREATE INDEX ingested_events_id_idx ON mercury_guard.ingested_events USING btree (id);

REVOKE ALL ON mercury_guard.ingested_events,mercury_guard.ingest_receipts,mercury_guard.ingested_checkpoints,mercury_guard.ingested_check_ins,mercury_guard.ingested_media FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE mercury_guard.ingested_events_cursor_seq FROM PUBLIC,anon,authenticated,service_role;

GRANT USAGE ON SEQUENCE "mercury_guard"."ingested_events_cursor_seq" TO "service_role";

GRANT INSERT, SELECT ON TABLE "mercury_guard"."ingest_receipts" TO "service_role";

GRANT INSERT, SELECT ON TABLE "mercury_guard"."ingested_check_ins" TO "service_role";

GRANT INSERT, SELECT ON TABLE "mercury_guard"."ingested_checkpoints" TO "service_role";

GRANT INSERT, SELECT ON TABLE "mercury_guard"."ingested_events" TO "service_role";

GRANT INSERT, SELECT ON TABLE "mercury_guard"."ingested_media" TO "service_role";

