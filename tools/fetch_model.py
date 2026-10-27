"""Lädt das deutsche Vosk-Modell (klein, ~45 MB) und entpackt es nach <ziel>. Aufruf: python tools/fetch_model.py build/model-de"""
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

MODEL = "vosk-model-small-de-0.15"
URL = f"https://alphacephei.com/vosk/models/{MODEL}.zip"

dest = Path(sys.argv[1] if len(sys.argv) > 1 else "build/model-de")
cache = Path(sys.argv[2]) if len(sys.argv) > 2 else Path.home() / ".cache" / "souffleur"
cache.mkdir(parents=True, exist_ok=True)
zpath = cache / f"{MODEL}.zip"
if not zpath.exists() or zpath.stat().st_size < 10_000_000:
    print("lade", URL)
    tmp = zpath.with_suffix(".part")
    for attempt in range(3):
        try:
            with urllib.request.urlopen(URL, timeout=120) as r, open(tmp, "wb") as f:
                shutil.copyfileobj(r, f, 1 << 20)
            break
        except Exception as e:  # noqa: BLE001
            print("Versuch", attempt + 1, "fehlgeschlagen:", e)
            if attempt == 2:
                raise
    tmp.replace(zpath)
if dest.exists():
    shutil.rmtree(dest)
dest.mkdir(parents=True)
with zipfile.ZipFile(zpath) as z:
    for info in z.infolist():
        name = info.filename
        if name.endswith("/"):
            continue
        rel = Path(*Path(name).parts[1:])  # obersten Ordner weglassen
        if not rel.parts:
            continue
        target = dest / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        with z.open(info) as src, open(target, "wb") as out:
            shutil.copyfileobj(src, out)
(dest / "MODEL_ID").write_text(MODEL, encoding="utf-8")
size = sum(p.stat().st_size for p in dest.rglob("*") if p.is_file())
print(f"Modell {MODEL} in {dest} ({size / 1e6:.0f} MB)")
for p in sorted(dest.iterdir()):
    print("  ", p.name)
