# Controlled signed APK build

`node server/scripts/build-controlled-apk.mjs /ABS/PRIVATE/build.json` builds a release APK from an exact clean checkout of MercuryGroupSS/mercury-guard-os. It never installs on a phone, generates a production key, deploys a service or chooses identities. The normal preview remains separate.

The input, public service configuration and supplied keystore must be bounded regular files owned by the current user, mode600 with no leaf symlinks. Keep passwords and these inputs outside Git and public artifacts. The public configuration contains exactly the five fields documented in [service configuration](service-configuration.md); no Auth/DB key, token or password is allowed. HTTPS and canonical RSA SPKI are verified. Synthetic proof mode requires a `.invalid` destination and remains explicitly nonoperational.

The input has exactly these fields; replace all placeholders with reviewed values:

```json
{
  "version": 1,
  "mode": "controlled_release",
  "source_directory": "/ABS/CLEAN/mercury-guard-os",
  "source_commit": "EXACT_40_CHARACTER_COMMIT",
  "public_config_path": "/ABS/PRIVATE/guard-service.json",
  "signing": {
    "keystore_path": "/ABS/PRIVATE/release.p12",
    "store_password": "SUPPLIED_PASSWORD",
    "key_alias": "SUPPLIED_ALIAS",
    "key_password": "SUPPLIED_PASSWORD"
  },
  "expected": {
    "package": "ca.mercury.guard",
    "version_code": 35,
    "version_name": "0.35.0",
    "signer_sha256": "EXPECTED_64_CHARACTER_LOWERCASE_CERTIFICATE_SHA256"
  },
  "output_directory": "/ABS/OUTPUT/NEW_IMMUTABLE_DIRECTORY",
  "previous_apk": null,
  "tools": {
    "gradle": "/ABS/gradle-8.10.2/bin/gradle",
    "java_home": "/ABS/JDK17",
    "android_sdk": "/ABS/ANDROID_SDK",
    "gradle_cache_directory": null
  }
}
```

Use `synthetic_build_proof` only for disposable test signing material and a deliberately synthetic `.invalid` service configuration. A supplied cache directory may point to the existing Gradle `caches` directory; daemon logs and build output remain under a new private temporary directory. Java17, Gradle8.10.2, Android build-tools35.0.0, Git and unzip must be available. No arbitrary extra Gradle flags are accepted.

The builder checks the checkout's exact public origin, commit and clean tracked/untracked state, rejects a manually installed service asset and fixture resources, then makes a separate clean clone/build directory. A private external Gradle init adds only the reviewed public asset and supplied release signing. Passwords are read from the private input file; they are not command arguments, public logs or environment values. Raw failed build diagnostics stay private. Do not publish those logs or retained temporary files.

`apksigner` and `aapt` must confirm one expected signer, exact package/version and a nondebuggable release. The embedded public bytes must match exactly; known HTTPS test metadata/trust files are rejected. If `previous_apk` is supplied, its verified package/signer must match and the new version code cannot be lower. This comparison does not certify data migration or rollback; preserve the previous APK and test both separately.

The output directory must not exist and cannot be inside the source checkout. Its parent must already exist; the builder resolves that parent and the source before any build setup, rejecting aliases through ancestor symlinks that lead back into the source. It receives only a read-only APK, checksum file and final public build record, including exact source, public-configuration and actual builder/helper/init hashes. No signing inputs are copied there. A failed partial new output is never reported as accepted and is not overwritten automatically. The public record proves this build's identity and isolation, not service reachability, email/Ops integration, release-key recovery, hardware acceptance or fleet enrollment.
