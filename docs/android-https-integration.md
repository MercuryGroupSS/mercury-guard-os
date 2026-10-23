# Android HTTPS integration test

`https-integration` in the Android workflow launches an API 35 emulator and runs HttpsAccountIntegrationTest against the actual Node Guard service behind a loopback TLS endpoint. The Auth adapter is deliberately synthetic for CI; real Supabase behavior is covered separately by check-local-roundtrip.mjs. The test does not validate production hosting, the biometric UI or physical hardware.

The test generates an ephemeral localhost certificate and issuer key. Only the certificate and issuer public key enter the test build. `-PhttpsTest=true` selects a separate `.httpstest` application ID, test-only manifest and generated resources under app/build/https-test. Normal and preview builds do not reference that manifest or certificate. No custom trust-all verifier or SSL socket factory exists. The fixture refuses normal startup unless explicitly put in synthetic-only mode and listens only on loopback. Test enrollment endpoints exist only in this fixture script, not the application service.

The Android test creates an installation key in Keystore, enrolls it with the fixture, signs in via guard ID/password, retrieves its scoped assignment, verifies a server grant using the generated fixture's packaged public key, captures an encrypted incident, sends it twice, checks a single stored event, acknowledges the matching receipt, rejects an untrusted hostname and rejects a cleared session. Resources are deleted in cleanup. Test reports, not generated keys or test APKs, are uploaded as CI artifacts.

Local compilation of the dedicated test APK succeeded. Emulator/network execution is pending until the workflow completes. Normal APK trust separation is checked with a separate normal build. Physical tests remain deferred.

The observation-time anchor now uses response receipt time, while expiry verification uses request-start time conservatively. This avoids adding network latency to reported observation timestamps and creating apparent future events.

## First verified emulator result

The API 35 HTTPS integration job in run 39986433364 completed successfully for commit a03d9830a1c0cdaa9c42c63d554c8bf13f41b8f6. This verifies the Android Keystore → real HTTPS → Guard backend account/assignment/grant/incident/receipt path with the synthetic CI Auth adapter, including duplicate-safe ingestion, untrusted-host rejection and cleared-session rejection. The subsequently added patrol coverage is a separate pending run and is not included in this first pass.
