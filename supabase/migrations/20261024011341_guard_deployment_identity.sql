-- Private owner-installed deployment binding. Runtime inserts no marker.
CREATE TABLE "mercury_guard"."deployment_identity" (
  "singleton"          boolean                  NOT NULL DEFAULT true,
  "deployment_id"      uuid                     NOT NULL,
  "auth_origin"        text                     NOT NULL,
  "public_origin"      text                     NOT NULL,
  "issuer"             text                     NOT NULL,
  "audience"           text                     NOT NULL,
  "issuer_key_id"      text                     NOT NULL,
  "issuer_spki_sha256" text                     NOT NULL,
  "approved_at"        timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  "approved_by"        text                     NOT NULL,
  "reason"             text                     NOT NULL,
  CONSTRAINT "deployment_identity_approved_by_check" CHECK (((length(btrim(approved_by)) >= 1) AND (length(btrim(approved_by)) <= 500))),
  CONSTRAINT "deployment_identity_audience_check" CHECK ((audience ~ '^[A-Za-z0-9._:/-]{1,128}$'::text)),
  CONSTRAINT "deployment_identity_auth_origin_check" CHECK (((length(auth_origin) >= 1) AND (length(auth_origin) <= 256))),
  CONSTRAINT "deployment_identity_deployment_id_key" UNIQUE (deployment_id),
  CONSTRAINT "deployment_identity_issuer_check" CHECK (((length(issuer) >= 1) AND (length(issuer) <= 256))),
  CONSTRAINT "deployment_identity_issuer_key_id_check" CHECK ((issuer_key_id ~ '^[A-Za-z0-9_-]{1,64}$'::text)),
  CONSTRAINT "deployment_identity_issuer_spki_sha256_check" CHECK ((issuer_spki_sha256 ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "deployment_identity_pkey" PRIMARY KEY (singleton),
  CONSTRAINT "deployment_identity_public_origin_check" CHECK (((length(public_origin) >= 1) AND (length(public_origin) <= 256))),
  CONSTRAINT "deployment_identity_reason_check" CHECK (((length(btrim(reason)) >= 1) AND (length(btrim(reason)) <= 500))),
  CONSTRAINT "deployment_identity_singleton_check" CHECK (singleton)
);

ALTER TABLE "mercury_guard"."deployment_identity"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "mercury_guard"."deployment_identity" FROM PUBLIC,anon,authenticated,service_role;

GRANT SELECT ON TABLE "mercury_guard"."deployment_identity" TO "service_role";

