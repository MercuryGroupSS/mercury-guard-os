BEGIN;
DO $$
DECLARE subject uuid := gen_random_uuid();
BEGIN
 INSERT INTO auth.users(id,email) VALUES(subject,subject||'@example.invalid');
 INSERT INTO mercury_guard.vendors(vendor_id,kind,active) VALUES('device-test-vendor','company',true),('other-device-vendor','individual',true);
 INSERT INTO mercury_guard.guards(guard_id,auth_subject,vendor_id,active) VALUES('device-test-guard',subject,'device-test-vendor',true);
 INSERT INTO mercury_guard.sites VALUES('device-test-site',true);
 INSERT INTO mercury_guard.devices(device_id,mode,site_id,thumbprint,public_key_spki,active) VALUES('device-test-phone','site','device-test-site',repeat('a',64),'cHVibGlj',true);
 INSERT INTO mercury_guard.assignments(assignment_id,guard_id,vendor_id,site_id,starts_at_ms,ends_at_ms,active) VALUES('device-test-shift','device-test-guard','device-test-vendor','device-test-site',1000,2000,true);
 BEGIN INSERT INTO mercury_guard.assignments(assignment_id,guard_id,vendor_id,site_id,starts_at_ms,ends_at_ms) VALUES('mismatch','device-test-guard','other-device-vendor','device-test-site',1000,2000); RAISE EXCEPTION 'Guard/vendor mismatch accepted'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN INSERT INTO mercury_guard.devices(device_id,mode,site_id,guard_id,thumbprint,public_key_spki) VALUES('ambiguous','site','device-test-site','device-test-guard',repeat('b',64),'cHVibGlj'); RAISE EXCEPTION 'Ambiguous device accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
 INSERT INTO mercury_guard.device_challenges VALUES(gen_random_uuid(),subject,'device-test-phone',repeat('a',43),2000);
 BEGIN INSERT INTO mercury_guard.device_challenges VALUES(gen_random_uuid(),subject,'device-test-phone',repeat('b',43),2000); RAISE EXCEPTION 'Duplicate active challenge accepted'; EXCEPTION WHEN unique_violation THEN NULL; END;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='mercury_guard' AND c.relkind='r' AND NOT c.relrowsecurity) THEN RAISE EXCEPTION 'RLS missing'; END IF;
END $$;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN UPDATE mercury_guard.assignments SET ends_at_ms=3000 WHERE assignment_id='device-test-shift'; RAISE EXCEPTION 'Schedule rewrite permitted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE mercury_guard.devices SET public_key_spki='changed' WHERE device_id='device-test-phone'; RAISE EXCEPTION 'Key rewrite permitted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 UPDATE mercury_guard.assignments SET active=false WHERE assignment_id='device-test-shift';
 UPDATE mercury_guard.devices SET revoked=true,revocation_version=2 WHERE device_id='device-test-phone';
 DELETE FROM mercury_guard.device_challenges WHERE device_id='device-test-phone';
 IF EXISTS(SELECT 1 FROM mercury_guard.device_challenges WHERE device_id='device-test-phone') THEN RAISE EXCEPTION 'Challenge not consumed'; END IF;
END $$;
ROLLBACK;
SELECT 'device assignment checks passed; fixtures rolled back' AS result;
