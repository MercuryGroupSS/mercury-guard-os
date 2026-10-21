plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
 namespace = "ca.mercury.guard"
 compileSdk = 35
 defaultConfig { applicationId = "ca.mercury.guard"; minSdk = 28; targetSdk = 35; versionCode = 6; versionName = "0.6.0"; testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner" }
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
