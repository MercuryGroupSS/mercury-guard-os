CREATE TABLE "mercury_guard"."admin_accounts" (
  "auth_subject" uuid    NOT NULL,
  "email"        text    NOT NULL,
  "active"       boolean NOT NULL DEFAULT false,
  "lock_marker"  integer NOT NULL DEFAULT 0,
  CONSTRAINT "admin_accounts_email_check" CHECK (((email = lower(email)) AND (length(email) <= 254) AND (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'::text))),
  CONSTRAINT "admin_accounts_email_key" UNIQUE (email),
  CONSTRAINT "admin_accounts_lock_marker_check" CHECK ((lock_marker = 0)),
  CONSTRAINT "admin_accounts_pkey" PRIMARY KEY (auth_subject)
);

ALTER TABLE "mercury_guard"."admin_accounts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "mercury_guard"."admin_audit" (
  "request_id"     uuid                     NOT NULL,
  "actor_subject"  uuid                     NOT NULL,
  "action"         text                     NOT NULL,
  "request_digest" text                     NOT NULL,
  "input"          jsonb                    NOT NULL,
  "receipt"        jsonb                    NOT NULL,
  "recorded_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "admin_audit_input_check" CHECK (((jsonb_typeof(input) = 'object'::text) AND (octet_length((input)::text) <= 65536))),
  CONSTRAINT "admin_audit_pkey" PRIMARY KEY (request_id),
  CONSTRAINT "admin_audit_receipt_check" CHECK (((jsonb_typeof(receipt) = 'object'::text) AND (octet_length((receipt)::text) <= 8192))),
  CONSTRAINT "admin_audit_request_digest_check" CHECK ((request_digest ~ '^[a-f0-9]{64}$'::text))
);

ALTER TABLE "mercury_guard"."admin_audit"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "mercury_guard"."admin_accounts"
  ADD CONSTRAINT "admin_accounts_auth_subject_fkey" FOREIGN KEY (auth_subject) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE "mercury_guard"."admin_audit"
  ADD CONSTRAINT "admin_audit_actor_subject_fkey" FOREIGN KEY (actor_subject) REFERENCES mercury_guard.admin_accounts(auth_subject);

CREATE INDEX admin_audit_actor_idx ON mercury_guard.admin_audit USING btree (actor_subject, recorded_at);

REVOKE ALL ON mercury_guard.admin_accounts,mercury_guard.admin_audit FROM PUBLIC,anon,authenticated,service_role;

GRANT UPDATE ("lock_marker") ON TABLE "mercury_guard"."admin_accounts" TO "service_role";

GRANT SELECT ON TABLE "mercury_guard"."admin_accounts" TO "service_role";

GRANT INSERT, SELECT ON TABLE "mercury_guard"."admin_audit" TO "service_role";

