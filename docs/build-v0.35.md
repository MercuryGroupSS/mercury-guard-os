# Mercury One Preview v0.35

This build corrects missed clock-out handling without inventing attendance. An old shift that remains unclosed stops reserving its guard or shared phone at its scheduled end. A later approved assignment can then start. The old attendance row and original transition receipts remain unchanged; only an explicit accepted clock-out closes that row. The existing 24-hour late-clock-out limit remains in force. A live shift still blocks a conflicting guard/device start, including simultaneous requests.

The account screen uses its trusted server-time anchor to distinguish an elapsed capture window from confirmed clock-out. It does not offer capture after that window ends or silently stop attendance at the scheduled end. It retains the explicit confirmation/cancellation flow. An unresolved old clock-out request cannot hide a different assignment's server-approved clock-in.

Closing old assignment A now stops only A's matching connected location collector and encrypted reminders. Current assignment B retains its resources. Signing out or changing the individual guard stops all connected reminders, collection and automatic upload authority while preserving original records. Prototype reminders remain separate.

The backend migration replaces the old forever-open unique reservation indexes with unclosed-window lookup indexes. PostgreSQL's existing serialized shift transaction and SQLite's immediate transaction preserve current-window concurrency checks. Canonical replay and an actual old-index upgrade verify unchanged history/receipts, exact scheduled-end boundaries, next-day/shared-phone use, concurrent conflicts and explicit old-shift closeout. All 237 Node tests pass, including the controlled-build input and signing/update gates.

## Verification and package

The immutable package record binds the final APK, tracked source archive, signer, local checks and exact-source GitHub jobs. v0.35 remains a debug-signed, unconfigured Preview. No phone installation, live deployment or current physical acceptance follows from emulator or CI results. Earlier immutable builds remain preserved.

Both uncached default and Preview APK/test-APK builds execute all 75 tasks and pass 42 JVM tests. Lint reports zero errors, 180 warnings and one informational item. The ordinary fresh-install API 35 suite discovers 147 cases: 138 pass, nine explicitly opted-in or fixture-dependent cases are skipped, and none fail. All six new presentation/resource regressions pass. The targeted suite separately discovers 17 cases: 16 pass, one explicit biometric opt-in is skipped and none fail. Existing tests retain the explicit requirement that scheduled end does not automatically clock out. These scope/presentation regressions do not establish actual GNSS or physical biometric delivery. Backend and package validation results belong in the final BUILD-RECORD.json; the configured signing controller has separate synthetic release-build evidence and does not turn this Preview into a configured production APK.

## Operational acceptance

Use the [v0.35 attended checklist](fold-acceptance-v0.35.md) when physical testing resumes. Its new missed-clock-out scenario requires approved synthetic assignments and checks both retained history and the next shift's resources. Current physical results remain OPEN.

The approved HTTPS origin, real owner/guard/device enrollment, email transport and actual Ops source/destination bindings remain activation inputs. The [configured service](configured-service.md) and controlled APK tooling prepare those paths without selecting production identities, generating production signing keys, enabling delivery, or creating hosted services. Production database TLS/public trust, signing/update recovery, backups/retention, capacity/security and full-shift hardware acceptance remain required. Existing applications, hosted projects and phone data are unchanged.
