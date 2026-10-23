plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
 namespace = "ca.mercury.guard"
 compileSdk = 35
 defaultConfig { applicationId = if (providers.gradleProperty("localPreview").orNull == "true") "ca.mercury.guard.preview" else "ca.mercury.guard"; minSdk = 28; targetSdk = 35; versionCode = 25; versionName = "0.25.0"; testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner" }
 if (providers.gradleProperty("localPreview").orNull == "true") {
  sourceSets.getByName("debug").manifest.srcFile("src/preview/AndroidManifest.xml")
 }
 signingConfigs.getByName("debug") {
  providers.gradleProperty("localDebugKeystore").orNull?.let { storeFile = file(it); storePassword = "android"; keyAlias = "androiddebugkey"; keyPassword = "android" }
 }
 buildTypes { getByName("release") { isMinifyEnabled = false } }
 compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
 kotlinOptions { jvmTarget = "17" }
}

dependencies {
 implementation("androidx.core:core:1.13.1")
 testImplementation("junit:junit:4.13.2")
 androidTestImplementation("androidx.test:runner:1.6.1")
 androidTestImplementation("androidx.test:rules:1.6.1")
 androidTestImplementation("androidx.test.ext:junit:1.2.1")
 androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
}
