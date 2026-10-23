-- Read only the three Auth session columns needed for immediate server-side
-- revocation checks. No browser role, refresh credential or mutation grant.
GRANT USAGE ON SCHEMA auth TO service_role;
GRANT SELECT(id,user_id,not_after) ON auth.sessions TO service_role;
