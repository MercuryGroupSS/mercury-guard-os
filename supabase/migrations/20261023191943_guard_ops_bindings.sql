CREATE TABLE "mercury_guard"."ops_binding_history" (
  "source_id"      text   NOT NULL,
  "revision"       bigint NOT NULL,
  "body"           jsonb  NOT NULL,
  "operator_label" text   NOT NULL,
  "reason"         text   NOT NULL,
  "at_ms"          bigint NOT NULL,
  CONSTRAINT "ops_binding_history_at_ms_check" CHECK (((at_ms >= 1) AND (at_ms <= '9007199254740991'::bigint))),
  CONSTRAINT "ops_binding_history_body_check" CHECK (((jsonb_typeof(body) = 'object'::text) AND (octet_length((body)::text) <= 32768))),
  CONSTRAINT "ops_binding_history_check" CHECK (COALESCE((((body ->> 'opsShiftId'::text) = source_id) AND (((body ->> 'revision'::text))::bigint = revision)), false)),
  CONSTRAINT "ops_binding_history_operator_label_check" CHECK (((length(operator_label) >= 1) AND (length(operator_label) <= 500))),
  CONSTRAINT "ops_binding_history_pkey" PRIMARY KEY (source_id, revision),
  CONSTRAINT "ops_binding_history_reason_check" CHECK (((length(reason) >= 1) AND (length(reason) <= 500))),
  CONSTRAINT "ops_binding_history_revision_check" CHECK (((revision >= 1) AND (revision <= '9007199254740991'::bigint)))
);

ALTER TABLE "mercury_guard"."ops_binding_history"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "mercury_guard"."ops_bindings" (
  "source_id" text   NOT NULL,
  "revision"  bigint NOT NULL,
  "body"      jsonb  NOT NULL,
  CONSTRAINT "ops_bindings_body_check" CHECK (((jsonb_typeof(body) = 'object'::text) AND (octet_length((body)::text) <= 32768))),
  CONSTRAINT "ops_bindings_check" CHECK (COALESCE((((body ->> 'opsShiftId'::text) = source_id) AND (((body ->> 'revision'::text))::bigint = revision)), false)),
  CONSTRAINT "ops_bindings_pkey" PRIMARY KEY (source_id),
  CONSTRAINT "ops_bindings_revision_check" CHECK (((revision >= 1) AND (revision <= '9007199254740991'::bigint))),
  CONSTRAINT "ops_bindings_source_id_check" CHECK ((source_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'::text))
);

ALTER TABLE "mercury_guard"."ops_bindings"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON mercury_guard.ops_bindings,mercury_guard.ops_binding_history FROM PUBLIC,anon,authenticated,service_role;

GRANT INSERT, SELECT ON TABLE "mercury_guard"."ops_binding_history" TO "service_role";

GRANT INSERT, SELECT, UPDATE ON TABLE "mercury_guard"."ops_bindings" TO "service_role";

