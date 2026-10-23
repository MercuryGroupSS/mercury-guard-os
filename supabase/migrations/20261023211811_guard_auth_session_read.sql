-- Auth owns this table. Grant only the columns needed for server-side checks.
-- These cross-schema column grants are not emitted by the mercury_guard diff.
GRANT USAGE ON SCHEMA auth TO service_role;
GRANT SELECT(id,user_id,not_after) ON auth.sessions TO service_role;
