CREATE TABLE "mercury_guard"."dashboard_bindings" (
  "assignment_id"      text    NOT NULL,
  "guard_id"           text    NOT NULL,
  "vendor_id"          text    NOT NULL,
  "site_id"            text    NOT NULL,
  "dashboard_shift_id" text    NOT NULL,
  "destination"        text    NOT NULL,
  "revision"           bigint  NOT NULL,
  "active"             boolean NOT NULL,
  CONSTRAINT "dashboard_bindings_pkey" PRIMARY KEY (assignment_id, guard_id, vendor_id, site_id),
  CONSTRAINT "dashboard_bindings_revision_check" CHECK (((revision >= 1) AND (revision <= '9007199254740991'::bigint)))
);

ALTER TABLE "mercury_guard"."dashboard_bindings"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "mercury_guard"."dashboard_bridge_state" (
  "channel" text   NOT NULL,
  "cursor"  bigint NOT NULL,
  CONSTRAINT "dashboard_bridge_state_channel_check" CHECK ((channel = ANY (ARRAY['events'::text, 'shifts'::text, 'alerts'::text]))),
  CONSTRAINT "dashboard_bridge_state_cursor_check" CHECK (((cursor >= 0) AND (cursor <= '9007199254740991'::bigint))),
  CONSTRAINT "dashboard_bridge_state_pkey" PRIMARY KEY (channel)
);

ALTER TABLE "mercury_guard"."dashboard_bridge_state"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "mercury_guard"."dashboard_mapping_history" (
  "assignment_id" text                     NOT NULL,
  "guard_id"      text                     NOT NULL,
  "vendor_id"     text                     NOT NULL,
  "site_id"       text                     NOT NULL,
  "revision"      bigint                   NOT NULL,
  "body"          jsonb                    NOT NULL,
  "recorded_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "dashboard_mapping_history_body_check" CHECK (((jsonb_typeof(body) = 'object'::text) AND (octet_length((body)::text) <= 8192))),
  CONSTRAINT "dashboard_mapping_history_pkey" PRIMARY KEY (assignment_id, guard_id, vendor_id, site_id, revision),
  CONSTRAINT "dashboard_mapping_history_revision_check" CHECK (((revision >= 1) AND (revision <= '9007199254740991'::bigint)))
);

