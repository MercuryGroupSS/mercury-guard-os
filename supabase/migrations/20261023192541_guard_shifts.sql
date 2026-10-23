CREATE TABLE "mercury_guard"."shift_rejections" (
  "request" text  NOT NULL,
  "digest"  text  NOT NULL,
  "receipt" jsonb NOT NULL,
  CONSTRAINT "shift_rejections_digest_check" CHECK ((digest ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "shift_rejections_pkey" PRIMARY KEY (request),
  CONSTRAINT "shift_rejections_receipt_check" CHECK (((jsonb_typeof(receipt) = 'object'::text) AND (octet_length((receipt)::text) <= 16384))),
  CONSTRAINT "shift_rejections_request_check" CHECK ((request ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'::text))
);

ALTER TABLE "mercury_guard"."shift_rejections"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "mercury_guard"."shift_sessions" (
  "assignment"  text   NOT NULL,
  "guard"       text   NOT NULL,
  "vendor"      text   NOT NULL,
  "site"        text   NOT NULL,
  "device"      text   NOT NULL,
  "starts_at"   bigint NOT NULL,
  "ends_at"     bigint NOT NULL,
  "clocked_in"  bigint NOT NULL,
  "clocked_out" bigint,
  "reason"      text,
  CONSTRAINT "shift_sessions_check1" CHECK (((clocked_in >= starts_at) AND (clocked_in < ends_at))),
  CONSTRAINT "shift_sessions_check2" CHECK (((clocked_out >= clocked_in) AND (clocked_out <= (ends_at + 86400000)))),
  CONSTRAINT "shift_sessions_check3" CHECK ((((clocked_out IS NULL) AND (reason IS NULL)) OR ((clocked_out IS NOT NULL) AND (reason IS NOT NULL)))),
  CONSTRAINT "shift_sessions_check" CHECK ((((ends_at >= 1) AND (ends_at <= '9007199254740991'::bigint)) AND (ends_at > starts_at))),
  CONSTRAINT "shift_sessions_pkey" PRIMARY KEY (assignment),
  CONSTRAINT "shift_sessions_reason_check" CHECK ((length(reason) <= 2000)),
  CONSTRAINT "shift_sessions_starts_at_check" CHECK (((starts_at >= 1) AND (starts_at <= '9007199254740991'::bigint)))
);

ALTER TABLE "mercury_guard"."shift_sessions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "mercury_guard"."shift_transitions" (
  "sequence" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "request"  text   NOT NULL,
  "digest"   text   NOT NULL,
  "receipt"  jsonb  NOT NULL,
  CONSTRAINT "shift_transitions_digest_check" CHECK ((digest ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "shift_transitions_pkey" PRIMARY KEY (SEQUENCE),
  CONSTRAINT "shift_transitions_receipt_check" CHECK (((jsonb_typeof(receipt) = 'object'::text) AND (octet_length((receipt)::text) <= 16384))),
  CONSTRAINT "shift_transitions_request_check" CHECK ((request ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'::text)),
  CONSTRAINT "shift_transitions_request_key" UNIQUE (request)
);

ALTER TABLE "mercury_guard"."shift_transitions"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "mercury_guard"."shift_sessions"
  ADD CONSTRAINT "shift_sessions_assignment_fkey" FOREIGN KEY (assignment) REFERENCES mercury_guard.assignments(assignment_id);

ALTER TABLE "mercury_guard"."shift_sessions"
  ADD CONSTRAINT "shift_sessions_device_fkey" FOREIGN KEY (device) REFERENCES mercury_guard.devices(thumbprint);

ALTER TABLE "mercury_guard"."shift_sessions"
  ADD CONSTRAINT "shift_sessions_guard_vendor_fkey" FOREIGN KEY (guard, vendor) REFERENCES mercury_guard.guards(guard_id, vendor_id);

ALTER TABLE "mercury_guard"."shift_sessions"
  ADD CONSTRAINT "shift_sessions_site_fkey" FOREIGN KEY (site) REFERENCES mercury_guard.sites(site_id);

CREATE UNIQUE INDEX one_active_guard ON mercury_guard.shift_sessions USING btree (guard)
  WHERE (clocked_out IS NULL);

CREATE UNIQUE INDEX one_active_phone ON mercury_guard.shift_sessions USING btree (device)
  WHERE (clocked_out IS NULL);

CREATE INDEX shift_sessions_device_idx ON mercury_guard.shift_sessions USING btree (device);

CREATE INDEX shift_sessions_guard_vendor_idx ON mercury_guard.shift_sessions USING btree (guard, vendor);

CREATE INDEX shift_sessions_site_idx ON mercury_guard.shift_sessions USING btree (site);

REVOKE ALL ON mercury_guard.shift_sessions,mercury_guard.shift_transitions,mercury_guard.shift_rejections FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE mercury_guard.shift_transitions_sequence_seq FROM PUBLIC,anon,authenticated,service_role;

GRANT USAGE ON SEQUENCE "mercury_guard"."shift_transitions_sequence_seq" TO "service_role";

GRANT INSERT, SELECT ON TABLE "mercury_guard"."shift_rejections" TO "service_role";

GRANT UPDATE ("clocked_out") ON TABLE "mercury_guard"."shift_sessions" TO "service_role";

GRANT UPDATE ("reason") ON TABLE "mercury_guard"."shift_sessions" TO "service_role";

GRANT INSERT, SELECT ON TABLE "mercury_guard"."shift_sessions" TO "service_role";

GRANT INSERT, SELECT ON TABLE "mercury_guard"."shift_transitions" TO "service_role";

