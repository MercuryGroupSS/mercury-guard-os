# Mercury One v0.28 preview candidate

This preview consolidates the authorized account, evidence, messaging and shift work completed since v0.27. It uses the separate ca.mercury.guard.preview package and existing local preview signing identity. It has not been installed on the Fold.

Included:
- Individual guard identity linked to a company or individual vendor; enrolled-device assignments and short-lived signed capture grants.
- Encrypted per-guard queues, any-order assigned patrols, incident and photo capture, separate evidence receipts, scheduled check-ins and reminders.
- Encrypted assignment message inbox with versions/retractions and explicit signed acknowledgements.
- Confirmed clock-in, scheduled clock-out, reasoned early exit, durable request retries and server-enforced capture boundaries.
- Local service deadline reconciliation and approved-mapping dashboard queues for observations and attendance.

The default APK is unconfigured: its account flow requires an administrator-provisioned HTTPS endpoint, trusted issuer keys, device enrollment and synthetic guard/assignment setup. The included local service uses synthetic data. No production credentials or private signing keys are included. Existing applications and hosted projects have not been changed.

Verified baseline: source 320b010 passed Android API 28/API 35, HTTPS integration and APK checks in run 39998375078. The real local Supabase smoke test passed confirmed shift/restart/early-exit/ingestion/revocation and removed its synthetic account. Subsequent phone screens and shift-aware reconciliation require their own CI results; earlier green checks do not prove those changes. Local server suite currently has 104 passing tests.

Outstanding before operational use: live roster/assignment provisioning, HTTPS deployment and issuer distribution, approved dashboard receiver/mappings and media delivery, dispatch escalation, account recovery/background transport, production storage/retention, management policy, final UI acceptance and physical Fold testing. The preview is not a flashable OS or a finished production release. Scheduled clock-out requires confirmation; merely reaching the end time does not generate attendance. Partial check-in windows do not generate automatic missed-delivery penalties.
