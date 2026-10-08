plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

val tmdbToken = providers.environmentVariable("TMDB_API_READ_ACCESS_TOKEN").orElse("").get()
val supabaseUrl = providers.environmentVariable("SUPABASE_URL").orElse("").get()
val supabaseAnonKey = providers.environmentVariable("SUPABASE_ANON_KEY").orElse("").get()
val playbackApiBase = providers.environmentVariable("PLAYBACK_API_BASE")
    .orElse("https://movyz-36.sameranede.deno.net")
    .get()

fun quoted(value: String): String =
    "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    namespace = "com.movyza.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.movyza.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 5
        versionName = "2.0.4"

        buildConfigField("String", "TMDB_TOKEN", quoted(tmdbToken))
        buildConfigField("String", "SUPABASE_URL", quoted(supabaseUrl))
        buildConfigField("String", "SUPABASE_ANON_KEY", quoted(supabaseAnonKey))
        buildConfigField("String", "PLAYBACK_API_BASE", quoted(playbackApiBase))
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
}

configurations.configureEach {
    resolutionStrategy.eachDependency {
        if (requested.group == "org.jetbrains.kotlin" && requested.name.startsWith("kotlin-")) {
            useVersion("2.2.10")
            because("Align Kotlin runtime with the 2.2.10 Compose/KGP toolchain")
        }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.09.00")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.2")

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.animation:animation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("org.jetbrains.kotlin:kotlin-stdlib:2.2.10")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("io.coil-kt.coil3:coil-compose:3.3.0")
    implementation("io.coil-kt.coil3:coil-network-okhttp:3.3.0")

    implementation("androidx.media3:media3-exoplayer:1.11.1")
    implementation("androidx.media3:media3-ui:1.11.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.11.1")
    implementation("androidx.media3:media3-exoplayer-dash:1.11.1")
}
