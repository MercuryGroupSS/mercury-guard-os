BEGIN;
CREATE TABLE mercury_guard.sites (
 site_id text PRIMARY KEY CHECK (site_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'),
 active boolean NOT NULL DEFAULT false
);
ALTER TABLE mercury_guard.guards ADD CONSTRAINT guards_identity_vendor_key UNIQUE(guard_id,vendor_id);
CREATE TABLE mercury_guard.devices (
 device_id text PRIMARY KEY CHECK (device_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'),
 mode text NOT NULL CHECK (mode IN ('site','personal')),
 site_id text REFERENCES mercury_guard.sites(site_id) ON DELETE RESTRICT,
 guard_id text REFERENCES mercury_guard.guards(guard_id) ON DELETE RESTRICT,
 thumbprint text NOT NULL UNIQUE CHECK (thumbprint ~ '^[a-f0-9]{64}$'),
 public_key_spki text NOT NULL CHECK (public_key_spki ~ '^[A-Za-z0-9_-]+$' AND length(public_key_spki)<=342),
 active boolean NOT NULL DEFAULT false,
 revoked boolean NOT NULL DEFAULT false,
 revocation_version bigint NOT NULL DEFAULT 1 CHECK (revocation_version BETWEEN 1 AND 9007199254740991),
 CHECK ((mode='site' AND site_id IS NOT NULL AND guard_id IS NULL) OR (mode='personal' AND guard_id IS NOT NULL AND site_id IS NULL))
);
CREATE INDEX devices_site_idx ON mercury_guard.devices(site_id);
CREATE INDEX devices_guard_idx ON mercury_guard.devices(guard_id);
CREATE TABLE mercury_guard.assignments (
 assignment_id text PRIMARY KEY CHECK (assignment_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'),
 guard_id text NOT NULL,
 vendor_id text NOT NULL,
 site_id text NOT NULL REFERENCES mercury_guard.sites(site_id) ON DELETE RESTRICT,
 starts_at_ms bigint NOT NULL CHECK (starts_at_ms BETWEEN 1 AND 9007199254740991),
 ends_at_ms bigint NOT NULL CHECK (ends_at_ms BETWEEN 1 AND 9007199254740991 AND ends_at_ms>starts_at_ms),
 active boolean NOT NULL DEFAULT false,
 patrol_route jsonb CHECK (patrol_route IS NULL OR (jsonb_typeof(patrol_route)='object' AND octet_length(patrol_route::text)<=65536)),
 check_in_policy jsonb CHECK (check_in_policy IS NULL OR (jsonb_typeof(check_in_policy)='object' AND octet_length(check_in_policy::text)<=16384)),
 FOREIGN KEY(guard_id,vendor_id) REFERENCES mercury_guard.guards(guard_id,vendor_id) ON DELETE RESTRICT
);
CREATE INDEX assignments_guard_vendor_idx ON mercury_guard.assignments(guard_id,vendor_id);
CREATE INDEX assignments_site_idx ON mercury_guard.assignments(site_id);
CREATE TABLE mercury_guard.device_challenges (
 request_id uuid PRIMARY KEY,
 auth_subject uuid NOT NULL REFERENCES mercury_guard.guards(auth_subject) ON DELETE RESTRICT,
 device_id text NOT NULL REFERENCES mercury_guard.devices(device_id) ON DELETE RESTRICT,
 nonce text NOT NULL CHECK (nonce ~ '^[A-Za-z0-9_-]{43}$'),
 expires_at_ms bigint NOT NULL CHECK (expires_at_ms BETWEEN 1 AND 9007199254740991),
 UNIQUE(auth_subject,device_id)
);
CREATE INDEX device_challenges_device_idx ON mercury_guard.device_challenges(device_id);
CREATE INDEX device_challenges_expiry_idx ON mercury_guard.device_challenges(expires_at_ms);
ALTER TABLE mercury_guard.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercury_guard.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercury_guard.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercury_guard.device_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mercury_guard.sites,mercury_guard.devices,mercury_guard.assignments,mercury_guard.device_challenges FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON mercury_guard.sites,mercury_guard.devices,mercury_guard.assignments TO service_role;
GRANT UPDATE(active) ON mercury_guard.sites,mercury_guard.assignments TO service_role;
GRANT UPDATE(active,revoked,revocation_version) ON mercury_guard.devices TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON mercury_guard.device_challenges TO service_role;
COMMENT ON COLUMN mercury_guard.devices.public_key_spki IS 'Public installation key only. P-256 parsing and possession proof remain required in the service.';
COMMENT ON TABLE mercury_guard.assignments IS 'Versioned assignment scope. Server role may cancel but cannot rewrite identity, schedule or policy.';
COMMIT;
