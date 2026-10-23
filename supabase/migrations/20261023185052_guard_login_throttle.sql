SET local check_function_bodies = off;

CREATE TABLE "mercury_guard"."login_attempts" (
  "bucket"     text                     NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "attempts"   integer                  NOT NULL,
  CONSTRAINT "login_attempts_attempts_check" CHECK ((attempts >= 0)),
  CONSTRAINT "login_attempts_bucket_check" CHECK (((bucket = 'global'::text) OR (bucket ~ '^account:[a-f0-9]{64}$'::text))),
  CONSTRAINT "login_attempts_pkey" PRIMARY KEY (bucket)
);

ALTER TABLE "mercury_guard"."login_attempts"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION mercury_guard.consume_login_attempt (
  account_hash text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE at_time timestamptz; global_row mercury_guard.login_attempts; account_row mercury_guard.login_attempts;
BEGIN
 IF account_hash IS NULL OR account_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid login bucket'; END IF;
 INSERT INTO mercury_guard.login_attempts VALUES('global',clock_timestamp(),0) ON CONFLICT DO NOTHING;
 SELECT * INTO global_row FROM mercury_guard.login_attempts WHERE bucket='global' FOR UPDATE;
 at_time := clock_timestamp();
 DELETE FROM mercury_guard.login_attempts WHERE bucket<>'global' AND started_at<=at_time-interval '5 minutes';
 IF global_row.started_at<=at_time-interval '1 minute' THEN
  UPDATE mercury_guard.login_attempts SET started_at=at_time,attempts=0 WHERE bucket='global';
  global_row.attempts:=0;
 END IF;
 IF global_row.attempts>=100 THEN RETURN false; END IF;
 UPDATE mercury_guard.login_attempts SET attempts=attempts+1 WHERE bucket='global';
 INSERT INTO mercury_guard.login_attempts VALUES('account:'||account_hash,at_time,0) ON CONFLICT DO NOTHING;
 SELECT * INTO account_row FROM mercury_guard.login_attempts WHERE bucket='account:'||account_hash FOR UPDATE;
 IF account_row.attempts>=5 THEN RETURN false; END IF;
 UPDATE mercury_guard.login_attempts SET attempts=attempts+1 WHERE bucket='account:'||account_hash;
 RETURN true;
END $function$;

CREATE INDEX login_attempts_started_idx ON mercury_guard.login_attempts USING btree (started_at);

REVOKE ALL ON FUNCTION "mercury_guard"."consume_login_attempt"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "mercury_guard"."consume_login_attempt"(text) TO "service_role";

REVOKE ALL ON mercury_guard.login_attempts FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION mercury_guard.consume_login_attempt(text) FROM anon, authenticated;

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "mercury_guard"."login_attempts" TO "service_role";

