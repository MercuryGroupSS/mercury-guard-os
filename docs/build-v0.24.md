# v0.24 — local authenticated backend and Android transport foundation

Completed local Supabase setup, protected authorization storage, server-side session verification and authority lookup, a loopback HTTP service, and real synthetic network round-trip verification. Includes restart/receipt replay and device revocation. The account and test database are cleaned up after testing.

37 Node unit tests pass. Real local Supabase Auth and round-trip scripts pass. Local database advisors report no issues. Android APK/instrumentation assembly, JVM tests and lint pass. New Android transport tests validate pilot receipts and reject insecure endpoints. Physical tests deferred by user; no installation performed.

Android transport accepts HTTPS only and local-pilot receipt status only. It is not connected to demo capture and cannot silently mark demo events delivered. Missing before production: real guard/assignment mapping, enrollment, signed grant issuance, original capture-scope persistence, full inbound sync, session UI/lifecycle, hosted durable ingestion, media delivery, operational dashboard projection and physical acceptance. Existing production apps remain unchanged.
