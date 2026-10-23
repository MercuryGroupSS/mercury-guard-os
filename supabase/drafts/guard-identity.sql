-- Isolated identity persistence. No changes to public, billing or hr tables.
BEGIN;
CREATE SCHEMA mercury_guard;
REVOKE ALL ON SCHEMA mercury_guard FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA mercury_guard TO service_role;
CREATE TABLE mercury_guard.vendors (
 vendor_id text PRIMARY KEY CHECK (vendor_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'),
 kind text NOT NULL CHECK (kind IN ('company','individual')),
 active boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE mercury_guard.guards (
 guard_id text PRIMARY KEY CHECK (guard_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'),
 auth_subject uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
 vendor_id text NOT NULL REFERENCES mercury_guard.vendors(vendor_id) ON DELETE RESTRICT,
 active boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guards_vendor_id_idx ON mercury_guard.guards(vendor_id);
CREATE TABLE mercury_guard.guard_login (
 guard_id text PRIMARY KEY REFERENCES mercury_guard.guards(guard_id) ON DELETE RESTRICT,
 email text NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) <= 254 AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);
ALTER TABLE mercury_guard.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercury_guard.guards ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercury_guard.guard_login ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA mercury_guard FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON mercury_guard.vendors, mercury_guard.guards, mercury_guard.guard_login TO service_role;
COMMENT ON SCHEMA mercury_guard IS 'Mercury One server-side identity data. Not exposed as a client roster.';
COMMENT ON COLUMN mercury_guard.guards.auth_subject IS 'Individually verified Auth subject; a vendor or shared-device biometric is not guard identity.';
COMMIT;
