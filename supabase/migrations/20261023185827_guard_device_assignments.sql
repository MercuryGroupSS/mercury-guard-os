CREATE TABLE "mercury_guard"."assignments" (
  "assignment_id"   text    NOT NULL,
  "guard_id"        text    NOT NULL,
  "vendor_id"       text    NOT NULL,
  "site_id"         text    NOT NULL,
  "starts_at_ms"    bigint  NOT NULL,
  "ends_at_ms"      bigint  NOT NULL,
  "active"          boolean NOT NULL DEFAULT false,
  "patrol_route"    jsonb,
  "check_in_policy" jsonb,
  CONSTRAINT "assignments_assignment_id_check" CHECK ((assignment_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'::text)),
  CONSTRAINT "assignments_check_in_policy_check"
    CHECK (((check_in_policy IS NULL) OR ((jsonb_typeof(check_in_policy) = 'object'::text) AND (octet_length((check_in_policy)::text) <= 16384)))),
  CONSTRAINT "assignments_check" CHECK ((((ends_at_ms >= 1) AND (ends_at_ms <= '9007199254740991'::bigint)) AND (ends_at_ms > starts_at_ms))),
  CONSTRAINT "assignments_patrol_route_check" CHECK (((patrol_route IS NULL) OR ((jsonb_typeof(patrol_route) = 'object'::text) AND (octet_length((patrol_route)::text) <= 65536)))),
  CONSTRAINT "assignments_pkey" PRIMARY KEY (assignment_id),
  CONSTRAINT "assignments_starts_at_ms_check" CHECK (((starts_at_ms >= 1) AND (starts_at_ms <= '9007199254740991'::bigint)))
);

ALTER TABLE "mercury_guard"."assignments"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "mercury_guard"."device_challenges" (
  "request_id"    uuid   NOT NULL,
  "auth_subject"  uuid   NOT NULL,
  "device_id"     text   NOT NULL,
  "nonce"         text   NOT NULL,
  "expires_at_ms" bigint NOT NULL,
  CONSTRAINT "device_challenges_auth_subject_device_id_key" UNIQUE (auth_subject, device_id),
  CONSTRAINT "device_challenges_expires_at_ms_check" CHECK (((expires_at_ms >= 1) AND (expires_at_ms <= '9007199254740991'::bigint))),
  CONSTRAINT "device_challenges_nonce_check" CHECK ((nonce ~ '^[A-Za-z0-9_-]{43}$'::text)),
  CONSTRAINT "device_challenges_pkey" PRIMARY KEY (request_id)
);

ALTER TABLE "mercury_guard"."device_challenges"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "mercury_guard"."devices" (
  "device_id"          text    NOT NULL,
  "mode"               text    NOT NULL,
  "site_id"            text,
  "guard_id"           text,
  "thumbprint"         text    NOT NULL,
  "public_key_spki"    text    NOT NULL,
  "active"             boolean NOT NULL DEFAULT false,
  "revoked"            boolean NOT NULL DEFAULT false,
  "revocation_version" bigint  NOT NULL DEFAULT 1,
  CONSTRAINT "devices_check" CHECK ((((mode = 'site'::text) AND (site_id IS NOT NULL) AND (guard_id IS NULL)) OR ((mode = 'personal'::text) AND (guard_id IS
    NOT NULL) AND (site_id IS NULL)))),
  CONSTRAINT "devices_device_id_check" CHECK ((device_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'::text)),
  CONSTRAINT "devices_mode_check" CHECK ((mode = ANY (ARRAY['site'::text, 'personal'::text]))),
  CONSTRAINT "devices_pkey" PRIMARY KEY (device_id),
  CONSTRAINT "devices_public_key_spki_check" CHECK (public_key_spki ~ '^[A-Za-z0-9_-]+$'::text AND length(public_key_spki)<=342),
  CONSTRAINT "devices_revocation_version_check" CHECK (((revocation_version >= 1) AND (revocation_version <= '9007199254740991'::bigint))),
  CONSTRAINT "devices_thumbprint_check" CHECK ((thumbprint ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "devices_thumbprint_key" UNIQUE (thumbprint)
);

ALTER TABLE "mercury_guard"."devices"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "mercury_guard"."sites" (
  "site_id" text    NOT NULL,
  "active"  boolean NOT NULL DEFAULT false,
  CONSTRAINT "sites_pkey" PRIMARY KEY (site_id),
  CONSTRAINT "sites_site_id_check" CHECK ((site_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'::text))
);

ALTER TABLE "mercury_guard"."sites"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "mercury_guard"."device_challenges"
  ADD CONSTRAINT "device_challenges_auth_subject_fkey" FOREIGN KEY (auth_subject) REFERENCES mercury_guard.guards(auth_subject) ON DELETE RESTRICT;

ALTER TABLE "mercury_guard"."devices"
  ADD CONSTRAINT "devices_guard_id_fkey" FOREIGN KEY (guard_id) REFERENCES mercury_guard.guards(guard_id) ON DELETE RESTRICT;

ALTER TABLE "mercury_guard"."device_challenges"
  ADD CONSTRAINT "device_challenges_device_id_fkey" FOREIGN KEY (device_id) REFERENCES mercury_guard.devices(device_id) ON DELETE RESTRICT;

ALTER TABLE "mercury_guard"."guards"
  ADD CONSTRAINT "guards_identity_vendor_key" UNIQUE (guard_id, vendor_id);

ALTER TABLE "mercury_guard"."assignments"
  ADD CONSTRAINT "assignments_guard_id_vendor_id_fkey" FOREIGN KEY (guard_id, vendor_id) REFERENCES mercury_guard.guards(guard_id, vendor_id) ON DELETE RESTRICT;

ALTER TABLE "mercury_guard"."assignments"
  ADD CONSTRAINT "assignments_site_id_fkey" FOREIGN KEY (site_id) REFERENCES mercury_guard.sites(site_id) ON DELETE RESTRICT;

ALTER TABLE "mercury_guard"."devices"
  ADD CONSTRAINT "devices_site_id_fkey" FOREIGN KEY (site_id) REFERENCES mercury_guard.sites(site_id) ON DELETE RESTRICT;

CREATE INDEX assignments_guard_vendor_idx ON mercury_guard.assignments USING btree (guard_id, vendor_id);

CREATE INDEX assignments_site_idx ON mercury_guard.assignments USING btree (site_id);

CREATE INDEX device_challenges_device_idx ON mercury_guard.device_challenges USING btree (device_id);

CREATE INDEX device_challenges_expiry_idx ON mercury_guard.device_challenges USING btree (expires_at_ms);

CREATE INDEX devices_guard_idx ON mercury_guard.devices USING btree (guard_id);

CREATE INDEX devices_site_idx ON mercury_guard.devices USING btree (site_id);

COMMENT ON COLUMN "mercury_guard"."devices"."public_key_spki" IS 'Public installation key only. P-256 parsing and possession proof remain required in the service.';

COMMENT ON TABLE "mercury_guard"."assignments" IS 'Versioned assignment scope. Server role may cancel but cannot rewrite identity, schedule or policy.';

REVOKE ALL ON mercury_guard.sites,mercury_guard.devices,mercury_guard.assignments,mercury_guard.device_challenges FROM PUBLIC,anon,authenticated,service_role;

GRANT UPDATE ("active") ON TABLE "mercury_guard"."assignments" TO "service_role";

GRANT INSERT, SELECT ON TABLE "mercury_guard"."assignments" TO "service_role";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "mercury_guard"."device_challenges" TO "service_role";

GRANT UPDATE ("active") ON TABLE "mercury_guard"."devices" TO "service_role";

GRANT UPDATE ("revocation_version") ON TABLE "mercury_guard"."devices" TO "service_role";

GRANT UPDATE ("revoked") ON TABLE "mercury_guard"."devices" TO "service_role";

GRANT INSERT, SELECT ON TABLE "mercury_guard"."devices" TO "service_role";

GRANT UPDATE ("active") ON TABLE "mercury_guard"."sites" TO "service_role";

GRANT INSERT, SELECT ON TABLE "mercury_guard"."sites" TO "service_role";

