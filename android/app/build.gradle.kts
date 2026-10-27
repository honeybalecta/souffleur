import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val sfVersion = providers.environmentVariable("SF_VERSION").getOrElse("1.0.0").removePrefix("v")
val sfCode = providers.environmentVariable("SF_VERSION_CODE").getOrElse("1").toInt()

android {
    namespace = "de.honeybalecta.souffleur"
    compileSdk = 36

    defaultConfig {
        applicationId = "de.honeybalecta.souffleur"
        minSdk = 29
        targetSdk = 36
        versionCode = sfCode
        versionName = sfVersion
        ndk { abiFilters += listOf("arm64-v8a") }
    }

    // Signaturschlüssel aus den Repository-Secrets (siehe Workflow); ohne Schlüssel Debug-Signatur
    signingConfigs {
        create("release") {
            val ks = providers.environmentVariable("SF_KEYSTORE").orNull
            if (ks != null) {
                storeFile = file(ks)
                storePassword = providers.environmentVariable("SF_KEYSTORE_PASSWORD").get()
                keyAlias = providers.environmentVariable("SF_KEY_ALIAS").getOrElse("souffleur")
                keyPassword = providers.environmentVariable("SF_KEY_PASSWORD").orNull
                    ?: providers.environmentVariable("SF_KEYSTORE_PASSWORD").get()
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (providers.environmentVariable("SF_KEYSTORE").isPresent)
                signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    packaging {
        // JNA (für Vosk) lädt seine Bibliotheken aus dem entpackten Ordner
        jniLibs { useLegacyPackaging = true }
        resources { excludes += listOf("META-INF/*.kotlin_module") }
    }
}

kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }

dependencies {
    // Spracherkennung offline: Vosk (Kaldi) mit JNA
    implementation("com.alphacephei:vosk-android:0.3.47@aar")
    implementation("net.java.dev.jna:jna:5.13.0@aar")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
}
