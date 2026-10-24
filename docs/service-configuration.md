# Packaged account service configuration

The guard-account pilot is available under Prototype tools → Guard account connection. The normal preview is unconfigured. It does not request passwords, contact a server, enroll a device or start a real shift.

A controlled build may package `app/src/main/assets/guard-service.json` with exactly these public fields:

- `endpoint`: trusted HTTPS service origin only, with no credentials, path, query or fragment.
- `issuer`: exact signed-grant issuer.
- `audience`: exact device-proof and grant audience.
- `device_id`: administrator-provisioned enrollment identifier for this installation.
- `issuer_keys`: map of trusted key IDs to canonical unpadded base64url RSA SPKI public keys (2048 bits or stronger).

Never put a private signing key, password, access token, Supabase service key or refresh token in this file. Provision the installation key and matching enrollment separately. Guard/vendor bindings and assignment mappings come from administrator-controlled backend records. There is no public guard-role, phone or assignment self-enrollment. Personal Auth accounts can be created through the separate verified-email account page. A separate configuration per installation is a pilot mechanism, not fleet provisioning; managed enrollment/configuration remains required for production.

The UI requires a device biometric before accepting individual Guard ID/password, uses only the configured HTTPS origin, and clears its foreground session and form credentials on backgrounding or activity recreation. Separately encrypted short-lived upload authority may continue already-authorized scheduled delivery; it contains no password or refresh token. Explicit sign-out or guard switching cancels it immediately. Expiry or reboot requires sign-in. A background UI result cannot restore a signed-out foreground session. Password strings created by the JVM cannot be guaranteed scrubbed. Biometric success is local verification only, not evidence to the server of which guard touched the sensor.

Configured enrollment/sign-in screens provide **Set up or reset password**. The app clears its current foreground credentials before handing off to the configured HTTPS origin's `/account/` page. The link contains no token, email, guard ID or query/fragment. The user verifies an emailed code and chooses their own password; role, vendor, phone and assignment approval remain separate. On shared phones, users should decline browser password-saving prompts. Returning to the app requires ordinary biometric/Guard ID/password sign-in again.

Signed grants are verified against the packaged public keys, expected guard/site/assignment/device/revocation binding and a boot-bound monotonic time anchor. The current authorized flow includes explicit server-confirmed shift start/end, cancellation closeout, encrypted incidents, independently selected route checkpoints, photos, timed check-in evidence, delivery status/reasons, dispatch versions/acknowledgements and scoped queued upload. A saved local record is distinct from an accepted server/media/receiver receipt. Encrypted automatic background delivery and exact-scope scheduled retries are implemented and locally verified. Authorized location is separately controlled by explicit approved policy, individual consent and a signed short lease; demonstration GPS is not authority. Service receipt, operator acknowledgement and receiver delivery remain distinct. Production activation, configured release and attended hardware acceptance remain open.

## Local backend and accounts

Start or restart the isolated stack with `node server/scripts/start-local-stack.mjs --restart`. This preserves its volumes and verifies localhost-only published ports. Then `node server/scripts/start-local-service.mjs` starts the local application service in shared PostgreSQL mode and prints its loopback URL. The console is `/admin/` and personal setup/recovery is `/account/`. `MERCURY_IDENTITY_STORE=sqlite` is retained only as an explicit synthetic protocol mode, without the new portal; changing modes does not migrate old SQLite records.

The local application service is HTTP on loopback. An actual configured phone/browser requires an approved HTTPS origin, deployment and appropriate trust; the local URL is not silently placed into a production APK. Local email is captured in Mailpit and is not delivered to a real mailbox. See [administration and account setup](administration.md) for current configuration, owner activation and remaining hosting/SMTP gates.

## Verification

The exact v0.33 source `4b7e4748c5bde2d2f84c11ad1f46b22134c9c4cb` passed GitHub Android run 40043548479, including build, API 28/API 35 and HTTPS. The subsequent location backend and corrective consent-order migrations have separate exact-source verification records. Local real Auth/Mailpit checks verified account setup/recovery, one-time codes, password replacement, old-session denial and role boundaries; real Auth/PostgreSQL HTTPS checks separately verify scoped data and escalation delivery. Use the latest package BUILD-RECORD.json for the exact current native test and CI results.

No local or emulator result establishes live email delivery, actual Ops rendering, configured Fold acceptance, production signing or fleet enrollment. See [authorized location](authorized-location.md) and the [attended Fold checklist](fold-acceptance-v0.34.md) for the remaining location and hardware gates.
