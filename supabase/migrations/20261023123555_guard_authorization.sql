CREATE TABLE "public"."guard_authorizations" (
  "subject"            uuid                     NOT NULL,
  "active"             boolean                  NOT NULL DEFAULT false,
  "enrolled"           boolean                  NOT NULL DEFAULT false,
  "revoked"            boolean                  NOT NULL DEFAULT true,
  "audience"           text                     NOT NULL,
  "guard_id"           text                     NOT NULL,
  "site_id"            text                     NOT NULL,
  "assignment_id"      text                     NOT NULL,
  "thumbprint"         text                     NOT NULL,
  "public_key_spki"    text                     NOT NULL,
  "revocation_version" bigint                   NOT NULL,
  "not_before"         bigint                   NOT NULL,
  "expires_at"         bigint                   NOT NULL,
  "allowed_kinds"      text[]                   NOT NULL,
  "updated_at"         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "guard_authorizations_allowed_kinds_check" CHECK ((cardinality(allowed_kinds) > 0)),
  CONSTRAINT "guard_authorizations_assignment_id_check" CHECK (((length(assignment_id) >= 1) AND (length(assignment_id) <= 200))),
  CONSTRAINT "guard_authorizations_audience_check" CHECK (((length(audience) >= 1) AND (length(audience) <= 128))),
  CONSTRAINT "guard_authorizations_check" CHECK (((expires_at > not_before) AND ((expires_at - not_before) <= 900))),
  CONSTRAINT "guard_authorizations_guard_id_check" CHECK (((length(guard_id) >= 1) AND (length(guard_id) <= 200))),
  CONSTRAINT "guard_authorizations_pkey" PRIMARY KEY (subject),
  CONSTRAINT "guard_authorizations_revocation_version_check" CHECK ((revocation_version >= 0)),
  CONSTRAINT "guard_authorizations_site_id_check" CHECK (((length(site_id) >= 1) AND (length(site_id) <= 200))),
  CONSTRAINT "guard_authorizations_thumbprint_check" CHECK ((thumbprint ~ '^[a-f0-9]{64}$'::text))
);

ALTER TABLE "public"."guard_authorizations"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."guard_authorizations" FROM "anon", "authenticated";

ALTER TABLE "public"."guard_authorizations"
  ADD CONSTRAINT "guard_authorizations_subject_fkey" FOREIGN KEY (subject) REFERENCES auth.users(id) ON DELETE CASCADE;

COMMENT ON TABLE "public"."guard_authorizations" IS 'Local pilot authority: one explicitly provisioned current device/assignment per Auth subject. Never populated from user metadata.';

REVOKE ALL ON TABLE "public"."guard_authorizations" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."guard_authorizations" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."guard_authorizations" TO "service_role";

