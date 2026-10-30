package de.honeybalecta.souffleur

import android.os.Build
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import org.json.JSONObject

/**
 * Verbindung zwischen Oberfläche (JavaScript-Objekt `SFNative`) und App.
 * Erkennungsergebnisse gehen an `SFSpeech(...)`, Befehle an `SFApp.*` in der Seite.
 */
class Bridge(private val act: MainActivity, private val app: App) : Speech.Listener {
    private val main = Handler(Looper.getMainLooper())
    private var pageReady = false
    private val pending = ArrayList<String>()

    /** JavaScript in der Seite ausführen; vor dem Laden der Seite wird gepuffert. */
    fun js(code: String) = main.post {
        if (pageReady) act.web.evaluateJavascript(code, null) else pending.add(code)
    }

    fun pageGone() = main.post { pageReady = false; pending.clear() }

    override fun onSpeech(json: String) {
        main.post { if (pageReady) act.web.evaluateJavascript("window.SFSpeech&&SFSpeech($json)", null) }
    }

    @JavascriptInterface
    fun ready() = main.post {
        pageReady = true
        pending.forEach { act.web.evaluateJavascript(it, null) }
        pending.clear()
    }

    @JavascriptInterface
    fun start(vocab: String) = main.post { act.withMicPermission { app.speech.start(vocab) } }

    @JavascriptInterface
    fun stop() { app.speech.stop() }

    @JavascriptInterface
    fun pause(on: Boolean) { app.speech.pause(on) }

    @JavascriptInterface
    fun setPrompter(on: Boolean) = main.post { act.setPrompter(on) }

    @JavascriptInterface
    fun keepAwake(on: Boolean) = main.post { act.keepAwake(on) }

    /** Ringlicht: 1 = volle Helligkeit, negativ = Helligkeit des Systems. */
    @JavascriptInterface
    fun setBrightness(level: Double) = main.post { act.setBrightness(level.toFloat()) }

    @JavascriptInterface
    fun info(): String = JSONObject().apply {
        put("app", "android"); put("version", act.versionName())
        put("android", Build.VERSION.SDK_INT); put("device", Build.MODEL)
    }.toString()
}
