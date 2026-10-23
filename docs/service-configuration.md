# Packaged account service configuration

The guard-account pilot is available under Prototype tools → Guard account connection. The normal preview is unconfigured. It does not request passwords, contact a server, enroll a device or start a real shift.

A controlled build may package `app/src/main/assets/guard-service.json` with exactly these public fields:

- `endpoint`: trusted HTTPS service origin only, with no credentials, path, query or fragment.
- `issuer`: exact signed-grant issuer.
- `audience`: exact device-proof and grant audience.
- `device_id`: administrator-provisioned enrollment identifier for this installation.
- `issuer_keys`: map of trusted key IDs to canonical unpadded base64url RSA SPKI public keys (2048 bits or stronger).

Never put a private signing key, password, access token, Supabase service key or refresh token in this file. Provision the installation key and matching enrollment separately. Guard/vendor bindings and assignment mappings come from administrator-controlled backend records. No public self-enrollment exists. A separate configuration per installation is a pilot mechanism, not fleet provisioning; managed enrollment/configuration remains required for production.

The UI requires a device biometric before accepting guard ID/password, uses only the configured HTTPS origin, and discards its session and form credentials on backgrounding or activity recreation. A background network result is discarded rather than restoring a signed-out session. Password strings created by the JVM cannot be guaranteed scrubbed. Biometric success is local verification only, not evidence to the server of which guard touched the sensor.

Signed grants are verified against the packaged public keys, expected guard/site/assignment/device/revocation binding and a boot-bound monotonic time anchor. A verified grant currently produces a confirmation only: operational capture, refresh and upload lifecycle are still being connected. No clock-in is recorded by this screen.

## Verification

Server-issued grant interoperability passed on Android API 28 and API 35 in run 39983106703. Local account-screen build and tests are tracked in the current build notes. Neither configured HTTPS end-to-end Android login nor physical Fold validation is established by the unconfigured-screen test.
