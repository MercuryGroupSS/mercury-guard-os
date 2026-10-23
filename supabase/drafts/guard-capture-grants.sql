BEGIN;
CREATE TABLE mercury_guard.capture_grants (
 id uuid PRIMARY KEY,
 subject uuid NOT NULL REFERENCES mercury_guard.guards(auth_subject),
 vendor_id text NOT NULL REFERENCES mercury_guard.vendors(vendor_id),
 assignment_id text NOT NULL REFERENCES mercury_guard.assignments(assignment_id),
 device_thumbprint text NOT NULL REFERENCES mercury_guard.devices(thumbprint),
 payload text NOT NULL CHECK(payload ~ '^[A-Za-z0-9_-]+$' AND length(payload)<=16384),
 policy jsonb NOT NULL CHECK(jsonb_typeof(policy)='object' AND octet_length(policy::text)<=81920),
 revoked boolean NOT NULL DEFAULT false
);
CREATE INDEX capture_grants_subject_idx ON mercury_guard.capture_grants(subject);
CREATE INDEX capture_grants_vendor_idx ON mercury_guard.capture_grants(vendor_id);
CREATE INDEX capture_grants_assignment_idx ON mercury_guard.capture_grants(assignment_id);
CREATE INDEX capture_grants_device_idx ON mercury_guard.capture_grants(device_thumbprint);
ALTER TABLE mercury_guard.capture_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mercury_guard.capture_grants FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON mercury_guard.capture_grants TO service_role;
GRANT UPDATE(revoked) ON mercury_guard.capture_grants TO service_role;
COMMIT;
