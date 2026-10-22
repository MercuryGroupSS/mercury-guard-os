# Mercury One prototype — white visual and interaction revision

## Provenance

The white, futuristic Jarvis-inspired direction was recovered from `project-brief.md` (v1.4 onward) and `build-v0.10.md`. No original mockup/assets were found in the repository, recovered master brief or prior local browser simulation; the latter was the old dark v0.2 UI. The user then explicitly revised the name and flow to Mercury One, biometric entry, contextual prompts, one Escalate entry point, scheduled clock-out and an escalation-only property view. The implementation follows that later direction. It is not a recovered pixel-exact design.

Package `ca.mercury.guard` and repository identity remain unchanged. Display name is Mercury One, test version 0.11.0 (11).

## Current behavior

- No assignment means no clock-in. A clearly labelled Prototype tools screen can explicitly create an eight-hour local demo assignment. This is never a real schedule or payroll authorization.
- Entering a fresh app instance with an available demo assignment initiates required checks and Android BiometricPrompt. A retry button remains after cancellation. Creating a demo assignment also initiates this flow.
- Precise location permission, enabled GPS and allowed shift notifications are checked before biometrics and rechecked on success. A missing GPS fix is not represented as verified presence. Actual site eligibility, lateness rules and identity are not configured.
- API 30+ requests `BIOMETRIC_STRONG`; older supported releases use the platform biometric prompt. No custom face recognition, face images or biometric templates are collected. Supported secure biometrics depend on the phone; face unlock is not guaranteed.
- Only successful biometric completion can start a UI-created demo shift. Cancel, unavailable biometrics, missing checks, expired/missing assignment or a consumed assignment cannot start one. The assignment is consumed before recording, preventing duplicate clock-in after interrupted/repeated authentication. A storage failure can require creating a new demo assignment; it never fabricates success.
- Main shift UI contains patrol/readiness/check-in prompts, Escalate and Prototype tools. There is no map on the normal shift screen. Existing audit, identity and device-readiness tools remain available.
- Scheduled end reveals Clock out. Time passing does not clock out or stop a shift. Before that time, End shift early exists only within Escalate, requires a nonblank reason and a separate confirmation. Actual timestamps and reason are recorded locally, pending with no transport. No supervisor notification or payroll confirmation is claimed.
- Early exit stops GPS even if local storage fails and explicitly reports that no end record was saved. Reboot still invalidates the local demo session; production shift reconciliation/re-authentication is not implemented.
- Escalate remains available without a shift or successful sign-in. Incident drafts and submission work locally off shift; the app clearly directs immediate emergencies to established emergency/dispatch channels. It sends no alerts.

## Escalation map and site integration boundary

The isometric property view is a clearly labelled, unregistered demo schematic. Its amber issue pin is manually adjustable through accessible horizontal/vertical controls, survives recreation locally and can be saved as a separate encrypted demo-grid audit event. It is not the guard marker and is not a real-world coordinate.

An available current GPS fix is identified in green with latitude/longitude, accuracy radius in metres, last-fix timestamp, age and mock-provider status. A fix older than 60 seconds is stale. Missing shift, missing permission or no fix produces an unavailable state. Viewing the map does not request permission or start tracking. Tracking remains the existing on-shift foreground service, with a visible notification, and stops at clock-out. No guaranteed continuous background positioning or exact indoor location is claimed.

**Real guard placement on the property map remains blocked by missing authorized site geometry and georegistration.** The implementation deliberately does not place phone coordinates onto invented buildings. A glowing green on-property marker/accuracy circle can only be meaningful once those data exist.

Future read-only map contract: an authenticated assigned shift must supply a stable `site_id`; an authorized site record supplies address, boundary polygon, coordinate reference system and map/model configuration/version. Site access must be scoped to that assignment, with explicit missing, unauthorized, stale-cache and offline states. Never infer the assigned site from GPS. A drawn boundary does not itself provide 3D buildings or indoor accuracy. Real map integration needs authorized geometry/provider or a supplied model, georegistration, and a retention/access policy. This revision does not provision a vendor, modify a backend or transmit location.

## Visual/accessibility system

Pearl `#F4F8FA`, white controls, graphite `#192A36`, secondary text `#506472`, accessible cyan `#00687D`, destructive text `#9C2D30`. Native sans-serif, supporting text at least 14sp, buttons 16sp and 56dp minimum height, titles 28sp. Labels wrap, incident input has a persistent associated label, screen titles expose heading semantics, decorative views are excluded from accessibility navigation, keyboard focus has an explicit outline. Native dialogs/system bars use the light theme.

The central technical rings rotate slowly (18 seconds). Motion stops on pause/detach, respects disabled system animations, and stays static with touch exploration. Native ripple supplies touch feedback. No decorative indicator represents connection or authorization.

Below 720dp width, content stacks. At 720dp and above, the summary uses 38% and controls 62%, bounded to 1100dp. Font scales above 1.3 use a single column. Existing activity/draft restoration remains intact. This is width-responsive, not hinge-aware tabletop support.

Computed sRGB contrast: graphite/pearl 13.78:1; secondary/pearl 5.77:1; cyan/pale-cyan 5.70:1; white/cyan 6.41:1; destructive/white 7.42:1. These exceed 4.5:1. Full TalkBack/keyboard/OEM accessibility validation remains manual work.

## Verification and limitations

Toolchain: task-isolated Java 17, Gradle 8.10.2, SDK 35. Build, unit, lint, emulator and screenshot evidence is recorded in the delivered review bundle. The old upstream CI run 39674984682 does not validate this change. No physical Fold6 validation has occurred. Real biometric success/face support requires suitable enrolled test hardware; the emulator checks unavailable-biometrics behavior and tests gating logic.

Screenshot harness is opt-in (`captureScreenshots=true`), emulator-only. It covers folded-size 968×2376/420dpi, unfolded-size 1856×2160/360dpi and 2× font scale, with incident draft recreation. These are review configurations, not claims of Samsung hardware equivalence.

The local debug APK is for testing, not production signing. Its signer may differ from earlier CI builds, so an in-place update is not guaranteed. Do not uninstall an existing installation to work around signature mismatch without preserving needed encrypted records.

### Recorded local results

- Debug app and instrumentation APK assembly, 9 unit tests and lint passed (0 lint errors; 27 warnings).
- API 28 and API 35: `OK (43 tests)` each. Two opt-in cases are skipped in that normal suite, so 41 regression cases execute per API.
- The API 35 screenshot harness ran separately with capture enabled: 2 cases passed and produced 18 real emulator PNGs.
- No remote push, PR, backend mutation or physical-device operation was performed.
- The isolated API 35 unavailable-biometric case passed separately (1 case). Successful enrolled biometric/face authentication is not hardware-validated.
- Eighteen screenshots were inspected for representative folded/unfolded/2×-text layouts; a transient first-frame blank capture was corrected in the capture harness. A six-second emulator recording demonstrates the ring motion.
