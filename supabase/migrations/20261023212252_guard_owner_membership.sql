CREATE TABLE "mercury_guard"."admin_membership_audit" (
  "request_id"     uuid                     NOT NULL,
  "auth_subject"   uuid                     NOT NULL,
  "email"          text                     NOT NULL,
  "active"         boolean                  NOT NULL,
  "operator_label" text                     NOT NULL,
  "reason"         text                     NOT NULL,
  "request_digest" text                     NOT NULL,
  "receipt"        jsonb                    NOT NULL,
  "recorded_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "admin_membership_audit_email_check" CHECK (((email = lower(email)) AND (length(email) <= 254) AND (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'::text))),
  CONSTRAINT "admin_membership_audit_operator_label_check" CHECK (((length(operator_label) >= 1) AND (length(operator_label) <= 100))),
  CONSTRAINT "admin_membership_audit_pkey" PRIMARY KEY (request_id),
  CONSTRAINT "admin_membership_audit_reason_check" CHECK (((length(reason) >= 1) AND (length(reason) <= 500))),
  CONSTRAINT "admin_membership_audit_receipt_check" CHECK (((jsonb_typeof(receipt) = 'object'::text) AND (octet_length((receipt)::text) <= 8192))),
  CONSTRAINT "admin_membership_audit_request_digest_check" CHECK ((request_digest ~ '^[a-f0-9]{64}$'::text))
);

ALTER TABLE "mercury_guard"."admin_membership_audit"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "mercury_guard"."admin_membership_audit"
  ADD CONSTRAINT "admin_membership_audit_auth_subject_fkey" FOREIGN KEY (auth_subject) REFERENCES auth.users(id) ON DELETE RESTRICT;

CREATE INDEX admin_membership_audit_subject_idx ON mercury_guard.admin_membership_audit USING btree (auth_subject, recorded_at);

REVOKE ALL ON "mercury_guard"."admin_membership_audit" FROM PUBLIC,anon,authenticated,service_role;

GRANT SELECT ON TABLE "mercury_guard"."admin_membership_audit" TO "service_role";

