CREATE SCHEMA "mercury_guard_receiver";

REVOKE ALL ON SCHEMA mercury_guard_receiver FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE "mercury_guard_receiver"."bindings" (
  "assignment_id"      text    NOT NULL,
  "guard_id"           text    NOT NULL,
  "vendor_id"          text    NOT NULL,
  "site_id"            text    NOT NULL,
  "destination"        text    NOT NULL,
  "revision"           bigint  NOT NULL,
  "dashboard_shift_id" text    NOT NULL,
  "active"             boolean NOT NULL,
  CONSTRAINT "bindings_dashboard_shift_id_check" CHECK ((dashboard_shift_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'::text)),
  CONSTRAINT "bindings_pkey" PRIMARY KEY (assignment_id, guard_id, vendor_id, site_id, destination)
);

ALTER TABLE "mercury_guard_receiver"."bindings"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "mercury_guard_receiver"."mapping_history" (
  "request_id"     uuid                     NOT NULL,
  "assignment_id"  text                     NOT NULL,
  "guard_id"       text                     NOT NULL,
  "vendor_id"      text                     NOT NULL,
  "site_id"        text                     NOT NULL,
  "destination"    text                     NOT NULL,
  "revision"       bigint                   NOT NULL,
  "body"           jsonb                    NOT NULL,
  "input_hash"     text                     NOT NULL,
  "receipt"        jsonb                    NOT NULL,
  "operator_label" text                     NOT NULL,
  "reason"         text                     NOT NULL,
  "recorded_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "mapping_history_assignment_id_check" CHECK ((assignment_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'::text)),
  CONSTRAINT "mapping_history_assignment_id_guard_id_vendor_id_site_id_de_key" UNIQUE (assignment_id, guard_id, vendor_id, site_id, destination, revision),
  CONSTRAINT "mapping_history_body_check" CHECK (((jsonb_typeof(body) = 'object'::text) AND (octet_length((body)::text) <= 8192))),
  CONSTRAINT "mapping_history_destination_check" CHECK ((destination ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'::text)),
  CONSTRAINT "mapping_history_guard_id_check" CHECK ((guard_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'::text)),
  CONSTRAINT "mapping_history_input_hash_check" CHECK ((input_hash ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "mapping_history_operator_label_check" CHECK (((length(TRIM(BOTH FROM operator_label)) >= 1) AND (length(TRIM(BOTH FROM operator_label)) <= 120))),
  CONSTRAINT "mapping_history_pkey" PRIMARY KEY (request_id),
  CONSTRAINT "mapping_history_reason_check" CHECK (((length(TRIM(BOTH FROM reason)) >= 1) AND (length(TRIM(BOTH FROM reason)) <= 2000))),
  CONSTRAINT "mapping_history_receipt_check" CHECK (((jsonb_typeof(receipt) = 'object'::text) AND (octet_length((receipt)::text) <= 8192))),
  CONSTRAINT "mapping_history_revision_check" CHECK (((revision >= 1) AND (revision <= '9007199254740991'::bigint))),
  CONSTRAINT "mapping_history_site_id_check" CHECK ((site_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'::text)),
  CONSTRAINT "mapping_history_vendor_id_check" CHECK ((vendor_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'::text))
);

ALTER TABLE "mercury_guard_receiver"."mapping_history"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "mercury_guard_receiver"."observations" (
  "delivery_id"        text                     NOT NULL,
  "payload_sha256"     text                     NOT NULL,
  "raw_body"           text                     NOT NULL,
  "receipt"            jsonb                    NOT NULL,
  "assignment_id"      text                     NOT NULL,
  "guard_id"           text                     NOT NULL,
  "vendor_id"          text                     NOT NULL,
  "site_id"            text                     NOT NULL,
  "destination"        text                     NOT NULL,
  "mapping_revision"   bigint                   NOT NULL,
  "dashboard_shift_id" text                     NOT NULL,
  "received_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "observations_dashboard_shift_id_check" CHECK ((dashboard_shift_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'::text)),
  CONSTRAINT "observations_delivery_id_check" CHECK ((delivery_id ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "observations_payload_sha256_check" CHECK ((payload_sha256 ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "observations_pkey" PRIMARY KEY (delivery_id),
  CONSTRAINT "observations_raw_body_check" CHECK (((octet_length(raw_body) >= 1) AND (octet_length(raw_body) <= 64000))),
  CONSTRAINT "observations_receipt_check" CHECK (((jsonb_typeof(receipt) = 'object'::text) AND (octet_length((receipt)::text) <= 4096)))
);

ALTER TABLE "mercury_guard_receiver"."observations"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "mercury_guard_receiver"."bindings"
  ADD CONSTRAINT "bindings_assignment_id_guard_id_vendor_id_site_id_destinat_fkey" FOREIGN KEY (assignment_id, guard_id, vendor_id, site_id, destination, revision)
    REFERENCES mercury_guard_receiver.mapping_history(assignment_id, guard_id, vendor_id, site_id, destination, revision);

ALTER TABLE "mercury_guard_receiver"."observations"
  ADD CONSTRAINT "observations_assignment_id_guard_id_vendor_id_site_id_dest_fkey" FOREIGN KEY (assignment_id, guard_id, vendor_id, site_id, destination, mapping_revision)
    REFERENCES mercury_guard_receiver.mapping_history(assignment_id, guard_id, vendor_id, site_id, destination, revision);

CREATE INDEX receiver_observations_mapping_idx ON mercury_guard_receiver.observations USING btree (assignment_id, guard_id, vendor_id, site_id, destination, mapping_revision);

CREATE INDEX receiver_observations_shift_idx ON mercury_guard_receiver.observations USING btree (dashboard_shift_id, received_at, delivery_id);

CREATE INDEX receiver_bindings_history_idx ON mercury_guard_receiver.bindings USING btree (assignment_id, guard_id, vendor_id, site_id, destination, revision);

REVOKE ALL ON ALL TABLES IN SCHEMA mercury_guard_receiver FROM PUBLIC,anon,authenticated,service_role;

GRANT USAGE ON SCHEMA "mercury_guard_receiver" TO "service_role";

GRANT SELECT ON TABLE "mercury_guard_receiver"."bindings" TO "service_role";

GRANT INSERT, SELECT ON TABLE "mercury_guard_receiver"."observations" TO "service_role";