ALTER TABLE "mercury_guard"."dashboard_mapping_history"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "mercury_guard"."dashboard_outbox" (
  "id"                 text   NOT NULL,
  "hash"               text   NOT NULL,
  "body"               text   NOT NULL,
  "assignment_id"      text   NOT NULL,
  "guard_id"           text   NOT NULL,
  "vendor_id"          text   NOT NULL,
  "site_id"            text   NOT NULL,
  "mapping_revision"   bigint NOT NULL,
  "destination"        text   NOT NULL,
  "dashboard_shift_id" text   NOT NULL,
  "status"             text   NOT NULL DEFAULT 'pending'::text,
  "attempts"           bigint NOT NULL DEFAULT 0,
  "next_at"            bigint NOT NULL DEFAULT 0,
  "lease"              uuid,
  "lease_until"        bigint,
  "receipt"            jsonb,
  CONSTRAINT "dashboard_outbox_attempts_check" CHECK (((attempts >= 0) AND (attempts <= '9007199254740991'::bigint))),
  CONSTRAINT "dashboard_outbox_body_check" CHECK ((octet_length(body) <= 64000)),
  CONSTRAINT "dashboard_outbox_check1" CHECK ((((status = 'pending'::text) AND (receipt IS NULL)) OR ((status = 'delivered'::text) AND (receipt IS NOT NULL) AND (lease IS NULL)))),
  CONSTRAINT "dashboard_outbox_check" CHECK (((lease IS NULL) = (lease_until IS NULL))),
  CONSTRAINT "dashboard_outbox_hash_check" CHECK ((hash ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "dashboard_outbox_id_check" CHECK ((id ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "dashboard_outbox_lease_until_check" CHECK (((lease_until >= 1) AND (lease_until <= '9007199254740991'::bigint))),
  CONSTRAINT "dashboard_outbox_next_at_check" CHECK (((next_at >= 0) AND (next_at <= '9007199254740991'::bigint))),
  CONSTRAINT "dashboard_outbox_pkey" PRIMARY KEY (id),
  CONSTRAINT "dashboard_outbox_receipt_check" CHECK ((octet_length((receipt)::text) <= 4096)),
  CONSTRAINT "dashboard_outbox_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'delivered'::text])))
);

ALTER TABLE "mercury_guard"."dashboard_outbox"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "mercury_guard"."dashboard_bindings"
  ADD CONSTRAINT "dashboard_bindings_assignment_id_fkey" FOREIGN KEY (assignment_id) REFERENCES mercury_guard.assignments(assignment_id);

ALTER TABLE "mercury_guard"."dashboard_bindings"
  ADD CONSTRAINT "dashboard_bindings_guard_id_vendor_id_fkey" FOREIGN KEY (guard_id, vendor_id) REFERENCES mercury_guard.guards(guard_id, vendor_id);

ALTER TABLE "mercury_guard"."dashboard_bindings"
  ADD CONSTRAINT "dashboard_bindings_site_id_fkey" FOREIGN KEY (site_id) REFERENCES mercury_guard.sites(site_id);

ALTER TABLE "mercury_guard"."dashboard_mapping_history"
  ADD CONSTRAINT "dashboard_mapping_history_assignment_id_fkey" FOREIGN KEY (assignment_id) REFERENCES mercury_guard.assignments(assignment_id);

ALTER TABLE "mercury_guard"."dashboard_outbox"
  ADD CONSTRAINT "dashboard_outbox_assignment_id_guard_id_vendor_id_site_id__fkey" FOREIGN KEY (assignment_id, guard_id, vendor_id, site_id, mapping_revision)
    REFERENCES mercury_guard.dashboard_mapping_history(assignment_id, guard_id, vendor_id, site_id, revision);

CREATE INDEX dashboard_bindings_guard_vendor_idx ON mercury_guard.dashboard_bindings USING btree (guard_id, vendor_id);

CREATE INDEX dashboard_bindings_site_idx ON mercury_guard.dashboard_bindings USING btree (site_id);

CREATE INDEX dashboard_outbox_mapping_idx ON mercury_guard.dashboard_outbox USING btree (assignment_id, guard_id, vendor_id, site_id, mapping_revision);

CREATE INDEX dashboard_outbox_pending_idx ON mercury_guard.dashboard_outbox USING btree (next_at, id)
  WHERE (status = 'pending'::text);

REVOKE ALL ON mercury_guard.dashboard_bindings,mercury_guard.dashboard_mapping_history,mercury_guard.dashboard_outbox,mercury_guard.dashboard_bridge_state FROM PUBLIC,anon,authenticated,service_role;

GRANT UPDATE ("active") ON TABLE "mercury_guard"."dashboard_bindings" TO "service_role";

GRANT UPDATE ("dashboard_shift_id") ON TABLE "mercury_guard"."dashboard_bindings" TO "service_role";

GRANT UPDATE ("destination") ON TABLE "mercury_guard"."dashboard_bindings" TO "service_role";

GRANT UPDATE ("revision") ON TABLE "mercury_guard"."dashboard_bindings" TO "service_role";

GRANT INSERT, SELECT ON TABLE "mercury_guard"."dashboard_bindings" TO "service_role";

GRANT INSERT, SELECT, UPDATE ON TABLE "mercury_guard"."dashboard_bridge_state" TO "service_role";

GRANT INSERT, SELECT ON TABLE "mercury_guard"."dashboard_mapping_history" TO "service_role";

GRANT UPDATE ("attempts") ON TABLE "mercury_guard"."dashboard_outbox" TO "service_role";

GRANT UPDATE ("lease_until") ON TABLE "mercury_guard"."dashboard_outbox" TO "service_role";

GRANT UPDATE ("lease") ON TABLE "mercury_guard"."dashboard_outbox" TO "service_role";

GRANT UPDATE ("next_at") ON TABLE "mercury_guard"."dashboard_outbox" TO "service_role";

GRANT UPDATE ("receipt") ON TABLE "mercury_guard"."dashboard_outbox" TO "service_role";

GRANT UPDATE ("status") ON TABLE "mercury_guard"."dashboard_outbox" TO "service_role";

GRANT INSERT, SELECT ON TABLE "mercury_guard"."dashboard_outbox" TO "service_role";

