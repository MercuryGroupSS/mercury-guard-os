BEGIN;
CREATE TABLE mercury_guard.admin_accounts (
 auth_subject uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
 email text NOT NULL UNIQUE CHECK(email=lower(email) AND length(email)<=254 AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 active boolean NOT NULL DEFAULT false,
 lock_marker integer NOT NULL DEFAULT 0 CHECK(lock_marker=0)
);
CREATE TABLE mercury_guard.admin_audit (
 request_id uuid PRIMARY KEY,
 actor_subject uuid NOT NULL REFERENCES mercury_guard.admin_accounts(auth_subject),
 action text NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 input jsonb NOT NULL CHECK(jsonb_typeof(input)='object' AND octet_length(input::text)<=65536),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object' AND octet_length(receipt::text)<=8192),
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_actor_idx ON mercury_guard.admin_audit(actor_subject,recorded_at);
ALTER TABLE mercury_guard.admin_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercury_guard.admin_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mercury_guard.admin_accounts,mercury_guard.admin_audit FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON mercury_guard.admin_accounts TO service_role;
GRANT UPDATE(lock_marker) ON mercury_guard.admin_accounts TO service_role;
GRANT SELECT,INSERT ON mercury_guard.admin_audit TO service_role;
COMMIT;
