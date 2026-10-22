# Mercury One v0.12 — particle login presentation

This revision changes only the login presentation and related accessibility/test selectors. Existing shift, escalation, incident, schedule and biometric authorization behavior remains intact.

The resting login screen contains only the light-grey **Mercury One** wordmark as visible words. White background, a native moving particle circle, and two minimal symbol controls replace the previous heading, status copy and action cards. The `!` control retains immediate Escalate access; `⋯` opens existing prototype tools. Both have descriptive accessibility labels and 56dp touch targets. The particle visual is the sign-in affordance, with an accessible description that states the offline/demo or unavailable-assignment condition. Missing-assignment and error details are shown on interaction rather than fabricated success.

Particles smoothly form a generic projected 3D face during the sign-in attempt. All points, facial contours and depth are calculated locally; there are no face images, camera inputs, biometric templates, identity matches, speech recognition or microphone use. The visual is never an authentication-success indicator. Only the existing genuine BiometricPrompt success callback can enter the gated simulated shift. Failure/cancellation returns the visual toward the circle.

Rendering uses a fixed point set and approximately 30fps scheduling. Motion stops on pause, detach or hidden windows; disabled system animation and touch exploration use a static visual. No physical CPU/battery benchmark has been performed.

The app requests immersive fullscreen on login and restores normal system bars on other screens. BiometricPrompt wording is limited to its required Mercury One title and Cancel control; the operating system owns its size and placement. Genuine OS authentication, permission dialogs and first-use fullscreen education are not replaced or bypassed. A Mercury vector launcher mark replaces the platform's default app icon. OEM/system security UI may still contain system branding.

Review captures are actual API35 emulator frames at 968×2376. The six-second recording and face screenshot demonstrate the procedural visual through the opt-in instrumentation harness; they do **not** depict a successful biometric authentication. The harness asserts that its visual transition does not start a session. Android's first-use fullscreen tutorial was acknowledged normally before clean capture.

Package identity remains `ca.mercury.guard`, test version 0.12.0 (12). Local debug signing and prior real-backend/site-map limitations are unchanged. No physical Fold6 or enrolled-biometric validation, remote push or production changes were performed.

Validation: debug APK and instrumentation APK assemble successfully; Android lint and nine JVM unit tests pass. The normal API 28 and API 35 emulator suites each report 45 cases (42 executed, three opt-in capture/device scenarios skipped), with no failures. The dedicated particle capture case passes separately and confirms no session is created by the visual transition. Final title-only biometric wording was rebuilt with lint and unit tests; the complete emulator suites preceded that wording-only edit. Screenshots were visually inspected for the requested wordmark, particle circle, face and retained emergency affordance.


## v0.13 — stronger particles and sculpted facial surface

The facial point cloud now samples one continuous depth surface with a rounded forehead, recessed eye sockets, raised brow, projecting nose bridge/tip, cheekbones, shaped lips and a tapered jaw/chin. Surface-normal shading, darker eye/mouth details and a slight near-frontal rotation make the generic face legible at phone size. Particle radius increases from 0.9dp to 1.25dp at rest, with depth/feature weighting during the morph. The fixed point set is generated once, keeping the existing 30fps cap, lifecycle pause and reduced-motion behavior. No authentication or shift logic changed.

Actual API35 emulator still and six-second motion capture were inspected at folded phone proportions. These remain a controlled visual demonstration, not a successful biometric sign-in. Debug build, lint and nine unit tests pass. The first regression run encountered an existing installation identity left by previous tests; the clean-data rerun is recorded with the review outputs. No physical-device validation or remote push.

The clean API35 regression run passes all 42 executed cases (45 reported, including three opt-in skips); the dedicated particle capture passes separately. API28 was not repeated for this geometry-only revision.


## v0.14 — circular field with central relief

The outer particle silhouette stays circular throughout the transition. The middle develops shallow brow/eye recesses, nose projection and restrained mouth relief; there is no head, skull, chin or jaw outline. The outer annulus keeps moving and stays continuous with the central surface. Existing pulse/rotation cadence, thicker 1.25dp particles, white wordmark screen, authentication callbacks and shift flow are preserved. Only geometry/projection changes; the demonstration still does not authenticate a user.

Validation: debug build, lint and nine JVM tests pass. Clean API35 regression suite passes 42 executed cases (45 reported including three opt-in skips), and the animation capture passes separately. Actual folded-proportion still inspected for circular perimeter and central relief. API28 and physical-device checks were not repeated for this visual-only revision.


## v0.15 — supplied mesh reference

The user supplied IMG_3811.jpeg (Library libfile_87ad51bdb66c819189d224d7bf08e7fa). It was materialized and visually inspected before changes. Its open almond eyes, sculpted bridge/tip/lips and delicate triangulated connections inform the central geometry. The reference's black backdrop and full head silhouette are intentionally not copied: the approved white screen and moving circular particle field remain.

The native depth surface now has open almond eyes, stronger nose/brow/lip relief, perspective depth projection and a fixed triangular edge network fading toward the outer annulus. Fine cyan lines complement the thicker particles. Points and connectivity are precomputed; projected arrays are reused per frame. No user face, image texture, camera, biometric data, backend or operational logic is involved. The reference file itself is not packaged in the app.

Validation: build, lint and nine JVM tests pass. Clean API35 suite passes 42 executed cases (45 reported including three opt-in skips); dedicated animation capture passes. The supplied reference was compared with the actual folded-size still and exact sampled video frames at idle, mid-transition and settled relief. An initial emulator System UI error obscured capture; Wait was selected normally and clean captures replaced those outputs. No physical-device validation or API28 rerun for this geometry-only change.


