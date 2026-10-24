DROP INDEX "mercury_guard"."location_consents_scope_idx";

CREATE SEQUENCE "mercury_guard"."location_consent_ordinal_seq" AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;

ALTER TABLE "mercury_guard"."location_consents"
  ADD COLUMN "ordinal" bigint;

-- Preserve NULL on historical rows; a volatile ADD COLUMN default would invent
-- an order for them. Only inserts after this migration receive server ordinals.
ALTER TABLE "mercury_guard"."location_consents"
  ALTER COLUMN "ordinal" SET DEFAULT nextval('mercury_guard.location_consent_ordinal_seq'::regclass);

ALTER SEQUENCE "mercury_guard"."location_consent_ordinal_seq" OWNED BY "mercury_guard"."location_consents"."ordinal";

ALTER TABLE "mercury_guard"."location_consents"
  ADD CONSTRAINT "location_consents_ordinal_new_check" CHECK (((ordinal IS NOT NULL) AND (ordinal > 0))) NOT VALID;

CREATE UNIQUE INDEX location_consents_ordinal_key ON mercury_guard.location_consents USING btree (ordinal);

CREATE INDEX location_consents_scope_idx ON mercury_guard.location_consents
  USING btree (subject, assignment_id, device_id, device_thumbprint, revocation_version, policy_sha256, ordinal DESC)
  WHERE (ordinal IS NOT NULL);

COMMENT ON COLUMN "mercury_guard"."location_consents"."ordinal" IS 'Immutable server order for new explicit consents. Unnumbered historical consents remain auditable but cannot issue location grants or authorize new location ingestion.';

REVOKE ALL ON SEQUENCE "mercury_guard"."location_consent_ordinal_seq" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT USAGE ON SEQUENCE "mercury_guard"."location_consent_ordinal_seq" TO "service_role";

