CREATE TABLE "mercury_guard"."location_consent_requests" (
  "request_id"    uuid  NOT NULL,
  "subject"       uuid  NOT NULL,
  "consent_id"    uuid  NOT NULL,
  "intent_sha256" text  NOT NULL,
  "receipt"       jsonb NOT NULL,
  CONSTRAINT "location_consent_requests_intent_sha256_check" CHECK ((intent_sha256 ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "location_consent_requests_pkey" PRIMARY KEY (request_id),
  CONSTRAINT "location_consent_requests_receipt_check" CHECK (((jsonb_typeof(receipt) = 'object'::text) AND (octet_length((receipt)::text) <= 4096)))
);

ALTER TABLE "mercury_guard"."location_consent_requests"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "mercury_guard"."location_consent_withdrawals" (
  "consent_id"      uuid   NOT NULL,
  "subject"         uuid   NOT NULL,
  "withdrawn_at_ms" bigint NOT NULL,
  "intent_raw"      text   NOT NULL,
  CONSTRAINT "location_consent_withdrawals_intent_raw_check" CHECK (((octet_length(intent_raw) >= 1) AND (octet_length(intent_raw) <= 4096))),
  CONSTRAINT "location_consent_withdrawals_pkey" PRIMARY KEY (consent_id),
  CONSTRAINT "location_consent_withdrawals_withdrawn_at_ms_check" CHECK (((withdrawn_at_ms >= 1) AND (withdrawn_at_ms <= '9007199254740991'::bigint)))
);

ALTER TABLE "mercury_guard"."location_consent_withdrawals"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "mercury_guard"."location_consents" (
  "consent_id"         uuid   NOT NULL,
  "subject"            uuid   NOT NULL,
  "guard_id"           text   NOT NULL,
  "vendor_id"          text   NOT NULL,
  "site_id"            text   NOT NULL,
  "assignment_id"      text   NOT NULL,
  "device_id"          text   NOT NULL,
  "device_thumbprint"  text   NOT NULL,
  "revocation_version" bigint NOT NULL,
  "public_key_spki"    text   NOT NULL,
  "policy_revision"    bigint NOT NULL,
  "policy_sha256"      text   NOT NULL,
  "policy_payload"     text   NOT NULL,
  "notice_revision"    bigint NOT NULL,
  "notice_sha256"      text   NOT NULL,
  "recorded_at_ms"     bigint NOT NULL,
  "intent_raw"         text   NOT NULL,
  CONSTRAINT "location_consents_device_thumbprint_check" CHECK ((device_thumbprint ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "location_consents_intent_raw_check" CHECK (((octet_length(intent_raw) >= 1) AND (octet_length(intent_raw) <= 4096))),
  CONSTRAINT "location_consents_notice_revision_check" CHECK (((notice_revision >= 1) AND (notice_revision <= '9007199254740991'::bigint))),
  CONSTRAINT "location_consents_notice_sha256_check" CHECK ((notice_sha256 ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "location_consents_pkey" PRIMARY KEY (consent_id),
  CONSTRAINT "location_consents_policy_payload_check" CHECK (((octet_length(policy_payload) >= 1) AND (octet_length(policy_payload) <= 10000))),
  CONSTRAINT "location_consents_policy_revision_check" CHECK (((policy_revision >= 1) AND (policy_revision <= '9007199254740991'::bigint))),
  CONSTRAINT "location_consents_policy_sha256_check" CHECK ((policy_sha256 ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "location_consents_public_key_spki_check" CHECK ((octet_length(public_key_spki) <= 1024)),
  CONSTRAINT "location_consents_recorded_at_ms_check" CHECK (((recorded_at_ms >= 1) AND (recorded_at_ms <= '9007199254740991'::bigint))),
  CONSTRAINT "location_consents_revocation_version_check" CHECK (((revocation_version >= 1) AND (revocation_version <= '9007199254740991'::bigint)))
);

ALTER TABLE "mercury_guard"."location_consents"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "mercury_guard"."assignments"
  ADD COLUMN "location_policy" jsonb;

ALTER TABLE "mercury_guard"."assignments"
  ADD CONSTRAINT "assignments_location_policy_check"
    CHECK (((location_policy IS NULL) OR ((jsonb_typeof(location_policy) = 'object'::text) AND (octet_length((location_policy)::text) <= 10000))));

ALTER TABLE "mercury_guard"."location_consent_requests"
  ADD CONSTRAINT "location_consent_requests_subject_fkey" FOREIGN KEY (subject) REFERENCES auth.users(id);

ALTER TABLE "mercury_guard"."location_consent_withdrawals"
  ADD CONSTRAINT "location_consent_withdrawals_subject_fkey" FOREIGN KEY (subject) REFERENCES auth.users(id);

ALTER TABLE "mercury_guard"."location_consents"
  ADD CONSTRAINT "location_consents_assignment_id_fkey" FOREIGN KEY (assignment_id) REFERENCES mercury_guard.assignments(assignment_id);

ALTER TABLE "mercury_guard"."location_consents"
  ADD CONSTRAINT "location_consents_device_id_fkey" FOREIGN KEY (device_id) REFERENCES mercury_guard.devices(device_id);

ALTER TABLE "mercury_guard"."location_consents"
  ADD CONSTRAINT "location_consents_guard_id_vendor_id_fkey" FOREIGN KEY (guard_id, vendor_id) REFERENCES mercury_guard.guards(guard_id, vendor_id);

ALTER TABLE "mercury_guard"."location_consent_requests"
  ADD CONSTRAINT "location_consent_requests_consent_id_fkey" FOREIGN KEY (consent_id) REFERENCES mercury_guard.location_consents(consent_id);

ALTER TABLE "mercury_guard"."location_consent_withdrawals"
  ADD CONSTRAINT "location_consent_withdrawals_consent_id_fkey" FOREIGN KEY (consent_id) REFERENCES mercury_guard.location_consents(consent_id);

ALTER TABLE "mercury_guard"."location_consents"
  ADD CONSTRAINT "location_consents_site_id_fkey" FOREIGN KEY (site_id) REFERENCES mercury_guard.sites(site_id);

ALTER TABLE "mercury_guard"."location_consents"
  ADD CONSTRAINT "location_consents_subject_fkey" FOREIGN KEY (subject) REFERENCES auth.users(id);

CREATE INDEX location_consent_requests_consent_idx ON mercury_guard.location_consent_requests USING btree (consent_id);

CREATE INDEX location_consent_requests_subject_idx ON mercury_guard.location_consent_requests USING btree (subject);

CREATE INDEX location_consent_withdrawals_subject_idx ON mercury_guard.location_consent_withdrawals USING btree (subject);

CREATE INDEX location_consents_assignment_idx ON mercury_guard.location_consents USING btree (assignment_id);

CREATE INDEX location_consents_device_idx ON mercury_guard.location_consents USING btree (device_id);

CREATE INDEX location_consents_guard_vendor_idx ON mercury_guard.location_consents USING btree (guard_id, vendor_id);

CREATE INDEX location_consents_scope_idx ON mercury_guard.location_consents
  USING btree (subject, assignment_id, device_id, device_thumbprint, revocation_version, policy_sha256, recorded_at_ms DESC, consent_id DESC);

CREATE INDEX location_consents_site_idx ON mercury_guard.location_consents USING btree (site_id);

COMMENT ON TABLE "mercury_guard"."location_consent_withdrawals" IS 'Permanent original-consent withdrawal; every subsequent location ingestion and renewal is denied. Existing immutable observations are retained without relabeling.';

COMMENT ON TABLE "mercury_guard"."location_consents" IS 'Immutable explicit individual/device/assignment policy consent. It never authorizes capture without a current confirmed-shift grant and contains no default cadence or geometry.';

REVOKE ALL ON TABLE "mercury_guard"."location_consents", "mercury_guard"."location_consent_withdrawals", "mercury_guard"."location_consent_requests" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT ON TABLE "mercury_guard"."location_consent_requests" TO "service_role";

GRANT INSERT, SELECT ON TABLE "mercury_guard"."location_consent_withdrawals" TO "service_role";

GRANT INSERT, SELECT ON TABLE "mercury_guard"."location_consents" TO "service_role";

