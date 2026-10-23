CREATE SCHEMA "mercury_guard";

CREATE TABLE "mercury_guard"."guard_login" (
  "guard_id" text NOT NULL,
  "email"    text NOT NULL,
  CONSTRAINT "guard_login_email_check" CHECK (((email = lower(email)) AND (length(email) <= 254) AND (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'::text))),
  CONSTRAINT "guard_login_email_key" UNIQUE (email),
  CONSTRAINT "guard_login_pkey" PRIMARY KEY (guard_id)
);

ALTER TABLE "mercury_guard"."guard_login"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "mercury_guard"."guards" (
  "guard_id"     text                     NOT NULL,
  "auth_subject" uuid                     NOT NULL,
  "vendor_id"    text                     NOT NULL,
  "active"       boolean                  NOT NULL DEFAULT false,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "guards_auth_subject_key" UNIQUE (auth_subject),
  CONSTRAINT "guards_guard_id_check" CHECK ((guard_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'::text)),
  CONSTRAINT "guards_pkey" PRIMARY KEY (guard_id)
);

ALTER TABLE "mercury_guard"."guards"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "mercury_guard"."vendors" (
  "vendor_id"  text                     NOT NULL,
  "kind"       text                     NOT NULL,
  "active"     boolean                  NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "vendors_kind_check" CHECK ((kind = ANY (ARRAY['company'::text, 'individual'::text]))),
  CONSTRAINT "vendors_pkey" PRIMARY KEY (vendor_id),
  CONSTRAINT "vendors_vendor_id_check" CHECK ((vendor_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'::text))
);

ALTER TABLE "mercury_guard"."vendors"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "mercury_guard"."guards"
  ADD CONSTRAINT "guards_auth_subject_fkey" FOREIGN KEY (auth_subject) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE "mercury_guard"."guard_login"
  ADD CONSTRAINT "guard_login_guard_id_fkey" FOREIGN KEY (guard_id) REFERENCES mercury_guard.guards(guard_id) ON DELETE RESTRICT;

ALTER TABLE "mercury_guard"."guards"
  ADD CONSTRAINT "guards_vendor_id_fkey" FOREIGN KEY (vendor_id) REFERENCES mercury_guard.vendors(vendor_id) ON DELETE RESTRICT;

CREATE INDEX guards_vendor_id_idx ON mercury_guard.guards USING btree (vendor_id);

COMMENT ON COLUMN "mercury_guard"."guards"."auth_subject" IS 'Individually verified Auth subject; a vendor or shared-device biometric is not guard identity.';

COMMENT ON SCHEMA "mercury_guard" IS 'Mercury One server-side identity data. Not exposed as a client roster.';

-- Explicit revokes keep the same boundary when target defaults differ.
REVOKE ALL ON SCHEMA mercury_guard FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA mercury_guard FROM PUBLIC, anon, authenticated, service_role;

GRANT USAGE ON SCHEMA "mercury_guard" TO "service_role";

GRANT INSERT, SELECT, UPDATE ON TABLE "mercury_guard"."guard_login" TO "service_role";

GRANT INSERT, SELECT, UPDATE ON TABLE "mercury_guard"."guards" TO "service_role";

GRANT INSERT, SELECT, UPDATE ON TABLE "mercury_guard"."vendors" TO "service_role";

