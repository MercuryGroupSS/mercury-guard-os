CREATE TABLE "mercury_guard"."escalation_acknowledgements" (
  "escalation_id"      uuid   NOT NULL,
  "actor_subject"      uuid   NOT NULL,
  "acknowledged_at_ms" bigint NOT NULL,
  "note"               text   NOT NULL,
  CONSTRAINT "escalation_acknowledgements_acknowledged_at_ms_check" CHECK (((acknowledged_at_ms >= 1) AND (acknowledged_at_ms <= '9007199254740991'::bigint))),
  CONSTRAINT "escalation_acknowledgements_note_check" CHECK (((length(note) >= 1) AND (length(note) <= 500))),
  CONSTRAINT "escalation_acknowledgements_pkey" PRIMARY KEY (escalation_id)
);

ALTER TABLE "mercury_guard"."escalation_acknowledgements"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "mercury_guard"."escalations" (
  "escalation_id"      uuid   NOT NULL,
  "subject"            uuid   NOT NULL,
  "guard_id"           text   NOT NULL,
  "vendor_id"          text   NOT NULL,
  "device_id"          text   NOT NULL,
  "device_thumbprint"  text   NOT NULL,
  "revocation_version" bigint NOT NULL,
  "site_id"            text,
  "assignment_id"      text,
  "intent_raw"         text   NOT NULL,
  "intent_sha256"      text   NOT NULL,
  "received_at_ms"     bigint NOT NULL,
  "receipt"            jsonb  NOT NULL,
  CONSTRAINT "escalations_device_thumbprint_check" CHECK ((device_thumbprint ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "escalations_intent_raw_check" CHECK (((octet_length(intent_raw) >= 1) AND (octet_length(intent_raw) <= 11264))),
  CONSTRAINT "escalations_intent_sha256_check" CHECK ((intent_sha256 ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "escalations_pkey" PRIMARY KEY (escalation_id),
  CONSTRAINT "escalations_receipt_check" CHECK (((jsonb_typeof(receipt) = 'object'::text) AND (octet_length((receipt)::text) <= 4096))),
  CONSTRAINT "escalations_received_at_ms_check" CHECK (((received_at_ms >= 1) AND (received_at_ms <= '9007199254740991'::bigint))),
  CONSTRAINT "escalations_revocation_version_check" CHECK (((revocation_version >= 1) AND (revocation_version <= '9007199254740991'::bigint)))
);

ALTER TABLE "mercury_guard"."escalations"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "mercury_guard"."escalation_acknowledgements"
  ADD CONSTRAINT "escalation_acknowledgements_actor_subject_fkey" FOREIGN KEY (actor_subject) REFERENCES mercury_guard.admin_accounts(auth_subject) ON DELETE RESTRICT;

ALTER TABLE "mercury_guard"."escalations"
  ADD CONSTRAINT "escalations_assignment_id_fkey" FOREIGN KEY (assignment_id) REFERENCES mercury_guard.assignments(assignment_id) ON DELETE RESTRICT;

ALTER TABLE "mercury_guard"."escalations"
  ADD CONSTRAINT "escalations_device_id_fkey" FOREIGN KEY (device_id) REFERENCES mercury_guard.devices(device_id) ON DELETE RESTRICT;

ALTER TABLE "mercury_guard"."escalations"
  ADD CONSTRAINT "escalations_guard_id_fkey" FOREIGN KEY (guard_id) REFERENCES mercury_guard.guards(guard_id) ON DELETE RESTRICT;

ALTER TABLE "mercury_guard"."escalation_acknowledgements"
  ADD CONSTRAINT "escalation_acknowledgements_escalation_id_fkey" FOREIGN KEY (escalation_id) REFERENCES mercury_guard.escalations(escalation_id) ON DELETE RESTRICT;

ALTER TABLE "mercury_guard"."escalations"
  ADD CONSTRAINT "escalations_site_id_fkey" FOREIGN KEY (site_id) REFERENCES mercury_guard.sites(site_id) ON DELETE RESTRICT;

ALTER TABLE "mercury_guard"."escalations"
  ADD CONSTRAINT "escalations_subject_fkey" FOREIGN KEY (subject) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE "mercury_guard"."escalations"
  ADD CONSTRAINT "escalations_vendor_id_fkey" FOREIGN KEY (vendor_id) REFERENCES mercury_guard.vendors(vendor_id) ON DELETE RESTRICT;

CREATE INDEX escalation_acknowledgements_actor_idx ON mercury_guard.escalation_acknowledgements USING btree (actor_subject, acknowledged_at_ms);

CREATE INDEX escalations_assignment_idx ON mercury_guard.escalations USING btree (assignment_id);

CREATE INDEX escalations_device_idx ON mercury_guard.escalations USING btree (device_id);

CREATE INDEX escalations_guard_idx ON mercury_guard.escalations USING btree (guard_id);

CREATE INDEX escalations_received_idx ON mercury_guard.escalations USING btree (received_at_ms DESC, escalation_id DESC);

CREATE INDEX escalations_site_idx ON mercury_guard.escalations USING btree (site_id);

CREATE INDEX escalations_subject_device_idx ON mercury_guard.escalations USING btree (subject, device_thumbprint, escalation_id);

CREATE INDEX escalations_vendor_idx ON mercury_guard.escalations USING btree (vendor_id);

COMMENT ON TABLE "mercury_guard"."escalation_acknowledgements" IS 'First explicit approved operator acknowledgement; its note is visible to the originating guard.';

COMMENT ON TABLE "mercury_guard"."escalations" IS 'Immutable authenticated enrolled-device operator inbox. Receipt confirms service storage only; no external notification, emergency response or resolution is claimed.';

REVOKE ALL ON TABLE "mercury_guard"."escalations", "mercury_guard"."escalation_acknowledgements" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT ON TABLE "mercury_guard"."escalation_acknowledgements" TO "service_role";

GRANT INSERT, SELECT ON TABLE "mercury_guard"."escalations" TO "service_role";

