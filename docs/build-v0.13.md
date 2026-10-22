# Android v0.13 — scoped batch signer foundation

Adds a separate version-2 signer for explicit original capture bindings: guard, site, assignment, installation fingerprint and revocation version are inside the signed payload. Signature domain and schema version match the local Node verifier. The original v1 signer/outbox remains compatible. V2 rejects a different installation, malformed/empty binding and numbers outside JavaScript safe-integer range.

This low-level signer does not establish historical attribution: a caller must already possess the original capture binding. It is deliberately not wired to the unscoped demo queue, current assignment or live uploads. Persisting authenticated scope at capture time, grant association and scope-separated batching remain necessary before transport. No sign-in, server, real enrollment, Supabase connection or cloud resource is enabled.

Validation pending: build/lint/signature, six unit tests and forty-nine instrumented tests on each Android API 28/35, plus seventeen local Node tests. New Android tests cover v2 domain verification, explicit binding, wrong installation and unsafe numbers; a synthetic ephemeral-key fixture supports independent server verification. No actual device result is claimed. User has a Fold6 ready; USB connection/setup remains to be confirmed. No reset, flashing or enrollment is required for app testing.
