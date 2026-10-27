"""
Souffleur für Windows: eigenes Programmfenster (Edge WebView2) mit Offline-Spracherkennung (Vosk).

Start: pythonw souffleur_app.py      Selbsttest: souffleur_app.py --selftest bericht.json
"""
from __future__ import annotations

import http.server
import json
import os
import socket
import sys
import threading
import traceback
import urllib.request
from functools import partial
from pathlib import Path

FROZEN = bool(getattr(sys, "frozen", False))
HERE = Path(__file__).resolve().parent
ROOT = Path(getattr(sys, "_MEIPASS", HERE)) if FROZEN else HERE.parent
WEB_DIR = ROOT / "web"
MODEL_DIR = ROOT / "model-de" if FROZEN else ROOT / "build" / "model-de"
DATA_DIR = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "Souffleur"
PORT = 47353  # fest, damit die gespeicherten Skripte (Browserspeicher) erhalten bleiben
TITLE = "Souffleur"

sys.path.insert(0, str(HERE))
from speech import SpeechEngine  # noqa: E402


def fail(msg: str):
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, msg, TITLE, 0x10)
    except Exception:  # noqa: BLE001
        print(msg, file=sys.stderr)
    sys.exit(1)


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2",
        ".webmanifest": "application/manifest+json", ".json": "application/json", ".html": "text/html",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):  # still
        pass


def port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return False
        except OSError:
            return True


def make_server(port: int):
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=str(WEB_DIR)))
    srv.daemon_threads = True
    return srv


def keep_awake(on: bool):
    try:
        import ctypes
        ES_CONTINUOUS, ES_SYSTEM_REQUIRED, ES_DISPLAY_REQUIRED = 0x80000000, 0x00000001, 0x00000002
        flags = ES_CONTINUOUS | (ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED if on else 0)
        ctypes.windll.kernel32.SetThreadExecutionState(flags)
    except Exception:  # noqa: BLE001
        pass


class Api:
    """Aufrufbar aus der Seite als window.pywebview.api.* (Rückgaben werden zu Promises)."""

    def __init__(self, engine: SpeechEngine):
        self._engine = engine
        self._window = None

    def ready(self):
        threading.Thread(target=self._warm, daemon=True).start()
        return True

    def _warm(self):
        try:
            self._engine.load()
        except Exception:  # noqa: BLE001
            pass

    def start(self, vocab_json: str = "[]"):
        try:
            vocab = json.loads(vocab_json or "[]")
        except ValueError:
            vocab = []
        self._engine.start(vocab)
        return True

    def stop(self):
        self._engine.stop()
        return True

    def pause(self, on: bool):
        self._engine.pause(bool(on))
        return True

    def mics(self):
        try:
            return json.dumps(SpeechEngine.mics(), ensure_ascii=False)
        except Exception:  # noqa: BLE001
            return "[]"

    def set_mic(self, mic_id: str = ""):
        self._engine.device = int(mic_id) if str(mic_id).strip().isdigit() else None
        return True

    def set_prompter(self, on: bool):
        return True

    def fullscreen(self):
        try:
            self._window.toggle_fullscreen()
        except Exception:  # noqa: BLE001
            return False
        return True

    def keep_awake(self, on: bool):
        keep_awake(bool(on))
        return True

    def info(self):
        return json.dumps({"app": "windows", "version": app_version()})


def app_version() -> str:
    for p in (ROOT / "app-version.txt", HERE / "app-version.txt"):
        if p.exists():
            return p.read_text(encoding="utf-8").strip()
    return "dev"


def selftest(out_path: str) -> int:
    """Prüft im Build, ob alles Nötige im Paket steckt (läuft ohne Fenster)."""
    rep: dict = {"version": app_version(), "frozen": FROZEN}
    ok = True
    rep["web"] = all((WEB_DIR / f).exists() for f in ("index.html", "app.js", "tracker.js", "engines.js"))
    rep["vendor"] = {f: (WEB_DIR / "vendor" / f).exists() for f in ("mammoth.browser.min.js", "inter.woff2")}
    ok &= rep["web"]
    try:
        events = []
        eng = SpeechEngine(MODEL_DIR, events.append)
        eng.load()
        rec = eng.recognizer(16000, ["guten", "morgen", "souffleur"])
        eng.feed(rec, b"\0\0" * 16000, "")
        rep["vosk"] = "ok"
    except Exception:  # noqa: BLE001
        rep["vosk"] = traceback.format_exc()[-1200:]
        ok = False
    try:
        import sounddevice as sd  # lädt PortAudio
    except Exception:  # noqa: BLE001
        rep["sounddevice"] = traceback.format_exc()[-800:]
        ok = False
    else:
        try:
            rep["sounddevice"] = f"ok, {len(sd.query_devices())} Geräte"
        except Exception as e:  # noqa: BLE001 – Build-Rechner ohne Audiogeräte
            rep["sounddevice"] = f"geladen, keine Geräte abfragbar: {e}"
    try:
        import webview  # noqa: F401
        rep["webview"] = "ok"
    except Exception:  # noqa: BLE001
        rep["webview"] = traceback.format_exc()[-800:]
        ok = False
    rep["ok"] = bool(ok)
    Path(out_path).write_text(json.dumps(rep, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0 if ok else 1


def main():
    args = sys.argv[1:]
    if args[:1] == ["--selftest"]:
        sys.exit(selftest(args[1] if len(args) > 1 else "selftest.json"))

    try:
        import webview  # pywebview
    except ImportError:
        fail("Für das Programmfenster fehlt „pywebview“.")
    if not (WEB_DIR / "index.html").exists():
        fail(f"Die Oberfläche fehlt ({WEB_DIR}).")

    if port_in_use(PORT):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/index.html", timeout=1) as r:
                if b"Souffleur" in r.read(4000):
                    fail("Souffleur ist schon geöffnet.")
        except Exception:  # noqa: BLE001
            pass
        fail(f"Der lokale Port {PORT} ist belegt. Bitte ein anderes Programm schließen und Souffleur neu starten.")

    srv = make_server(PORT)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    try:  # eigenes Taskleisten-Symbol statt dem von Python
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("Souffleur.App")
    except Exception:  # noqa: BLE001
        pass

    holder: dict = {}

    def emit(evt: dict):
        w = holder.get("window")
        if not w:
            return
        code = "window.SFSpeech&&SFSpeech(" + json.dumps(evt, ensure_ascii=False) + ")"
        try:
            (w.run_js if hasattr(w, "run_js") else w.evaluate_js)(code)
        except Exception:  # noqa: BLE001
            pass

    engine = SpeechEngine(MODEL_DIR, emit)
    api = Api(engine)
    window = webview.create_window(TITLE, f"http://127.0.0.1:{PORT}/index.html?app=windows", js_api=api,
                                   width=1280, height=820, min_size=(720, 520), background_color="#131312")
    api._window = window
    holder["window"] = window

    def on_closing():
        engine.stop(quiet=True)
        keep_awake(False)
        return True

    window.events.closing += on_closing
    icon = ROOT / "souffleur.ico"
    try:
        webview.start(private_mode=False, storage_path=str(DATA_DIR / "webview"),
                      icon=str(icon) if icon.exists() else None)
    except TypeError:
        webview.start(private_mode=False, storage_path=str(DATA_DIR / "webview"))
    srv.shutdown()


if __name__ == "__main__":
    main()
