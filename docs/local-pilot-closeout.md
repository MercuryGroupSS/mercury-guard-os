# Mercury One v0.23 — local pilot closeout

## Build scope

This release completes the combined local demonstration build for physical acceptance testing. It is an Android app, not a flashed operating system. The original Mercury Guard test app remains separate from Mercury One Preview.

| Area | Implemented locally | Acceptance remaining |
| --- | --- | --- |
| Mercury One interface | White responsive UI, reference particle face, native biometric entry | Cover/inner display, readability, biometric cancel/success |
| Assignment and shifts | Explicit synthetic assignment, readiness gates, scheduled clock-out, confirmed early exit with reason | Physical sign-in and end-of-shift behavior |
| Patrol | Select any checkpoint, request fresh GPS, reject duplicates and failed fixes | Out-of-order selection with an actual fresh fix |
| Incidents and photos | Encrypted draft/records/photos, capture bound to original active shift | Save, cancel, fold/reopen, camera return |
| Check-ins | Biometric, GPS and consented photo requirements; saved prompt validation | Actual permission, GPS and camera sequence |
| Duty alerts | Timed stages, persisted misses/reasons, bounded calm alerts | Notification delivery, silence, background behavior on Fold |
| Readiness | Visible refresh feedback and GPS re-registration retry | Clear feedback and fresh location when signal is available |
| Sync foundation | Signed batches, scoped verification and incoming-cache tests | No live transport or production data exchange is enabled |

## v0.23 integrity changes

Photo audit records, check-in photo linking and check-in completion share a database transaction. A database failure rolls them back; the caller removes the retained encrypted file on failure. A photo result from an ended or changed shift is discarded. Cancelled camera captures remove temporary files and URI grants. File storage and SQLite cannot form a single power-loss transaction: a process crash after file retention can still leave an unreferenced encrypted file; recovery/retention remains a production requirement.

Completion checks the saved prompt identity, kind, due time, timing window and evidence before recording success. Event-cache invalidation handles reused SQLite row IDs after a rollback. New regression cases cover successful photo linking, late transaction failure/retry, unrelated photos, forged/expired prompts and rollback cache reuse.

## Physical acceptance sequence

Use only **Mercury One Preview**. Test with harmless synthetic descriptions/photos. No emergency message is sent.

1. Check the white sign-in and particle face on both screens. Fold/unfold and reopen; ensure controls remain usable.
2. Open Prototype tools (⋯), review Device readiness, allow ordinary location/notification permission if desired. Refresh must give visible feedback. Permission alone is not a fresh location fix.
3. Create and confirm a demo assignment. Cancel biometric once: the shift must stay inactive. Retry with an already enrolled secure Android biometric. Confirm Active Shift.
4. Save a synthetic incident. Reopen it after folding. Cancel a photo once, then accept a harmless photo. Confirm audit entries and no false success for cancellation.
5. On patrol choose a checkpoint other than the first. A fresh fix should record just that point. A timeout should leave it unselected. Retapping a completed point must not duplicate it. Repeat for the remaining points in any order.
6. Use GPS retry and readiness refresh. Confirm feedback, inspect fix age/accuracy separately and repeat near a window/outside if signal is poor. No location success is assumed from a permission grant.
7. Exercise a check-in: cancel biometric once, then complete biometric, fresh GPS and consented photo. Check the completion record. Verify missing evidence never reports completion.
8. During an ordinary notification test, check delivery, open the alert, silence it and confirm silence does not complete the duty. A timed overdue test must persist a miss and keep the miss when a reason is added. OS background restrictions remain a limitation.
9. Use Escalate for a harmless schematic issue pin and a reasoned early exit. Cancel exit once, then confirm. Verify tracking reports stopped. Keep scheduled clock-out as a separate long-duration acceptance test.

Record observed, failed, blocked and not-tested results separately. Do not call an emulator pass a hardware pass. Do not grant full-screen notification special access, reset/flash/enroll the phone or change its enrolled biometrics for this test. The Preview manifest omits full-screen notification access.

## Production and dedicated-device gates

Still required: authoritative guard identity and assignment integration; authenticated enrollment, durable scoped sync and server receipts; approved adapters into existing apps/data; real site geometry; production signing/distribution; retention/revocation/recovery policy; background reliability and battery validation. No new hosted Supabase project or charge is introduced.

Dedicated-device/kiosk enrollment and flashable OS feasibility are separate follow-on work after APK acceptance. No bootloader unlocking, flashing or device-owner enrollment is part of this release.
