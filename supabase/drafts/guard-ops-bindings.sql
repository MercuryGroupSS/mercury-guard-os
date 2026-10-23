BEGIN;
CREATE TABLE mercury_guard.ops_bindings (
 source_id text PRIMARY KEY CHECK(source_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'),
 revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 body jsonb NOT NULL CHECK(jsonb_typeof(body)='object' AND octet_length(body::text)<=32768),
 CHECK(COALESCE(body->>'opsShiftId'=source_id AND (body->>'revision')::bigint=revision,false))
);
CREATE TABLE mercury_guard.ops_binding_history (
 source_id text NOT NULL,
 revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 body jsonb NOT NULL CHECK(jsonb_typeof(body)='object' AND octet_length(body::text)<=32768),
 operator_label text NOT NULL CHECK(length(operator_label) BETWEEN 1 AND 500),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
 at_ms bigint NOT NULL CHECK(at_ms BETWEEN 1 AND 9007199254740991),
 PRIMARY KEY(source_id,revision),
 CHECK(COALESCE(body->>'opsShiftId'=source_id AND (body->>'revision')::bigint=revision,false))
);
ALTER TABLE mercury_guard.ops_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercury_guard.ops_binding_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mercury_guard.ops_bindings,mercury_guard.ops_binding_history FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON mercury_guard.ops_bindings TO service_role;
GRANT SELECT,INSERT ON mercury_guard.ops_binding_history TO service_role;
COMMIT;
