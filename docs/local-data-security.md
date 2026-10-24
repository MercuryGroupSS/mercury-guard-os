# Mercury One data protection and recovery

The current connected account flow is separate from the retained offline demonstration. The historical v0.3–v0.7 notes below describe the demo and must not be read as the current connected authentication or delivery contract. See the [current brief](project-brief.md) for verification and deployment status.

## Current connected account and device data

A valid packaged HTTPS/issuer configuration opens the individually authenticated flow. A local Android biometric gates the ID/password screen; it does not identify a named guard to the server or attest a biometric to it. Supabase Auth verifies the individual, while approved guard/vendor/site/device records authorize assignments. Vendor IDs alone do not identify a person.

The account Activity applies Android screenshot protection and clears its foreground session, credentials and capture authority on leaving. External camera launch clears credentials even in multi-window. This does not erase text already handled by a keyboard, camera or compromised operating system. Explicit sign-out separately stops connected location, reminders and automatic delivery and requests provider-session closure; offline provider confirmation can remain unresolved.

Connected incidents, retry snapshots, local receipts, consent records, escalation requests and photos use the installation's Keystore-backed encryption. Scoped incident drafts additionally retain the original Auth subject, guard, vendor, configuration, device, site and assignment. Draft recovery never submits an incident or transfers ownership to another account. Database indexes/counts and delivery state are not a tamper-proof audit ledger; server authorization and immutable receipts remain separate checks.

Automatic delivery uses an encrypted, boot-bound, expiring access bearer for one verified individual/configuration/device. It contains no password or refresh token. Foreground locking does not itself stop separately authorized background delivery. Explicit sign-out, guard change, expiry or invalid scope removes that authority. Android can delay work; local save, Guard metadata receipt, photo-byte receipt and receiver acknowledgement are distinct states.

An explicitly consented external camera writes temporary plaintext into private capture cache. The app validates and encrypts accepted bytes, revokes URI access and removes its temporary output; abandoned account-camera output is discarded on recreation. A camera application may retain its own copies. A hash binds bytes to a record but proves neither truth nor physical presence. The connected collector has separate visible notice/consent and a short signed lease; demo GPS is never substituted for it.

## Recovery and retention limits

Android app backup is disabled. Encrypted data under noBackupFilesDir and the installation's nonexportable Keystore keys are not an enterprise recovery system. Keep the installation, signing identity and app data intact during updates. Losing the phone, uninstalling, clearing storage or losing a Keystore key can make unsent records and drafts unrecoverable. A matching APK signing certificate does not itself back up an installation's encryption key. The controlled APK update gate checks package/signer/version, not local data migration or key recovery.

The configured backend persists private Guard/receiver records and JPEG bytes in PostgreSQL. It relies on database access controls, host/storage protection and reviewed backup handling; application-level encryption of every server field is not implemented. Database backups must be private and access-controlled. Restoring database data cannot recreate external Auth service configuration, TLS/issuer keys, delivery credentials, release signing material or a phone's Keystore. These require an approved recovery plan and separate verification.

No automatic production retention/deletion schedule is selected by this code. Preserve original history, receipts and unresolved queues until an approved policy and recovery procedure are tested. Local deletion, SQLite secure deletion and cache cleanup do not establish forensic erasure from storage blocks, third-party apps, backups or exported destinations. Live email/Ops activation, real-camera/GNSS acceptance, hardware-backed key behavior and full-shift recovery remain operational gates.

## Retained offline prototype notes

The following original notes remain intact for the demo's schema, export and migration history. Their statements about absent authentication or transport apply to that historical demonstration.

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


## v0.7 local audit review

The read-only viewer decrypts a bounded page of submitted events in app memory and displays event details, including potentially sensitive notes and GPS fields. It does not alter delivery flags or create events. Drafts remain excluded. The viewer is available in standby because this test app has no production guard authentication; the screen explicitly warns that anyone using the installation can read records. Production needs authenticated guard/site scope, screen protection and retention policy before real operational data is used. Physical presence, server acknowledgement authentication and immutable history are not established by these records.
