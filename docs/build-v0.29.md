# Mercury One preview 0.29

Version code 29; preview package ca.mercury.guard.preview. This remains a debug-signed test build, separate from ca.mercury.guard. Physical Fold testing is deferred.

Since the saved 0.28 preview:

- Configured builds launch the real account sign-in screen; unconfigured builds retain the demo entry. Invalid service configuration blocks sign-in.
- Configured sign-in uses Mercury One particle-face branding and offers public installation-key details for administrator enrollment.
- Confirmed shift transitions retain encrypted retry state. Definitive server rejection is preserved and permits a new explicit confirmation without reusing the rejected request.
- Damaged or unreadable shift storage blocks writes. Encoded confirmation reasons are bounded before persistence.
- Server-side work adds local provisioning, audited vendor access control and reviewed Ops vendor-link reconciliation. These server tools are source deliverables, not a hosted backend bundled into the APK.

The saved preview contains no live service configuration, credentials or issuer private keys. It is for demo/UI acceptance; production sign-in requires a separately configured build and approved server enrollment. Live Ops roster synchronization, private media delivery, production deployment and managed-device acceptance remain unfinished.

Local APK/test-APK compilation, JVM checks and lint must pass before the artifact is saved. Exact-source CI results are tracked separately from earlier green builds. Neither compilation nor emulator checks establish physical Fold acceptance.
