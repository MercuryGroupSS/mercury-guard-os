# Flashable OS feasibility — separate research track

The Mercury-controlled single-purpose handset does **not** require custom firmware. Native app + Android Enterprise device-owner kiosk is the supported production direction. The Galaxy Z Fold6 test device should not be bootloader-unlocked, wiped, or flashed as part of app testing.

A full Android fork is manufacturer-specific. Bootloaders, partitions, kernels, radio/modem firmware, vendor blobs, OTA signing, AVB, camera and foldable display support depend on the precise SKU. A Pixel sold with supported bootloader unlock and current factory image is the practical research device for this track. GrapheneOS is not interchangeable with Samsung firmware and does not support arbitrary devices.

Before any future flashing: obtain a dedicated nonpersonal test Pixel, verify unlock support, review factory recovery images, secure-boot/signing and OTA plan, preserve emergency calls, complete power/network/camera regression tests and create a rollback plan. No flashing commands are provided here because no hardware SKU or safe image has been validated.
