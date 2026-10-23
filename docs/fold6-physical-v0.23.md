# Mercury One v0.23 — Fold6 physical test results

22 October 2026, America/Toronto. Samsung Galaxy Z Fold6 SM-F956W, Android 15. Preview package ca.mercury.guard.preview 0.23.0 (23); original Mercury Guard 0.13.0 remained installed. Tests used local synthetic assignments/notes. The owner supplied native fingerprints and physically folded the handset; the assistant operated the remaining tested controls.

## Result

Core exercised workflows passed. The final state is no active shift, GPS tracking stopped, no running Preview service and no Preview notifications. This is acceptance evidence for the local pilot, not a production or all-conditions reliability certification.

| Test | Observed result |
| --- | --- |
| Install and launch | Updated Preview successfully without uninstalling; cold launch succeeded. Original app/version preserved. |
| Incident draft and save | Cancel preserved the synthetic draft. Submission appeared in the audit and remained present after activity reopen and folding. |
| Sign-in | Native fingerprint cancellation left the shift inactive; owner fingerprint started the demo shift. |
| Patrol order and duplicates | Control point, Perimeter, Main entrance recorded in that order. Audit indices exactly [2,1,0]; repeated selection did not duplicate a record. Actual GPS observations were marked non-mock. |
| Check-in cancellation | Cancelling biometric or silencing the alert did not complete it. Cancelling the native camera left site photo required. |
| Check-in completion | Owner biometric, GPS and accepted photo produced photo evidence, linked duty photo and completion records. Photo ID/hash/session match and retained encrypted file existence were checked. |
| GPS retry and refresh | Service fix age initially exceeded 17 minutes. Retry plus refresh showed a 36-second-old observation. Refresh redraw worked; short-toast visibility was not separately captured. |
| Folding and responsive layout | Inner portrait and landscape layouts were observed. Owner folded the phone; cover screen resumed Active Shift and retained 3/3 patrol completion. Cover-screen navigation, audit, reason entry and early exit worked. |
| Timed readiness | Actual automatic 15-minute prompt appeared. Green, yellow and red stages were observed. After app backgrounding, a missed readiness record was saved at due time plus 600,000 ms. |
| Miss reason | Empty reason did not submit. A synthetic reason was recorded against the oldest unresolved demo miss; the original miss remained. This was an older miss, separately from the newly observed timed miss. |
| Demo issue pin | Selecting Perimeter updated the pin; audit confirms schematic coordinates and patrol-point source. No real map registration or physical presence is implied. |
| Notifications | Android contained the active-shift and missed-check notifications. The missed notification was private, silent/low importance and had no fullscreen intent. Audible vibration/sound and lock-screen delivery were not certified. |
| Early exit | Empty reason stayed in the entry dialog. A reason opened a second confirmation. Keep Working preserved the shift; End Shift Now created the local early-end record and returned to sign-in. |
| Tracking stop | Readiness reported stopped/no active demo shift. Android reported no Preview services and no Preview notifications. |
| Audit export | Local export was generated and inspected through the app-owned test file. The share chooser was cancelled without sending anything. Relationships were validated in memory; the temporary plaintext export was removed. |

## Limits and follow-up

Not physically completed: full eight-hour scheduled clock-out, prolonged battery/doze/reboot behavior, forced GPS loss/permission revocation, audible alert confirmation, and a second unfold-back cycle. Automated tests cover additional failure paths but are not substitutes for these hardware observations. Full-screen special access is omitted from Preview and was not enabled.

Two clarity improvements remain: check-in copy still says biometric verification is required above its already-verified status; readiness can initially display its previous observation until Refresh is tapped after the asynchronous retry. Neither produced a false completion in the tested flow. The miss-reason dialog selects the oldest unresolved miss across demo history; a future UI should identify the selected session clearly.

The original pulsing-color preference was restored after the steady-color toggle test. No enrolled biometric, phone security setting, hosted resource, existing app/database, device enrollment or firmware was changed. Live authoritative identity, schedules and two-way existing-app transport remain disconnected.

Selected UI and validation evidence is retained in the private local project deliverables; camera content and real coordinates are not published.
