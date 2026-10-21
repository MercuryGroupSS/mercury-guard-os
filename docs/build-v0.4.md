# Mercury Guard OS v0.4 — ordered demo patrol

Adds a three-checkpoint manual demo route: main entrance, perimeter, control point. Encrypted events are the source of progress; progress survives Activity recreation and reopening within the same demo shift. A new shift has its own route. A database transaction rejects duplicate or out-of-order checkpoint submissions. The UI explicitly states this does not verify physical presence, QR or NFC.

No network sync is enabled. The staging integration contract remains a proposal; production identity, grants, backend and dispatch are pending. No existing applications or other repositories are changed. The futuristic white Jarvis design remains deferred.

Validation passed: six unit tests and ten instrumented tests on each of API 28 and API 35; build, lint and APK signature verification passed. Source commit `f03fe77ff53945b1f235f10c261bafba755a6d1a`, [run 39533980264](https://github.com/MercuryGroupSS/mercury-guard-os/actions/runs/39533980264). APK SHA-256: `5ab52a0eafdae249269b014604433d0255bda77eaee96bcb1ad6a3b3ea6593ce`. Physical Galaxy Z Fold6 testing remains pending.
