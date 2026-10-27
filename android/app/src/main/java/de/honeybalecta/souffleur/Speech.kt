package de.honeybalecta.souffleur

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import org.vosk.LibVosk
import org.vosk.LogLevel
import org.vosk.Model
import org.vosk.Recognizer
import java.io.File
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Spracherkennung offline mit Vosk. Liest das Mikrofon selbst (16 kHz, mono), damit es keinen
 * Signalton gibt und der Pegel angezeigt werden kann. Ergebnisse gehen als JSON an [listener]:
 * {type: status|partial|final|level, …}
 */
class Speech(private val ctx: Context) {
    companion object {
        private const val TAG = "SF.Speech"
        private const val RATE = 16000
        private const val ASSET_DIR = "model-de"
    }

    fun interface Listener { fun onSpeech(json: String) }

    @Volatile var listener: Listener? = null
    @Volatile private var model: Model? = null
    private val modelLock = Any()
    private var thread: Thread? = null
    @Volatile private var running = false
    @Volatile private var paused = false
    private var generation = 0

    private fun emit(type: String, fill: JSONObject.() -> Unit = {}) {
        val o = JSONObject().put("type", type)
        o.fill()
        listener?.onSpeech(o.toString())
    }
    fun status(state: String, message: String? = null) = emit("status") {
        put("state", state)
        if (message != null) put("message", message)
    }

    /** Modell einmalig aus den Assets in den App-Speicher kopieren (bei neuem Modell erneut) und laden. */
    private fun ensureModel(): Model {
        model?.let { return it }
        synchronized(modelLock) {
            model?.let { return it }
            val id = runCatching { ctx.assets.open("$ASSET_DIR/MODEL_ID").use { it.readBytes().decodeToString().trim() } }
                .getOrElse { throw IllegalStateException("Das Sprachmodell fehlt in dieser App-Fassung") }
            val dir = File(ctx.filesDir, ASSET_DIR)
            val stamp = File(dir, ".copied")
            if (!stamp.exists() || stamp.readText() != id) {
                status("loading", "Sprachmodell wird eingerichtet …")
                dir.deleteRecursively()
                copyAssets(ASSET_DIR, dir)
                stamp.writeText(id)
            }
            LibVosk.setLogLevel(LogLevel.WARNINGS)
            return Model(dir.absolutePath).also { model = it }
        }
    }

    private fun copyAssets(path: String, dest: File) {
        val list = ctx.assets.list(path) ?: emptyArray()
        if (list.isEmpty()) {
            dest.parentFile?.mkdirs()
            runCatching { ctx.assets.open(path).use { inp -> dest.outputStream().use { inp.copyTo(it, 1 shl 16) } } }
                .onFailure { dest.mkdirs() }
        } else {
            dest.mkdirs()
            for (n in list) copyAssets("$path/$n", File(dest, n))
        }
    }

    /** Im Hintergrund vorladen, damit der erste Start schneller geht. */
    fun warmUp() {
        Thread({ runCatching { ensureModel() }.onFailure { Log.w(TAG, "Vorladen fehlgeschlagen", it) } }, "sf-warmup").start()
    }

    /** Erkennung starten. vocab: JSON-Liste der Skriptwörter (leer = freie Erkennung). */
    @Synchronized
    fun start(vocab: String) {
        stopInternal()
        running = true; paused = false
        val gen = ++generation
        thread = Thread({ loop(vocab, gen) }, "sf-speech").apply { start() }
    }

    @Synchronized
    fun stop() { stopInternal(); status("off") }

    private fun stopInternal() {
        running = false
        thread?.let { runCatching { it.join(2000) } }
        thread = null
    }

    fun pause(on: Boolean) {
        if (!running) return
        paused = on
        status(if (on) "paused" else "listening")
    }

    val isRunning: Boolean get() = running
    val isPaused: Boolean get() = paused

    private fun makeRecognizer(m: Model, vocab: String): Recognizer {
        val words = runCatching { JSONArray(vocab) }.getOrElse { JSONArray() }
        if (words.length() == 0) return Recognizer(m, RATE.toFloat())
        val g = JSONArray()
        for (i in 0 until words.length()) {
            val w = words.optString(i).trim()
            if (w.isNotEmpty()) g.put(w)
        }
        g.put("[unk]")
        return runCatching { Recognizer(m, RATE.toFloat(), g.toString()) }
            .getOrElse { Log.w(TAG, "Grammatik abgelehnt, erkenne frei", it); Recognizer(m, RATE.toFloat()) }
    }

    private fun loop(vocab: String, gen: Int) {
        var audio: AudioRecord? = null
        var rec: Recognizer? = null
        try {
            status("loading", "Spracherkennung wird geladen …")
            val m = ensureModel()
            val r = makeRecognizer(m, vocab)
            rec = r
            val minBuf = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
            val chunk = RATE / 10 // 100 ms
            val buf = ShortArray(chunk)
            var lastPartial = ""
            var tick = 0
            while (running && gen == generation) {
                if (paused) {
                    audio?.let { closeAudio(it) }
                    audio = null
                    Thread.sleep(60)
                    continue
                }
                var a = audio
                if (a == null) {
                    a = openAudio(max(minBuf, chunk * 2) * 2)
                    if (a == null) {
                        status("error", "Das Mikrofon lässt sich nicht öffnen. Nutzt eine andere App es gerade?")
                        running = false
                        break
                    }
                    audio = a
                    status("listening")
                }
                val n = a.read(buf, 0, buf.size)
                if (n < 0) { status("error", "Mikrofon meldet Fehler $n"); running = false; break }
                if (n == 0) continue
                if (++tick % 2 == 0) {
                    var sum = 0.0
                    for (i in 0 until n) { val v = buf[i] / 32768.0; sum += v * v }
                    val level = min(1.0, sqrt(sum / n) * 7.0)
                    emit("level") { put("value", (level * 100).toInt() / 100.0) }
                }
                if (r.acceptWaveForm(buf, n)) {
                    val text = JSONObject(r.result).optString("text")
                    emit("final") { put("text", text) }
                    lastPartial = ""
                } else {
                    val p = JSONObject(r.partialResult).optString("partial")
                    if (p != lastPartial) { lastPartial = p; emit("partial") { put("text", p) } }
                }
            }
        } catch (e: Throwable) {
            Log.e(TAG, "Spracherkennung", e)
            status("error", "Spracherkennung: " + (e.message ?: e.javaClass.simpleName))
            running = false
        } finally {
            audio?.let { closeAudio(it) }
            runCatching { rec?.close() }
        }
    }

    @SuppressLint("MissingPermission")
    private fun openAudio(bytes: Int): AudioRecord? {
        for (src in intArrayOf(MediaRecorder.AudioSource.VOICE_RECOGNITION, MediaRecorder.AudioSource.MIC)) {
            val a = runCatching {
                AudioRecord(src, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bytes)
            }.getOrNull() ?: continue
            if (a.state == AudioRecord.STATE_INITIALIZED) {
                runCatching { a.startRecording() }
                if (a.recordingState == AudioRecord.RECORDSTATE_RECORDING) return a
            }
            runCatching { a.release() }
        }
        return null
    }

    private fun closeAudio(a: AudioRecord) {
        runCatching { a.stop() }
        runCatching { a.release() }
    }
}
