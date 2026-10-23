BEGIN;
DO $$
DECLARE a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
BEGIN
 IF has_schema_privilege('anon','mercury_guard','USAGE') OR has_schema_privilege('authenticated','mercury_guard','USAGE') THEN RAISE EXCEPTION 'Client schema access'; END IF;
 IF has_table_privilege('anon','mercury_guard.guards','SELECT') OR has_table_privilege('authenticated','mercury_guard.guards','SELECT') OR has_table_privilege('service_role','mercury_guard.guards','DELETE') THEN RAISE EXCEPTION 'Unexpected table privilege'; END IF;
 IF NOT has_table_privilege('service_role','mercury_guard.guards','SELECT,INSERT,UPDATE') THEN RAISE EXCEPTION 'Missing server grants'; END IF;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='mercury_guard' AND c.relkind='r' AND c.relname IN ('vendors','guards','guard_login') AND c.relrowsecurity) <> 3 THEN RAISE EXCEPTION 'RLS missing'; END IF;
 INSERT INTO auth.users(id,email) VALUES(a,a||'@example.invalid'),(b,b||'@example.invalid');
 INSERT INTO mercury_guard.vendors(vendor_id,kind,active) VALUES('synthetic-company','company',true);
 INSERT INTO mercury_guard.guards(guard_id,auth_subject,vendor_id,active) VALUES('synthetic-a',a,'synthetic-company',true),('synthetic-b',b,'synthetic-company',false);
 INSERT INTO mercury_guard.guard_login VALUES('synthetic-a','synthetic-a@example.invalid');
 BEGIN INSERT INTO mercury_guard.guards VALUES('duplicate-subject',a,'synthetic-company',true,now()); RAISE EXCEPTION 'Duplicate Auth subject accepted'; EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN INSERT INTO mercury_guard.guards VALUES('unknown-vendor',gen_random_uuid(),'missing',true,now()); RAISE EXCEPTION 'Missing references accepted'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN INSERT INTO mercury_guard.guard_login VALUES('synthetic-b','synthetic-a@example.invalid'); RAISE EXCEPTION 'Duplicate login accepted'; EXCEPTION WHEN unique_violation THEN NULL; END;
 UPDATE mercury_guard.vendors SET active=false WHERE vendor_id='synthetic-company';
 IF EXISTS(SELECT 1 FROM mercury_guard.guards g JOIN mercury_guard.vendors v USING(vendor_id) WHERE g.active AND v.active) THEN RAISE EXCEPTION 'Suspended vendor eligible'; END IF;
 UPDATE mercury_guard.vendors SET active=true WHERE vendor_id='synthetic-company';
 IF (SELECT active FROM mercury_guard.guards WHERE guard_id='synthetic-b') THEN RAISE EXCEPTION 'Disabled guard reactivated'; END IF;
 BEGIN DELETE FROM auth.users WHERE id=a; RAISE EXCEPTION 'Referenced Auth identity deleted'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;
ROLLBACK;
SELECT 'identity schema checks passed; fixtures rolled back' AS result;
