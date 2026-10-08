plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val tmdbToken = providers.environmentVariable("TMDB_API_READ_ACCESS_TOKEN").orElse("").get()
val supabaseUrl = providers.environmentVariable("SUPABASE_URL").orElse("").get()
val supabaseAnonKey = providers.environmentVariable("SUPABASE_ANON_KEY").orElse("").get()

android {
    namespace = "com.movyza.app"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.movyza.app"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "2.0.0"

        buildConfigField("String", "TMDB_TOKEN", "\\"$tmdbToken\\")
        buildConfigField("String", "SUPABASE_URL", "\\"$supabaseUrl\\")
        buildConfigField("String", "SUPABASE_ANON_KEY", "\\"$supabaseAnonKey\\")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.09.00")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.11.0")

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.animation:animation")
    implementation("androidx.compose.material3:material3")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("io.coil-kt.coil3:coil-compose:3.6.3")
    implementation("io.coil-kt.coil3:coil-network-okhttp:3.6.3")
}
