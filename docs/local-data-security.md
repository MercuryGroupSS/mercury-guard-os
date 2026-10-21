# Local data protection — v0.3

The app remains an offline test prototype. Device-local encryption is one layer and does not implement production authentication, backend authorization, biometrics, liveness, uniform recognition, or centralized retention.

## Stored events

The complete event timestamp, type and JSON payload are protected with AES-256-GCM under a per-install Android Keystore key. Each encryption uses a fresh provider-generated IV and purpose-bound authenticated data. SQLite keeps record IDs/counts and an encrypted-format marker visible. There is no plaintext fallback if the key or authentication check fails. Opening an existing database authenticates a stored record before accepting new writes; decryption never generates a replacement key. A compromised running app can still use its own key; this is not protection against a fully compromised operating system or an authenticated malicious app process.

Version-1 records are migrated transactionally on opening the version-2 database. Existing logical events and their order are preserved. SQLite secure deletion is enabled, but migration does not guarantee forensic removal of historic plaintext from backups, old filesystem blocks, journals or device transfers. Do not use real operational data in this test release. Row deletion/reordering is not prevented; authenticated ciphertext does not create an immutable audit history.

## Photo flow

An explicit confirmation opens the installed camera app using a temporary content-URI grant scoped to the capture cache directory. No direct camera permission is requested by Mercury. The camera writes a private temporary JPEG. On successful return during an active demo shift, image bounds/MIME/size are checked (20 MB maximum), then the photo is encrypted into the app's no-backup directory. Its ID, dimensions, size and SHA-256 are recorded in the encrypted event queue. Cancellation, invalid data or an ended shift does not retain the photo. Temporary URI access is revoked and temporary capture output is removed after processing. The image hash is evidence metadata, not proof of location, uniform compliance, liveness or identity.

A camera app may keep its own copies or metadata. Plaintext exists temporarily during capture and in app memory during encryption. Interrupted captures and orphaned encrypted files need a production recovery/retention policy; this prototype does not implement centralized evidence upload or review. Production should use a controlled in-app camera pipeline, a reviewed lifecycle and streaming encryption for large media.

## Export and backup

Audit export requires an explicit confirmation and a user-selected share destination. It creates a decrypted JSON file using a scoped FileProvider URI instead of a large intent text payload. Photos are not exported. Old export files are removed after one hour when the app resumes, or before the next export. They can persist longer while the app is stopped. Chosen destinations can retain their own copies. Retained photos are under noBackupFilesDir and Android backup is disabled for the app. Loss of the installation or Keystore key can make encrypted records unrecoverable; enterprise key recovery has not been implemented.

## Verification boundaries

Automated device tests cover encrypted round-trip, independent IVs, ciphertext tampering, purpose mismatch, logical legacy migration, encrypted JPEG retention, malformed-image rejection, camera-consent cancellation and draft recreation. Physical Fold6 camera behavior, secure hardware backing, background behavior and end-to-end retained-media review still require validation.

## Sources

- [Android cryptography](https://developer.android.com/privacy-and-security/cryptography)
- [Android FileProvider](https://developer.android.com/reference/androidx/core/content/FileProvider)
- [Camera intent workflow](https://developer.android.com/media/camera/camera-deprecated/photobasics)


## v0.5 offline outbox

Schema v3 assigns stable UUIDs inside encrypted payloads, including migrated records. Durable outbox contents use the same Android Keystore key with a distinct purpose string. Row order, delivery flags and record counts remain visible; sequence values are local database row IDs, not a cross-device identity. Migration is transactional and preserves logical events. The server-authentication and device-signature layers are not implemented. Receipt membership checks protect local queue consistency only; a future authenticated transport must validate receipts before calling acknowledgement. No production UI or network caller can mark records delivered in this build. Accepted test records remain in the audit history.


## v0.6 durable incident drafts

A single device-local draft is encrypted in the database using a distinct purpose string under the existing Keystore key. Saved draft text is excluded from audit export/outbox and Activity saved-instance state. The editor disables automatic hierarchy state saving. Submission inserts the audit event and clears the draft transactionally; a failed insert preserves it. Corrupt/unreadable draft storage blocks opening and is not automatically replaced. Drafts persist across demo shifts until submitted, cleared or explicitly discarded, so this prototype does not provide guard identity separation. Use synthetic data only. Autosave errors are shown; unsaved keystrokes cannot be guaranteed after forced process termination. Screen/keyboard/app-memory exposure, manual retention and key-loss recovery remain production concerns.
