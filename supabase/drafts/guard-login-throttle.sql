BEGIN;
CREATE TABLE mercury_guard.login_attempts (
 bucket text PRIMARY KEY CHECK (bucket='global' OR bucket ~ '^account:[a-f0-9]{64}$'),
 started_at timestamptz NOT NULL,
 attempts integer NOT NULL CHECK (attempts >= 0)
);
CREATE INDEX login_attempts_started_idx ON mercury_guard.login_attempts(started_at);
ALTER TABLE mercury_guard.login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mercury_guard.login_attempts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON mercury_guard.login_attempts TO service_role;
CREATE FUNCTION mercury_guard.consume_login_attempt(account_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
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
END $$;
REVOKE ALL ON FUNCTION mercury_guard.consume_login_attempt(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION mercury_guard.consume_login_attempt(text) TO service_role;
COMMIT;
