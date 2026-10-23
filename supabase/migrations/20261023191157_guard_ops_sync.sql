ALTER TABLE "mercury_guard"."assignments"
  DROP CONSTRAINT "assignments_check";

CREATE TABLE "mercury_guard"."ops_assignment_history" (
  "sequence"               bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "source_id"              text   NOT NULL,
  "source_at"              bigint NOT NULL,
  "binding_revision"       bigint NOT NULL,
  "assignment_id"          text,
  "previous_assignment_id" text,
  "status"                 text   NOT NULL,
  CONSTRAINT "ops_assignment_history_binding_revision_check" CHECK (((binding_revision >= 1) AND (binding_revision <= '9007199254740991'::bigint))),
  CONSTRAINT "ops_assignment_history_pkey" PRIMARY KEY (SEQUENCE),
  CONSTRAINT "ops_assignment_history_source_at_check" CHECK (((source_at >= 0) AND (source_at <= '9007199254740991'::bigint))),
  CONSTRAINT "ops_assignment_history_status_check"
    CHECK ((status = ANY (ARRAY['assignment_created'::text, 'source_refreshed'::text, 'assignment_cancelled'::text, 'binding_revoked'::text])))
);

ALTER TABLE "mercury_guard"."ops_assignment_history"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "mercury_guard"."ops_assignment_sync" (
  "source_id"        text    NOT NULL,
  "source_at"        bigint  NOT NULL,
  "binding_revision" bigint  NOT NULL,
  "source_digest"    text    NOT NULL,
  "binding_digest"   text    NOT NULL,
  "digest"           text    NOT NULL,
  "material"         text    NOT NULL,
  "assignment_id"    text,
  "active"           boolean NOT NULL,
  CONSTRAINT "ops_assignment_sync_binding_digest_check" CHECK ((binding_digest ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "ops_assignment_sync_binding_revision_check" CHECK (((binding_revision >= 1) AND (binding_revision <= '9007199254740991'::bigint))),
  CONSTRAINT "ops_assignment_sync_digest_check" CHECK ((digest ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "ops_assignment_sync_material_check" CHECK ((material ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "ops_assignment_sync_pkey" PRIMARY KEY (source_id),
  CONSTRAINT "ops_assignment_sync_source_at_check" CHECK (((source_at >= 1) AND (source_at <= '9007199254740991'::bigint))),
  CONSTRAINT "ops_assignment_sync_source_digest_check" CHECK ((source_digest ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "ops_assignment_sync_source_id_check" CHECK ((source_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'::text))
);

ALTER TABLE "mercury_guard"."ops_assignment_sync"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "mercury_guard"."ops_binding_revocations" (
  "source_id" text   NOT NULL,
  "revision"  bigint NOT NULL,
  CONSTRAINT "ops_binding_revocations_pkey" PRIMARY KEY (source_id),
  CONSTRAINT "ops_binding_revocations_revision_check" CHECK (((revision >= 1) AND (revision <= '9007199254740991'::bigint))),
  CONSTRAINT "ops_binding_revocations_source_id_check" CHECK ((source_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'::text))
);

ALTER TABLE "mercury_guard"."ops_binding_revocations"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "mercury_guard"."ops_assignment_history"
  ADD CONSTRAINT "ops_assignment_history_assignment_id_fkey" FOREIGN KEY (assignment_id) REFERENCES mercury_guard.assignments(assignment_id);

ALTER TABLE "mercury_guard"."ops_assignment_history"
  ADD CONSTRAINT "ops_assignment_history_previous_assignment_id_fkey" FOREIGN KEY (previous_assignment_id) REFERENCES mercury_guard.assignments(assignment_id);

ALTER TABLE "mercury_guard"."ops_assignment_sync"
  ADD CONSTRAINT "ops_assignment_sync_assignment_id_fkey" FOREIGN KEY (assignment_id) REFERENCES mercury_guard.assignments(assignment_id);

CREATE INDEX ops_history_assignment_idx ON mercury_guard.ops_assignment_history USING btree (assignment_id);

CREATE INDEX ops_history_previous_idx ON mercury_guard.ops_assignment_history USING btree (previous_assignment_id);

CREATE INDEX ops_history_source_idx ON mercury_guard.ops_assignment_history USING btree (source_id, SEQUENCE);

CREATE INDEX ops_sync_assignment_idx ON mercury_guard.ops_assignment_sync USING btree (assignment_id);

REVOKE ALL ON mercury_guard.ops_assignment_sync,mercury_guard.ops_binding_revocations,mercury_guard.ops_assignment_history FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE mercury_guard.ops_assignment_history_sequence_seq FROM PUBLIC,anon,authenticated,service_role;

GRANT USAGE ON SEQUENCE "mercury_guard"."ops_assignment_history_sequence_seq" TO "service_role";

GRANT INSERT, SELECT ON TABLE "mercury_guard"."ops_assignment_history" TO "service_role";

GRANT INSERT, SELECT, UPDATE ON TABLE "mercury_guard"."ops_assignment_sync" TO "service_role";

GRANT INSERT, SELECT, UPDATE ON TABLE "mercury_guard"."ops_binding_revocations" TO "service_role";

