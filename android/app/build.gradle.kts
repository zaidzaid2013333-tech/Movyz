plugins {
    id("com.android.application")
}

android {
    namespace = "com.movyza.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.movyza.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 5
        versionName = "2.0.4"
    }

    buildFeatures {
        buildConfig = false
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
