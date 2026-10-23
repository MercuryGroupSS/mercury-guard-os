CREATE TABLE "mercury_guard"."check_in_alert_outbox" (
  "cursor"        bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "guard_id"      text   NOT NULL,
  "assignment_id" text   NOT NULL,
  "revision"      bigint NOT NULL,
  "slot"          bigint NOT NULL,
  "body"          jsonb  NOT NULL,
  "status"        text   NOT NULL DEFAULT 'pending'::text,
  CONSTRAINT "check_in_alert_outbox_body_check" CHECK (((jsonb_typeof(body) = 'object'::text) AND (octet_length((body)::text) <= 16384))),
  CONSTRAINT "check_in_alert_outbox_cursor_key" UNIQUE (cursor),
  CONSTRAINT "check_in_alert_outbox_pkey" PRIMARY KEY (guard_id, assignment_id, revision, slot),
  CONSTRAINT "check_in_alert_outbox_status_check" CHECK ((status = 'pending'::text))
);

ALTER TABLE "mercury_guard"."check_in_alert_outbox"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "mercury_guard"."check_in_worker_runs" (
  "assignment_id" text    NOT NULL,
  "revision"      bigint  NOT NULL,
  "finalized"     boolean NOT NULL,
  "last_success"  bigint  NOT NULL,
  CONSTRAINT "check_in_worker_runs_last_success_check" CHECK (((last_success >= 1) AND (last_success <= '9007199254740991'::bigint))),
  CONSTRAINT "check_in_worker_runs_pkey" PRIMARY KEY (assignment_id, revision),
  CONSTRAINT "check_in_worker_runs_revision_check" CHECK (((revision >= 1) AND (revision <= '9007199254740991'::bigint)))
);

ALTER TABLE "mercury_guard"."check_in_worker_runs"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "mercury_guard"."check_in_worker_state" (
  "id"     integer NOT NULL,
  "cursor" text    NOT NULL,
  CONSTRAINT "check_in_worker_state_id_check" CHECK ((id = 1)),
  CONSTRAINT "check_in_worker_state_pkey" PRIMARY KEY (id)
);

ALTER TABLE "mercury_guard"."check_in_worker_state"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "mercury_guard"."missed_check_ins" (
  "guard_id"      text   NOT NULL,
  "assignment_id" text   NOT NULL,
  "revision"      bigint NOT NULL,
  "slot"          bigint NOT NULL,
  "deadline"      bigint NOT NULL,
  "detected_at"   bigint NOT NULL,
  CONSTRAINT "missed_check_ins_check" CHECK (((detected_at >= deadline) AND (detected_at <= '9007199254740991'::bigint))),
  CONSTRAINT "missed_check_ins_deadline_check" CHECK (((deadline >= 1) AND (deadline <= '9007199254740991'::bigint))),
  CONSTRAINT "missed_check_ins_pkey" PRIMARY KEY (guard_id, assignment_id, revision, slot),
  CONSTRAINT "missed_check_ins_revision_check" CHECK (((revision >= 1) AND (revision <= '9007199254740991'::bigint))),
  CONSTRAINT "missed_check_ins_slot_check" CHECK (((slot >= 0) AND (slot <= 9999)))
);

ALTER TABLE "mercury_guard"."missed_check_ins"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "mercury_guard"."check_in_alert_outbox"
  ADD CONSTRAINT "check_in_alert_outbox_assignment_id_fkey" FOREIGN KEY (assignment_id) REFERENCES mercury_guard.assignments(assignment_id);

ALTER TABLE "mercury_guard"."check_in_worker_runs"
  ADD CONSTRAINT "check_in_worker_runs_assignment_id_fkey" FOREIGN KEY (assignment_id) REFERENCES mercury_guard.assignments(assignment_id);

ALTER TABLE "mercury_guard"."missed_check_ins"
  ADD CONSTRAINT "missed_check_ins_assignment_id_fkey" FOREIGN KEY (assignment_id) REFERENCES mercury_guard.assignments(assignment_id);

ALTER TABLE "mercury_guard"."check_in_alert_outbox"
  ADD CONSTRAINT "check_in_alert_outbox_guard_id_assignment_id_revision_slot_fkey" FOREIGN KEY (guard_id, assignment_id, revision, slot)
    REFERENCES mercury_guard.missed_check_ins(guard_id, assignment_id, revision, slot);

CREATE INDEX check_in_alert_assignment_idx ON mercury_guard.check_in_alert_outbox USING btree (assignment_id);

CREATE INDEX missed_check_ins_assignment_idx ON mercury_guard.missed_check_ins USING btree (assignment_id);

REVOKE ALL ON mercury_guard.missed_check_ins,mercury_guard.check_in_alert_outbox,mercury_guard.check_in_worker_state,mercury_guard.check_in_worker_runs FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE mercury_guard.check_in_alert_outbox_cursor_seq FROM PUBLIC,anon,authenticated,service_role;

GRANT USAGE ON SEQUENCE "mercury_guard"."check_in_alert_outbox_cursor_seq" TO "service_role";

GRANT INSERT, SELECT ON TABLE "mercury_guard"."check_in_alert_outbox" TO "service_role";

GRANT INSERT, SELECT, UPDATE ON TABLE "mercury_guard"."check_in_worker_runs" TO "service_role";

GRANT INSERT, SELECT, UPDATE ON TABLE "mercury_guard"."check_in_worker_state" TO "service_role";

GRANT INSERT, SELECT ON TABLE "mercury_guard"."missed_check_ins" TO "service_role";

