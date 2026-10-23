# v0.26 — Mercury One UI refinement

The active shift screen now leads with Escalate, followed by patrol and check-in actions. White status cards group shift timing and upcoming checks. Smaller decorative headers give controls more space on narrow screens, while the existing adaptive two-column layout remains available when unfolded. Particle sign-in is preserved.

Device readiness groups location, tracking and notifications into cards. Refresh shows a persistent timestamp and explains that checking status does not request a fix. GPS retry displays a persistent waiting message without claiming a fresh location. Completed biometric verification no longer displays a contradictory requirement.

Local preview APK/test APK assembly, unit tests and lint passed. APK signature verified against the existing preview certificate. Source commit: 2ce5ebb23bd7cb165e9f399316ae87a808c88f5c.

GitHub APK build and API 28/API 35 emulator suites all passed: https://github.com/MercuryGroupSS/mercury-guard-os/actions/runs/39959879078. Local JVM suite: 15 tests, zero failures/errors. No visual screenshot review was performed for this revision.

APK SHA-256: c3937f66b3e1d17a9abe8a60ae6a19931fe1cd11d0e4969c7d122cf7cc5d8d85. Physical Fold testing is deferred; no phone installation. This remains a local demo. No live dashboard delivery or production authorization is implied.
