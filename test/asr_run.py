"""
Spracherkennungstest: spricht das Testskript mit espeak-ng, erkennt es mit Vosk (wie die Apps)
und schreibt die Ereignisse mit Zeitstempel. Aufruf:
  python test/asr_run.py <modell> <ordner mit parts.json/vocab.json> [--frei]
"""
import json
import subprocess
import sys
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "windows"))
from speech import SpeechEngine  # noqa: E402

model_dir, work = Path(sys.argv[1]), Path(sys.argv[2])
free = "--frei" in sys.argv
parts = json.loads((work / "parts.json").read_text(encoding="utf-8"))
vocab = None if free else json.loads((work / "vocab.json").read_text(encoding="utf-8"))

# Sprache erzeugen: jeder Teil einzeln, dazwischen 1,4 s Pause (wie beim Absetzen nach einem Satz)
wav = work / "skript.wav"
if not wav.exists():
    frames, rate, spans = [], 16000, []
    t = 0.5
    silence = lambda s: b"\0\0" * int(rate * s)  # noqa: E731
    frames.append(silence(0.5))
    for i, text in enumerate(parts):
        f = work / f"teil{i}.wav"
        subprocess.run(["espeak-ng", "-v", "de", "-s", "150", "-w", str(f), text], check=True)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(f), "-ar", str(rate), "-ac", "1", str(f) + ".16k.wav"], check=True)
        with wave.open(str(f) + ".16k.wav", "rb") as w:
            data = w.readframes(w.getnframes())
        dur = len(data) / 2 / rate
        spans.append({"part": i, "start": round(t, 2), "end": round(t + dur, 2)})
        frames.append(data)
        frames.append(silence(1.4))
        t += dur + 1.4
    with wave.open(str(wav), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(b"".join(frames))
    (work / "spans.json").write_text(json.dumps(spans), encoding="utf-8")

events = []
clock = {"t": 0.0}
eng = SpeechEngine(model_dir, lambda e: events.append({**e, "t": round(clock["t"], 2)}))
for _ in eng.run_wav(wav, vocab, 0.1):
    clock["t"] += 0.1
name = "events-frei.json" if free else "events.json"
(work / name).write_text(json.dumps(events, ensure_ascii=False), encoding="utf-8")
finals = [e["text"] for e in events if e["type"] == "final"]
print(f"{'frei' if free else 'mit Grammatik'}: {len(events)} Ereignisse, {len(finals)} Abschlüsse")
for f in finals:
    print("  »" + f + "«")
