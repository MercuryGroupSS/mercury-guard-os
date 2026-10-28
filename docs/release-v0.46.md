# Mercury One v0.46 verification scope

This candidate preserves original private record ownership through account changes and closes ordinary-operation Auth-session checks. It also improves keyboard focus and guard account setup instructions.

- Ordinary uploads are selected and rechecked against the current account, configuration and device. Every request body, photo chunk and finalization rechecks authority and the immutable original owner; GPS writes recheck withdrawal.
- Patrol progress belongs to the original complete account/device/site/assignment/revocation owner.
- Same-principal evidence retries keep their original IDs, grants and scope, including historical assignments absent from the current feed. Ownerless and mismatched rows remain retained.
- PostgreSQL assignments, ordinary grants, attendance, ingestion and photo commits recheck the exact current verified session within the same transaction. Current site/roster authority also applies to personal-device assignment listing. Auth checks are read-only; they do not serialize a provider-side deletion after the last read.
- Account completion leads to Android guard sign-in; administrator access remains separately approved. Report close restores exact-card keyboard focus and clears private image references.

The backend's 303 tests, canonical PostgreSQL session/authority rollback checks, finite capacity and actual logical recovery drills passed locally. The native gate passed 64 JVM tests, Android test compilation and lint with zero errors. Real provider-free Chrome and two Netlify bundle checks passed. CI executes both browser suites plus the Android API 28/35 and HTTPS gates. Execution of the 20 new Android regressions, exact-source CI, configured APK signature/configuration inspection and physical results must be recorded independently.

Use a distinct labelled pilot identity for live-source schedule tests. The source schedule is read-only; test attendance and observations remain isolated in Guard. Never infer an authenticated guard from a display name, company vendor ID or device biometric. Real sensor interaction, actual GNSS, camera return, fold transitions and full-shift endurance remain physical acceptance steps. No firmware, device-owner enrollment, operational payroll or existing application change is included.
