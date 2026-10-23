# Flashable OS feasibility — separate research track

The Mercury-controlled single-purpose handset does **not** require custom firmware. Native app + Android Enterprise device-owner kiosk is the supported production direction. The Galaxy Z Fold6 test device should not be bootloader-unlocked, wiped, or flashed as part of app testing.

A full Android fork is manufacturer-specific. Bootloaders, partitions, kernels, radio/modem firmware, vendor blobs, OTA signing, AVB, camera and foldable display support depend on the precise SKU. A Pixel sold with supported bootloader unlock and current factory image is the practical research device for this track. GrapheneOS is not interchangeable with Samsung firmware and does not support arbitrary devices.

Before any future flashing: obtain a dedicated nonpersonal test Pixel, verify unlock support, review factory recovery images, secure-boot/signing and OTA plan, preserve emergency calls, complete power/network/camera regression tests and create a rollback plan. No flashing commands are provided here because no hardware SKU or safe image has been validated.

## Review after first APK build — 20 October 2026

The APK build and signature verification succeeded in GitHub run 39527600676. This research track remains separate from the prototype and has not enrolled or altered a device.

### Practical dedicated-device architecture (proposed)

Mercury Guard supplies guard workflows; a separate policy controller/EMM supplies enrollment, kiosk allowlisting, launcher policy, app updates and device recovery. The staging operations API supplies signed, short-lived guard/site/shift grants. Device ownership is not a substitute for operational authorization. No real backend is connected by the demo.

Android lock task mode supports restricting a handset to approved apps. A DPC must allowlist them; ordinary screen pinning is user-exitable and does not meet the security requirement. A DPC can be bundled with a kiosk, but keeping control and workflow components separate reduces the risk that a workflow update breaks device administration. This separation is our design inference, not an Android requirement. [Android lock task documentation](https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode).

Provision fully managed company equipment using a deliberately dedicated test unit and the selected EMM's supported enrollment flow. Test default launcher after reboot, settings restrictions, network setup, emergency dialing, recovery access, off-shift GPS cessation, lost-device actions and update rollback. Management commands require device connectivity; a shut-down handset cannot receive them. [Google provisioning guide](https://developers.google.com/android/management/provision-device).

Evaluate three choices before procurement: an EMM using Android Enterprise; a Mercury-owned DPC with the cost of supporting policy/enrollment/security updates; Samsung Knox extensions as optional adapters. Do not assume Android Management API is a free internal MDM backend: Google restricts it to commercial EMM/Device Trust providers serving external customers, so Mercury internal fleet use should use an eligible EMM or a separately evaluated DPC route. Enrollment quota also needs checking. [Permissible usage](https://developers.google.com/android/management/permissible-usage).

### Flashable OS gate

A working APK is portable application code, not a bootable system image. The Fold6's exact model, region, carrier and bootloader unlock availability are unknown. No compatible Mercury firmware, vendor integration, recovery path, or maintained OTA channel has been validated. Consequently there is no safe Fold6 flash image to deliver at this stage.

AOSP describes bootloader unlock restrictions and data erasure. Unlocking is a destructive enrollment event, not part of the removable app test. The official GrapheneOS supported-device list must be checked for the exact future hardware; it does not establish Fold6 support. [AOSP bootloader guide](https://source.android.com/docs/core/architecture/bootloader/locking_unlocking), [GrapheneOS device support](https://grapheneos.org/faq#supported-devices).

Any future image requires a supported unlockable dedicated device, matched kernel/vendor components, functioning modem/camera/GPS/display, private AVB/OTA keys, production image signing, rollback protection and a tested factory recovery route. Relocking must be supported for the exact image/device and cannot be assumed safe. Maintain monthly security merges and hardware regression tests throughout the device's service life. [AOSP release signing](https://source.android.com/docs/core/ota/sign_builds).

### Next evidence needed

Exact Fold6 SKU and Android/One UI version for physical APK testing; exact proposed Pixel and unlock policy; management vendor/cost comparison; staging authorization contract; fleet update and recovery ownership. These are later-stage inputs and do not block building the current test APK.


## Physical device identified — 22 October 2026

The APK test handset has now been identified over USB as Samsung SM-F956W (Galaxy Z Fold6), Android 15. This resolves the earlier unknown-SKU note for APK testing only. Bootloader unlock feasibility, compatible system image, recovery and managed-device enrollment remain unvalidated. Mercury One Preview is a separate removable app; no reset, flashing or device-owner enrollment was performed. Dedicated-device evaluation follows APK physical acceptance.

## v0.28 dedicated-device integration review — 23 October 2026

Official documentation was refreshed after packaging v0.28. Samsung lists kiosk support for fully managed Samsung Android Enterprise devices on Android 11 or later. That platform-level support is not proof of enrollment, licensing, or policy acceptance on this particular SM-F956W. [Samsung kiosk requirements](https://docs.samsungknox.com/admin/knox-manage/kiosk-devices/introduction/kiosk-minimum-requirements/).

Current source inspection identifies an important implementation dependency: both account evidence capture and the demo launch ACTION_IMAGE_CAPTURE in another app. Lock-task mode permits only DPC-allowlisted applications. Therefore a single-package allowlist is insufficient to assume camera capture works. Either allowlist the verified camera package under the selected management policy and test return/session clearing, or implement embedded camera capture before enforcing single-app operation. This is an inference from current source and Android's allowlisting rules, not a claim of a completed kiosk test. [Android lock task](https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode).

| Acceptance gate | Current evidence | Required dedicated-device test |
|---|---|---|
| Device enrollment and policy ownership | No device-owner enrollment performed | Dedicated company-owned test unit, chosen EMM and recovery plan |
| App containment | Readiness inspection exists; kiosk enforcement not demonstrated | Escape paths, reboot launcher and approved recovery exit |
| Camera evidence | External camera intent in GuardAccountActivity | Allowed camera launches, returns, clears credentials and preserves encrypted evidence |
| Guard identity | Separate guard/vendor account model | Two guards sharing a site phone cannot inherit credentials or private records |
| Fold behavior | Earlier APK physical checks; newest flow deferred | Cover/inner display, biometric prompts, camera return and rotation |
| Reminders and notifications | Emulator logic only | Selected lock-task notification policy, Doze, reboot, force-stop and battery conditions |
| End shift | Server/client controls tested synthetically | Confirmed exit stops capture/reminders and retains queued uploads |
| Updates and recovery | Preview debug signer only | Production signer custody, staged update, rollback and break-glass process |
| Emergency access | No managed-fleet acceptance evidence | Emergency dialing and operator recovery under actual policy |

Google's current Android Management API usage rules exclude exclusively first-party in-house solutions. A Mercury internal fleet must not assume it can directly use that API as its own free management backend; evaluate an eligible management provider or a separately supported DPC path. No service subscription or cost is committed by this review. [Permissible usage](https://developers.google.com/android/management/permissible-usage).

The bootloader research gate is unchanged. AOSP describes OEM-controlled unlock support and data erasure on unlock; it does not establish unlockability or a safe image for SM-F956W. Device-specific vendor components, verified boot/signing, recovery, radio/camera/foldable support and maintained OTA images remain missing evidence. No flash, reset, root, enrollment or phone command was performed. [AOSP bootloader requirements](https://source.android.com/docs/core/architecture/bootloader/locking_unlocking).
