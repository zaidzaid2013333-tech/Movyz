pluginManagement {
    resolutionStrategy {
        eachPlugin {
            if (requested.id.id == "com.android.application") {
                val v = gradle.gradleVersion.split(".").map { it.toIntOrNull() ?: 0 }
                val major = v.getOrElse(0) { 0 }
                val minor = v.getOrElse(1) { 0 }
                val agp = when {
                    major >= 9 -> "9.4.0"
                    major == 8 && minor >= 7 -> "8.6.1"
                    major == 8 && minor >= 6 -> "8.4.2"
                    major == 8 && minor >= 4 -> "8.3.2"
                    else -> "8.1.4"
                }
                useModule("com.android.tools.build:gradle:$agp")
            }
        }
    }
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "MovyzaNative"
include(":app")
