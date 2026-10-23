BEGIN;
CREATE TABLE mercury_guard.admin_membership_audit (
 request_id uuid PRIMARY KEY,
 auth_subject uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 email text NOT NULL CHECK(email=lower(email) AND length(email)<=254 AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 active boolean NOT NULL,
 operator_label text NOT NULL CHECK(length(operator_label) BETWEEN 1 AND 100),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object' AND octet_length(receipt::text)<=8192),
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_membership_audit_subject_idx ON mercury_guard.admin_membership_audit(auth_subject,recorded_at);
ALTER TABLE mercury_guard.admin_membership_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mercury_guard.admin_membership_audit FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON mercury_guard.admin_membership_audit TO service_role;
COMMIT;
