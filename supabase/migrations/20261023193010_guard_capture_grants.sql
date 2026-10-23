CREATE TABLE "mercury_guard"."capture_grants" (
  "id"                uuid    NOT NULL,
  "subject"           uuid    NOT NULL,
  "vendor_id"         text    NOT NULL,
  "assignment_id"     text    NOT NULL,
  "device_thumbprint" text    NOT NULL,
  "payload"           text    NOT NULL,
  "policy"            jsonb   NOT NULL,
  "revoked"           boolean NOT NULL DEFAULT false,
  CONSTRAINT "capture_grants_payload_check" CHECK (((payload ~ '^[A-Za-z0-9_-]+$'::text) AND (length(payload) <= 16384))),
  CONSTRAINT "capture_grants_pkey" PRIMARY KEY (id),
  CONSTRAINT "capture_grants_policy_check" CHECK (((jsonb_typeof(policy) = 'object'::text) AND (octet_length((policy)::text) <= 81920)))
);

ALTER TABLE "mercury_guard"."capture_grants"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "mercury_guard"."capture_grants"
  ADD CONSTRAINT "capture_grants_assignment_id_fkey" FOREIGN KEY (assignment_id) REFERENCES mercury_guard.assignments(assignment_id);

ALTER TABLE "mercury_guard"."capture_grants"
  ADD CONSTRAINT "capture_grants_device_thumbprint_fkey" FOREIGN KEY (device_thumbprint) REFERENCES mercury_guard.devices(thumbprint);

ALTER TABLE "mercury_guard"."capture_grants"
  ADD CONSTRAINT "capture_grants_subject_fkey" FOREIGN KEY (subject) REFERENCES mercury_guard.guards(auth_subject);

ALTER TABLE "mercury_guard"."capture_grants"
  ADD CONSTRAINT "capture_grants_vendor_id_fkey" FOREIGN KEY (vendor_id) REFERENCES mercury_guard.vendors(vendor_id);

CREATE INDEX capture_grants_assignment_idx ON mercury_guard.capture_grants USING btree (assignment_id);

CREATE INDEX capture_grants_device_idx ON mercury_guard.capture_grants USING btree (device_thumbprint);

CREATE INDEX capture_grants_subject_idx ON mercury_guard.capture_grants USING btree (subject);

CREATE INDEX capture_grants_vendor_idx ON mercury_guard.capture_grants USING btree (vendor_id);

REVOKE ALL ON mercury_guard.capture_grants FROM PUBLIC,anon,authenticated,service_role;

GRANT UPDATE ("revoked") ON TABLE "mercury_guard"."capture_grants" TO "service_role";

GRANT INSERT, SELECT ON TABLE "mercury_guard"."capture_grants" TO "service_role";

