# Local generated-output recovery — 23 October 2026

The local authorized-patrol build failed at parseDebugLocalResources because generated output contained `drawable/mercury_mark 2.xml`, an invalid Android resource filename. A thread dump had also shown Gradle hashing a duplicated generated `.flat` resource. No numbered duplicate was found under app/src. The source was not modified to work around the generated file.

The original build exited with failure before a requested termination reached its processes; no live process was killed. A fresh build used a temporary Gradle init script to place generated outputs under `/private/tmp/mercury-guard-recovery-20261023/<project>`. The original output directory was preserved. The fresh APK, instrumentation APK, JVM tests and lint all passed in 51 seconds with all 74 tasks executed.

For subsequent local builds, use `-I /private/tmp/mercury-guard-build-recovery.init.gradle` while that script exists. Its only setting is:

```groovy
allprojects {
    buildDir = new File('/private/tmp/mercury-guard-recovery-20261023', project.name)
}
```

Do not confuse the temporary outputs with previously packaged preview APKs. The currently verified local APK is `/private/tmp/mercury-guard-recovery-20261023/app/outputs/apk/debug/app-debug.apk`. This recovery does not establish physical-device or live-service validation.
