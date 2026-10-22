# Mercury One v0.22 — combined interface and workflow build

Reconciles the saved Style Mercury Guard OS checkout (through its local v0.21) with the newer APK build's v0.13 signing/receive-cache foundations and today's Fold6 feedback. The other checkout remains unchanged. Source work is confined to MercuryGroupSS/mercury-guard-os.

Recovered adjustments: Mercury One branding; white responsive UI; approved GPU particle-face animation; Android secure-biometric demo entry; explicit synthetic assignment setup; central Escalate; scheduled clock-out and reasoned early exit; any-order GPS-backed patrol checkboxes; timed readiness/check-in; retained missed-check reasons; biometric/fresh-GPS/consented-photo check-in; calm color alerts, bounded sound/vibration and silence/reduced-motion controls. Optional full-screen code remains off by default and requires owner-controlled setup. It does not imply store eligibility, OS permission approval, named-person identification or guaranteed background delivery. Future site-bound identity, managed kiosk/security-key access and real geometry remain design requirements only. An unconfirmed shared-device PIN/selfie proposal stays unimplemented.

Preserved newer work: encrypted incoming cache, outgoing batch identities and receipt storage, explicit installation keys, signed-grant verifier, v1 and assignment-bound v2 signer, and local Node round-trip/reference tests. Demo records remain disconnected and are not assigned production authority. Existing encrypted records remain schema compatible; old manual checkpoint records count toward completion.

Fold6 fixes: Refresh readiness now confirms its tap. Explicit GPS retry re-registers the listener when a service is already running and clears the old process-local fix observation while waiting. A retry cannot guarantee a new GPS fix. Incident, camera, fold recovery, notification permission and reported stop behaviour were user-confirmed on v0.13, not on this new interface.

Local APK/instrumentation assembly, lint and 15 JVM tests passed. Combined API28/API35 regression verification passed in run 39854910053. The local emulator could not start in the current sandbox. Runtime evidence below comes from GitHub Actions; the physical cover-screen launch was captured on the Fold6. No Supabase environment or new hosting charge, backend change, reset, flashing, enrollment or phone special-access setting was performed.

Debug signing can differ from the APK already installed on the Fold6. Never uninstall or erase it to resolve a mismatch: its encrypted data key would be lost. A separately identified preview build can preserve the original installation for UI validation; local debug signing material is excluded from Git and source packages. This is not production release signing.

## Safe physical preview variant

The localPreview build property selects a separate application ID and preview manifest overlay. The overlay omits USE_FULL_SCREEN_INTENT, preventing installation from initially granting that optional special access. Normal permission choices remain user controlled. It installed successfully on the Fold6 and cold-launched; a cover-screen capture confirms the recovered white login/particle field. No assignment, sign-in, patrol or tracking was started in the preview. The inactive inner display capture was black and is not UI evidence. The original v0.13 package remains installed. Runtime workflow tests on this preview are still pending.

Build with localPreview=true and a developer-owned localDebugKeystore path; never include the keystore in source/artifacts. The default package retains opt-in full-screen code for separate owner-reviewed testing; the preview does not have that access.

## Final combined validation

Source commit 045ebe13c4383207f419a0e717f38aa69df88555; GitHub run 39854910053 passed build, lint, signature verification and both API28/API35 instrumented suites. Local main and isolated-preview builds/lint passed, 15 JVM tests passed, and 17 local Node tests passed. The CI suites include existing opt-in capture/hardware cases that are skipped; they are not physical biometric or camera successes. The first combined API35 run failed two UI cases because the Android ImmersiveModeConfirmation tutorial stole focus. CI now confirms that tutorial only in its disposable emulator before tests. No phone tutorial/security settings were changed.

Preview APK SHA-256: c93bdc5aba7a7cb88a605bbf5460fdf08594a126037647a070c803e25e886f2a. Signature checked locally. Installed separately as Mercury One Preview, with full-screen notification permission omitted; original app remains installed. Physical cover-screen login/particle field verified. Actual biometric success, new patrol GPS flow, check-in photo linkage, timed alert delivery and folded/unfolded behaviour of the combined interface still need owner-operated hardware checks. No production readiness claim.
