ALTER TABLE "mercury_guard"."dashboard_outbox"
  ADD COLUMN "media_status" text NOT NULL DEFAULT 'pending'::text;

ALTER TABLE "mercury_guard"."dashboard_outbox"
  ADD COLUMN "media_attempts" bigint NOT NULL DEFAULT 0;

ALTER TABLE "mercury_guard"."dashboard_outbox"
  ADD COLUMN "media_next_at" bigint NOT NULL DEFAULT 0;

ALTER TABLE "mercury_guard"."dashboard_outbox"
  ADD COLUMN "media_lease" uuid;

ALTER TABLE "mercury_guard"."dashboard_outbox"
  ADD COLUMN "media_lease_until" bigint;

ALTER TABLE "mercury_guard"."dashboard_outbox"
  ADD COLUMN "media_receipt" jsonb;

ALTER TABLE "mercury_guard"."dashboard_outbox"
  ADD CONSTRAINT "dashboard_media_lease_pair" CHECK (((media_lease IS NULL) = (media_lease_until IS NULL)));

ALTER TABLE "mercury_guard"."dashboard_outbox"
  ADD CONSTRAINT "dashboard_media_receipt_state" CHECK ((((media_status = 'pending'::text) AND (media_receipt IS NULL)) OR ((media_status = 'delivered'::text) AND (media_receipt IS
    NOT NULL) AND (media_lease IS NULL))));

ALTER TABLE "mercury_guard"."dashboard_outbox"
  ADD CONSTRAINT "dashboard_outbox_media_attempts_check" CHECK (((media_attempts >= 0) AND (media_attempts <= '9007199254740991'::bigint)));

ALTER TABLE "mercury_guard"."dashboard_outbox"
  ADD CONSTRAINT "dashboard_outbox_media_lease_until_check" CHECK (((media_lease_until >= 1) AND (media_lease_until <= '9007199254740991'::bigint)));

ALTER TABLE "mercury_guard"."dashboard_outbox"
  ADD CONSTRAINT "dashboard_outbox_media_next_at_check" CHECK (((media_next_at >= 0) AND (media_next_at <= '9007199254740991'::bigint)));

ALTER TABLE "mercury_guard"."dashboard_outbox"
  ADD CONSTRAINT "dashboard_outbox_media_receipt_check" CHECK (((jsonb_typeof(media_receipt) = 'object'::text) AND (octet_length((media_receipt)::text) <= 4096)));

ALTER TABLE "mercury_guard"."dashboard_outbox"
  ADD CONSTRAINT "dashboard_outbox_media_status_check" CHECK ((media_status = ANY (ARRAY['pending'::text, 'delivered'::text])));

CREATE INDEX dashboard_media_pending_idx ON mercury_guard.dashboard_outbox USING btree (media_next_at, id)
  WHERE ((status = 'delivered'::text) AND (media_status = 'pending'::text));

REVOKE ALL ("media_attempts") ON TABLE "mercury_guard"."dashboard_outbox" FROM "service_role";

GRANT UPDATE ("media_attempts") ON TABLE "mercury_guard"."dashboard_outbox" TO "service_role";

REVOKE ALL ("media_lease_until") ON TABLE "mercury_guard"."dashboard_outbox" FROM "service_role";

GRANT UPDATE ("media_lease_until") ON TABLE "mercury_guard"."dashboard_outbox" TO "service_role";

REVOKE ALL ("media_lease") ON TABLE "mercury_guard"."dashboard_outbox" FROM "service_role";

GRANT UPDATE ("media_lease") ON TABLE "mercury_guard"."dashboard_outbox" TO "service_role";

REVOKE ALL ("media_next_at") ON TABLE "mercury_guard"."dashboard_outbox" FROM "service_role";

GRANT UPDATE ("media_next_at") ON TABLE "mercury_guard"."dashboard_outbox" TO "service_role";

REVOKE ALL ("media_receipt") ON TABLE "mercury_guard"."dashboard_outbox" FROM "service_role";

GRANT UPDATE ("media_receipt") ON TABLE "mercury_guard"."dashboard_outbox" TO "service_role";

REVOKE ALL ("media_status") ON TABLE "mercury_guard"."dashboard_outbox" FROM "service_role";

GRANT UPDATE ("media_status") ON TABLE "mercury_guard"."dashboard_outbox" TO "service_role";




-- Receiver-only objects: no sender schema is required below this marker.
CREATE TABLE "mercury_guard_receiver"."media" (
  "delivery_id" text                     NOT NULL,
  "sha256"      text                     NOT NULL,
  "bytes"       bytea                    NOT NULL,
  "receipt"     jsonb                    NOT NULL,
  "received_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "media_bytes_check" CHECK (((octet_length(bytes) >= 1) AND (octet_length(bytes) <= 20971520))),
  CONSTRAINT "media_pkey" PRIMARY KEY (delivery_id),
  CONSTRAINT "media_receipt_check" CHECK (((jsonb_typeof(receipt) = 'object'::text) AND (octet_length((receipt)::text) <= 4096))),
  CONSTRAINT "media_sha256_check" CHECK ((sha256 ~ '^[a-f0-9]{64}$'::text))
);

ALTER TABLE "mercury_guard_receiver"."media"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "mercury_guard_receiver"."media"
  ADD CONSTRAINT "media_delivery_id_fkey" FOREIGN KEY (delivery_id) REFERENCES mercury_guard_receiver.observations(delivery_id);

REVOKE ALL ON mercury_guard_receiver.media FROM PUBLIC,anon,authenticated,service_role;
GRANT INSERT, SELECT ON TABLE "mercury_guard_receiver"."media" TO "service_role";
