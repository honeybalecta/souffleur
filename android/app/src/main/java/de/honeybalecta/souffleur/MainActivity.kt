package de.honeybalecta.souffleur

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.util.Base64
import android.util.Log
import android.view.KeyEvent
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONObject

/** Ein Fenster mit der Oberfläche; Erkennung in [Speech], Verbindung über [Bridge]. */
class MainActivity : ComponentActivity() {
    companion object {
        private const val TAG = "SF.Main"
        private const val DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        private const val MAX_IMPORT = 20 * 1024 * 1024
    }

    lateinit var web: WebView
        private set
    private val app get() = application as App
    private lateinit var bridge: Bridge
    private lateinit var root: FrameLayout
    private var prompter = false
    private var pausedByStop = false
    private var afterPermission: (() -> Unit)? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val micPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val next = afterPermission
        afterPermission = null
        if (granted) next?.invoke()
        else app.speech.status("error", "Kein Zugriff aufs Mikrofon. Erlaube ihn in den Android-Einstellungen unter Apps › Souffleur › Berechtigungen.")
    }

    private val chooser = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        val cb = fileCallback
        fileCallback = null
        cb?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res.resultCode, res.data))
    }

    fun versionName(): String = runCatching { packageManager.getPackageInfo(packageName, 0).versionName ?: "" }.getOrDefault("")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        root = FrameLayout(this)
        root.setBackgroundColor(ContextCompat.getColor(this, R.color.grund))
        setContentView(root)
        // Platz für Status- und Navigationsleiste lassen; die Tastatur schiebt die Seite zusammen
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            if (prompter) v.setPadding(0, 0, 0, 0)
            else v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)

        bridge = Bridge(this, app)
        app.speech.listener = bridge
        createWebView()
        app.speech.warmUp()

        // Zurück: erst Menüs und Ansichten schließen, dann die App in den Hintergrund
        onBackPressedDispatcher.addCallback(this) {
            web.evaluateJavascript("window.SFApp && SFApp.onBack()") { r -> if (r != "true") moveTaskToBack(true) }
        }
        handleIntent(intent)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView() {
        web = WebView(this)
        web.setBackgroundColor(ContextCompat.getColor(this, R.color.grund))
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = true
            mediaPlaybackRequiresUserGesture = false
            textZoom = 100
        }
        web.addJavascriptInterface(bridge, "SFNative")
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView?, cb: ValueCallback<Array<Uri>>?, params: FileChooserParams?): Boolean {
                if (cb == null) return false
                fileCallback?.onReceiveValue(null)
                fileCallback = cb
                val i = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                    putExtra(Intent.EXTRA_MIME_TYPES, arrayOf(DOCX, "text/plain", "text/markdown", "text/x-markdown", "application/octet-stream"))
                }
                return runCatching { chooser.launch(i); true }.getOrElse { fileCallback = null; cb.onReceiveValue(null); true }
            }
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == "127.0.0.1") return false
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                return true
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                // Ohne diese Behandlung würde Android die ganze App beenden
                Log.e(TAG, "WebView-Prozess beendet (Absturz: ${detail.didCrash()})")
                app.speech.stop()
                runCatching { root.removeView(view); view.destroy() }
                bridge.pageGone()
                createWebView()
                return true
            }
        }
        web.loadUrl(app.server.base + "index.html?app=android")
    }

    fun withMicPermission(block: () -> Unit) {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) block()
        else {
            afterPermission = block
            runCatching { micPermission.launch(Manifest.permission.RECORD_AUDIO) }
                .onFailure { app.speech.status("error", "Mikrofon-Berechtigung konnte nicht angefragt werden") }
        }
    }

    /** Im Teleprompter: Systemleisten ausblenden (Wischen vom Rand holt sie kurz zurück). */
    fun setPrompter(on: Boolean) {
        prompter = on
        val c = WindowCompat.getInsetsController(window, window.decorView)
        if (on) {
            c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            c.hide(WindowInsetsCompat.Type.systemBars())
        } else c.show(WindowInsetsCompat.Type.systemBars())
        ViewCompat.requestApplyInsets(root)
    }

    fun keepAwake(on: Boolean) {
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    /** Fernbedienungen: Selfie-Auslöser senden meist „Lauter“, Kopfhörer Medientasten. */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (prompter) {
            val cmd = when (event.keyCode) {
                KeyEvent.KEYCODE_VOLUME_UP, KeyEvent.KEYCODE_MEDIA_NEXT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> "next"
                KeyEvent.KEYCODE_VOLUME_DOWN, KeyEvent.KEYCODE_MEDIA_PREVIOUS, KeyEvent.KEYCODE_MEDIA_REWIND -> "prev"
                KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_HEADSETHOOK, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE -> "toggle"
                else -> null
            }
            if (cmd != null) {
                if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) bridge.js("window.SFApp && SFApp.key('$cmd')")
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    /** „Öffnen mit“ und „Teilen“ aus anderen Apps. */
    private fun handleIntent(intent: Intent?) {
        intent ?: return
        when (intent.action) {
            Intent.ACTION_VIEW -> intent.data?.let { importUri(it, intent.type) }
            Intent.ACTION_SEND -> {
                @Suppress("DEPRECATION")
                val uri: Uri? = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                                else intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
                if (uri != null) importUri(uri, intent.type)
                else {
                    val text = intent.getStringExtra(Intent.EXTRA_TEXT)
                    if (!text.isNullOrBlank()) {
                        val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT) ?: ""
                        bridge.js("SFApp.importText(${JSONObject.quote(text)}, ${JSONObject.quote(subject)})")
                    }
                }
            }
        }
        intent.action = null
    }

    private fun importUri(uri: Uri, mimeHint: String?) {
        Thread {
            try {
                var name = "Skript"
                runCatching {
                    contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                        if (c.moveToFirst()) c.getString(0)?.let { if (it.isNotBlank()) name = it }
                    }
                }
                val mime = contentResolver.getType(uri) ?: mimeHint ?: ""
                if (!name.contains('.')) name += if (mime.contains("wordprocessingml")) ".docx" else if (mime.contains("markdown")) ".md" else ".txt"
                val bytes = contentResolver.openInputStream(uri)!!.use { inp ->
                    val out = java.io.ByteArrayOutputStream()
                    val buf = ByteArray(1 shl 16)
                    while (true) {
                        val n = inp.read(buf); if (n < 0) break
                        out.write(buf, 0, n)
                        if (out.size() > MAX_IMPORT) throw IllegalStateException("Datei ist zu groß")
                    }
                    out.toByteArray()
                }
                val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                bridge.js("SFApp.importFile(${JSONObject.quote(name)}, \"$b64\", ${JSONObject.quote(mime)})")
            } catch (e: Exception) {
                Log.w(TAG, "Import fehlgeschlagen", e)
                bridge.js("SFApp.toast(${JSONObject.quote("Datei konnte nicht gelesen werden: " + (e.message ?: ""))})")
            }
        }.start()
    }

    override fun onStop() {
        // Im Hintergrund das Mikrofon freigeben
        if (app.speech.isRunning && !app.speech.isPaused) { app.speech.pause(true); pausedByStop = true }
        super.onStop()
    }

    override fun onStart() {
        super.onStart()
        if (pausedByStop) { pausedByStop = false; app.speech.pause(false) }
    }

    override fun onDestroy() {
        runCatching { app.speech.stop() }
        app.speech.listener = null
        runCatching { web.destroy() }
        super.onDestroy()
    }
}