## v0.16 — full supplied face as the final pose

The user's latest instruction supersedes the circular-final-state constraint: start on moving particles and end on the supplied full face. The original IMG_3811.jpeg was re-inspected and is now bundled as the artistic target. Native Canvas particles travel into positions sampled from its wireframe, then resolve into the reference's exact silhouette, three-quarter pose, eye openings, nose/lips and mesh structure. The circle disappears completely at the final pose. A native color filter maps the blue mesh to cyan opacity on the required white background; proportions and facial structure are unchanged.

This is a reference-faithful raster rendering with a native particle transition, not a newly reconstructed rotatable 3D model. The distinction is deliberate: it honors the request to finish on this exact face. No user-face capture, identity inference or authentication result is represented. Reduced-motion/lifecycle behavior and biometric/shift callbacks are unchanged.

The attachment's thin eight-pixel top border is excluded from drawing; facial artwork is retained. Actual emulator stills were compared with the supplied reference, prompting a final tint adjustment to retain fine mesh contrast on white. Build, lint, nine unit tests and the clean API35 suite pass (42 executed cases; 45 reported including three opt-in skips). The final border/tint-only adjustment was rebuilt and the capture test repeated; operational regressions preceded that rendering-only adjustment. No API28 rerun or physical-device validation.


## v0.17 — persistent particle formation without replacement

The final bitmap draw and particle fade-out have been removed. One fixed set of dense image-derived samples persists from the rotating circle through the final reference face. Position, diameter, cyan tint and sampled opacity interpolate using the same smoothstep over 3.2 seconds; final mesh lines are formed by those same dense samples. There is no threshold that replaces the renderer or introduces new points. Reusable intensity-bucket arrays batch point drawing at the existing 30fps cap. This remains a 2D reference-derived projection, not reconstructed 3D geometry. Authentication/shift logic and lifecycle/reduced-motion handling are unchanged.

The opt-in capture is extended to nine seconds, including a final hold. It continues to assert that the artistic transition never starts a session.

Capture harness correction: removed waitForIdleSync from live screenshots, because continuously scheduled rendering can prevent the UI queue becoming idle. This does not modify app behavior. An emulator System UI error was dismissed normally before rerunning; stale or interrupted outputs were excluded from deliverables.

Frame review exposed elapsed-time drift under emulator rendering load. Progress now follows actual elapsed time rather than a capped per-frame increment; sample spacing was reduced in density to lower rendering load. This keeps one continuous easing curve and fixed particle identity, with no end-state replacement. The clean API35 suite passed 42 executed cases (45 reported including three opt-in skips); the subsequent timing/sample-only refinement was rebuilt with lint and nine unit tests and recaptured.

Final capture passed. Exact-time recording frames at 4.5, 4.7, 4.9 and 5.1 seconds were inspected across final formation: particles progressively converge into the same projected face without a bitmap replacement. The nine-second deliverable includes the final hold; the final still is visibly particle-rendered rather than a raster swap. Performance has not been benchmarked on a physical Fold6.


## v0.18 — measured cadence and GPU rendering

The v0.17 MP4 itself had irregular cadence: 124 frames over 8.919 seconds (~13.9 fps), median frame gap 67 ms, 95th percentile 158 ms and maximum 207 ms. The duplicate-frame count includes the intentional final hold and is not evidence of buffering by itself. Live emulator gfxinfo without recording showed median 25 ms and 95th-percentile 48 ms frame times with draw-command deadline misses. These measurements support rendering/capture pressure, not a claim about the user's network or iPhone player.

All 10,833 persistent particles and target coordinates are retained. Their static attributes are uploaded once to a GL buffer; a vertex shader handles motion/easing with a single point draw on the GL render thread. No per-frame particle allocations, bitmap draw, repeated CPU sampling or CPU trigonometry loop remain. Shader locations are cached. Rendering is requested at about 30fps and stops updating the static final hold. Lifecycle/reduced-motion behavior and auth/shift callbacks remain intact.

The new raw recording measures ~29.64 fps during motion, median frame gap 33.3 ms, 95th percentile 50.3 ms and maximum 55.2 ms. Instrumented CPU submission averages 0.028 ms per GL draw (not GPU completion time). The screen recorder omits the unchanged hold after 4.858 seconds. The delivered preview resamples the original timing to constant 30fps H.264 Main MP4 with network-optimized layout and repeats only the final frame to provide a nine-second preview. It does not generate interpolated motion or hide source cadence measurements.

Build/lint/nine JVM tests, the capture test and the full API35 suite pass (42 executed regression cases, three opt-in skips). No physical Fold6 performance claim, API28 rerun, backend change or remote push.


## Approved visual baseline — v0.18

On 2026-10-22 at 00:53:16 UTC, after receiving the v0.18 smoother animation preview and test APK, the user replied **“Perfect”**. This records acceptance of the visual presentation implemented in commit `b5db401`: white Mercury One login, moving particle circle, continuous formation into the supplied full face, and the smoother GPU rendering. Preserve this baseline; no further visual changes were requested.

Approved review deliverables:

| Deliverable | Library file ID |
| --- | --- |
| Nine-second smoother preview | `libfile_6018449400708191a9e9c31a5e31464c` |
| v0.18 test APK | `libfile_9809717162448191ae473a5de232e44a` |
| Final still | `libfile_f03b48dda9b4819181550c8b7310814f` |

Acceptance is visual only. It does not establish physical-device validation, production readiness, backend integration, or authorization for a remote push. Existing test results and prototype limitations remain as documented above. This approval record changes documentation only; application code and deliverables are preserved.
