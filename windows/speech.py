"""
Souffleur – Spracherkennung offline mit Vosk (für Windows und für den Test im Build).

SpeechEngine liest das Mikrofon über sounddevice und meldet Ereignisse an emit(dict):
  {"type": "status", "state": "loading|listening|paused|off|error", "message": …}
  {"type": "partial", "text": …}   laufende Äußerung (wächst noch)
  {"type": "final", "text": …}     abgeschlossene Äußerung
  {"type": "level", "value": 0…1}  Mikrofonpegel
"""
from __future__ import annotations

import json
import math
import queue
import threading
import time
import wave
from array import array
from pathlib import Path
from typing import Callable, Iterator


def make_grammar(vocab: list[str]) -> str | None:
    words = [w.strip() for w in vocab if isinstance(w, str) and w.strip()]
    if not words:
        return None
    return json.dumps(sorted(set(words)) + ["[unk]"], ensure_ascii=False)


def level_of(data: bytes) -> float:
    a = array("h")
    a.frombytes(data[: len(data) - len(data) % 2])
    if not a:
        return 0.0
    step = max(1, len(a) // 400)  # Stichprobe reicht für die Anzeige
    s = 0.0
    n = 0
    for i in range(0, len(a), step):
        v = a[i] / 32768.0
        s += v * v
        n += 1
    return min(1.0, math.sqrt(s / n) * 7.0)


class SpeechEngine:
    def __init__(self, model_dir: Path, emit: Callable[[dict], None]):
        self.model_dir = Path(model_dir)
        self.emit = emit
        self.model = None
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._running = False
        self._paused = False
        self._gen = 0
        self.device: int | None = None

    # ── Modell ──
    def load(self):
        with self._lock:
            if self.model is None:
                import vosk
                vosk.SetLogLevel(-1)
                if not (self.model_dir / "am").exists() and not (self.model_dir / "conf").exists():
                    raise RuntimeError(f"Sprachmodell fehlt ({self.model_dir})")
                self.model = vosk.Model(str(self.model_dir))
        return self.model

    def recognizer(self, rate: int, vocab: list[str] | None):
        from vosk import KaldiRecognizer
        model = self.load()
        grammar = make_grammar(vocab or [])
        if grammar:
            try:
                return KaldiRecognizer(model, rate, grammar)
            except Exception:  # noqa: BLE001 – Modell ohne Grammatik-Unterstützung
                pass
        return KaldiRecognizer(model, rate)

    def feed(self, rec, data: bytes, last_partial: str) -> str:
        """Ein Stück Audio verarbeiten; gibt das zuletzt gemeldete Teilergebnis zurück."""
        if rec.AcceptWaveform(data):
            text = json.loads(rec.Result()).get("text", "")
            self.emit({"type": "final", "text": text})
            return ""
        partial = json.loads(rec.PartialResult()).get("partial", "")
        if partial != last_partial:
            self.emit({"type": "partial", "text": partial})
        return partial

    # ── Mikrofon ──
    @staticmethod
    def mics() -> list[dict]:
        import sounddevice as sd
        try:
            default_in = sd.query_devices(kind="input")
            api = default_in["hostapi"]
        except Exception:  # noqa: BLE001
            api = None
        out = []
        for i, d in enumerate(sd.query_devices()):
            if d["max_input_channels"] > 0 and (api is None or d["hostapi"] == api):
                out.append({"id": i, "name": d["name"]})
        return out

    def start(self, vocab: list[str] | None):
        self.stop(quiet=True)
        self._running = True
        self._paused = False
        self._gen += 1
        gen = self._gen
        self._thread = threading.Thread(target=self._loop, args=(vocab, gen), name="sf-speech", daemon=True)
        self._thread.start()

    def stop(self, quiet: bool = False):
        self._running = False
        t = self._thread
        if t and t.is_alive() and t is not threading.current_thread():
            t.join(2.0)
        self._thread = None
        if not quiet:
            self.emit({"type": "status", "state": "off"})

    def pause(self, on: bool):
        if not self._running:
            return
        self._paused = bool(on)
        self.emit({"type": "status", "state": "paused" if on else "listening"})

    @property
    def running(self) -> bool:
        return self._running

    def _loop(self, vocab, gen):
        import sounddevice as sd
        stream = None
        try:
            self.emit({"type": "status", "state": "loading", "message": "Spracherkennung wird geladen …"})
            dev = self.device
            info = sd.query_devices(dev if dev is not None else None, "input")
            rate = int(info["default_samplerate"]) or 16000
            rec = self.recognizer(rate, vocab)
            q: queue.Queue[bytes] = queue.Queue(maxsize=200)

            def cb(indata, frames, t, status):  # noqa: ARG001
                try:
                    q.put_nowait(bytes(indata))
                except queue.Full:
                    pass

            def open_stream():
                s = sd.RawInputStream(samplerate=rate, blocksize=int(rate * 0.1), device=dev,
                                      dtype="int16", channels=1, callback=cb)
                s.start()
                return s

            last = ""
            tick = 0
            while self._running and gen == self._gen:
                if self._paused:
                    if stream is not None:
                        stream.stop(); stream.close(); stream = None
                    time.sleep(0.06)
                    continue
                if stream is None:
                    stream = open_stream()
                    self.emit({"type": "status", "state": "listening"})
                try:
                    data = q.get(timeout=0.25)
                except queue.Empty:
                    continue
                tick += 1
                if tick % 2 == 0:
                    self.emit({"type": "level", "value": round(level_of(data), 2)})
                last = self.feed(rec, data, last)
        except Exception as e:  # noqa: BLE001
            msg = str(e) or e.__class__.__name__
            if "Invalid" in msg or "PortAudio" in msg or "device" in msg.lower():
                msg = "Das Mikrofon lässt sich nicht öffnen (" + msg + "). Prüfe unter Windows-Einstellungen › Datenschutz › Mikrofon, ob Desktop-Apps zugreifen dürfen."
            self.emit({"type": "status", "state": "error", "message": msg})
            self._running = False
        finally:
            if stream is not None:
                try:
                    stream.stop(); stream.close()
                except Exception:  # noqa: BLE001
                    pass

    # ── Für Tests: WAV-Datei statt Mikrofon, in Echtzeit-Häppchen ──
    def run_wav(self, path: Path, vocab: list[str] | None, chunk_s: float = 0.1) -> Iterator[None]:
        with wave.open(str(path), "rb") as w:
            if w.getnchannels() != 1 or w.getsampwidth() != 2:
                raise ValueError("WAV muss mono, 16 Bit sein")
            rate = w.getframerate()
            rec = self.recognizer(rate, vocab)
            last = ""
            frames = int(rate * chunk_s)
            while True:
                data = w.readframes(frames)
                if not data:
                    break
                last = self.feed(rec, data, last)
                yield None
            text = json.loads(rec.FinalResult()).get("text", "")
            if text:
                self.emit({"type": "final", "text": text})
