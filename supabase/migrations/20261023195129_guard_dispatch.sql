CREATE TABLE "mercury_guard"."dispatch_changes" (
  "sequence"      bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "scope"         text   NOT NULL,
  "id"            text   NOT NULL,
  "version"       bigint NOT NULL,
  "body"          text   NOT NULL,
  "guard_id"      text   NOT NULL,
  "vendor_id"     text   NOT NULL,
  "site_id"       text   NOT NULL,
  "assignment_id" text   NOT NULL,
  CONSTRAINT "dispatch_changes_body_check" CHECK ((octet_length(body) <= 65536)),
  CONSTRAINT "dispatch_changes_id_check" CHECK ((id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'::text)),
  CONSTRAINT "dispatch_changes_pkey" PRIMARY KEY (SEQUENCE),
  CONSTRAINT "dispatch_changes_scope_check" CHECK ((scope ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "dispatch_changes_scope_id_version_key" UNIQUE (scope, id, VERSION),
  CONSTRAINT "dispatch_changes_version_check" CHECK (((version >= 1) AND (version <= '9007199254740991'::bigint)))
);

ALTER TABLE "mercury_guard"."dispatch_changes"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "mercury_guard"."dispatch_cursors" (
  "token"    uuid   NOT NULL,
  "scope"    text   NOT NULL,
  "sequence" bigint NOT NULL,
  "expires"  bigint NOT NULL,
  CONSTRAINT "dispatch_cursors_expires_check" CHECK (((expires >= 1) AND (expires <= '9007199254740991'::bigint))),
  CONSTRAINT "dispatch_cursors_pkey" PRIMARY KEY (token),
  CONSTRAINT "dispatch_cursors_scope_check" CHECK ((scope ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "dispatch_cursors_scope_sequence_key" UNIQUE (scope, SEQUENCE),
  CONSTRAINT "dispatch_cursors_sequence_check" CHECK (((sequence >= 0) AND (sequence <= '9007199254740991'::bigint)))
);

ALTER TABLE "mercury_guard"."dispatch_cursors"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "mercury_guard"."dispatch_changes"
  ADD CONSTRAINT "dispatch_changes_assignment_id_fkey" FOREIGN KEY (assignment_id) REFERENCES mercury_guard.assignments(assignment_id);

ALTER TABLE "mercury_guard"."dispatch_changes"
  ADD CONSTRAINT "dispatch_changes_guard_id_vendor_id_fkey" FOREIGN KEY (guard_id, vendor_id) REFERENCES mercury_guard.guards(guard_id, vendor_id);

ALTER TABLE "mercury_guard"."dispatch_changes"
  ADD CONSTRAINT "dispatch_changes_site_id_fkey" FOREIGN KEY (site_id) REFERENCES mercury_guard.sites(site_id);

CREATE INDEX dispatch_assignment_idx ON mercury_guard.dispatch_changes USING btree (assignment_id);

CREATE INDEX dispatch_cursors_expiry_idx ON mercury_guard.dispatch_cursors USING btree (expires);

CREATE INDEX dispatch_guard_vendor_idx ON mercury_guard.dispatch_changes USING btree (guard_id, vendor_id);

CREATE INDEX dispatch_latest ON mercury_guard.dispatch_changes USING btree (scope, id, SEQUENCE DESC);

CREATE INDEX dispatch_site_idx ON mercury_guard.dispatch_changes USING btree (site_id);

REVOKE ALL ON mercury_guard.dispatch_changes,mercury_guard.dispatch_cursors FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE mercury_guard.dispatch_changes_sequence_seq FROM PUBLIC,anon,authenticated,service_role;

GRANT USAGE ON SEQUENCE "mercury_guard"."dispatch_changes_sequence_seq" TO "service_role";

GRANT INSERT, SELECT ON TABLE "mercury_guard"."dispatch_changes" TO "service_role";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "mercury_guard"."dispatch_cursors" TO "service_role";

