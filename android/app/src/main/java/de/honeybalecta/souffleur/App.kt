package de.honeybalecta.souffleur

import android.app.Application

/** Prozessweite Bestandteile: lokaler Server für die Oberfläche und die Spracherkennung. */
class App : Application() {
    lateinit var server: LocalServer
        private set
    lateinit var speech: Speech
        private set

    override fun onCreate() {
        super.onCreate()
        server = LocalServer(this).start()
        speech = Speech(this)
    }
}
