# Android v0.14 — selectable patrol checkpoints

User-directed change from physical Fold6 testing: guards can select Main entrance, Perimeter or Control point in any order. Each unrecorded checkpoint has its own action. Completed entries remain marked; per-session duplicate protection and session isolation remain transactional. Progress counts distinct checkpoint indexes, preserving earlier ordered records without a migration. No physical-presence verification is implied.

Validation pending: build/lint/signature, six unit tests and forty-nine instrumented tests on each API 28/35. Updated UI test records Control point first, recreates the activity, then selects Perimeter and Main entrance, checks completion and rejects invalid/duplicate IDs. No server, hosting or existing application changes.

User-reported physical v0.13 checks: simulated shift started, incident saved and read in audit, incident remained readable after folding/reopening. Camera, GPS, notifications, battery and any-order checkpoints on hardware remain unverified.
