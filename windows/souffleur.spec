# PyInstaller-Bauplan für Souffleur (Windows, Ordner-Build)
# Aufruf aus dem Projektordner:  pyinstaller windows/souffleur.spec
from pathlib import Path
from PyInstaller.utils.hooks import collect_all

HERE = Path(SPECPATH)
ROOT = HERE.parent
datas = [(str(ROOT / "web"), "web"), (str(HERE / "souffleur.ico"), ".")]
for src, dst in ((ROOT / "build" / "model-de", "model-de"), (ROOT / "build" / "app-version.txt", ".")):
    if src.exists():
        datas.append((str(src), dst))
binaries, hiddenimports = [], ["speech", "souffleur_app"]
for pkg in ("vosk", "sounddevice", "_sounddevice_data", "webview", "clr_loader", "pythonnet", "cffi"):
    try:
        d, b, h = collect_all(pkg)
        datas += d; binaries += b; hiddenimports += h
    except Exception as e:
        print("collect_all", pkg, e)

a = Analysis([str(HERE / "app_entry.py")], pathex=[str(HERE)], binaries=binaries, datas=datas,
             hiddenimports=hiddenimports, excludes=["matplotlib", "PyQt5", "PySide6", "IPython", "pytest", "tkinter", "numpy"],
             noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="Souffleur", console=False,
          icon=str(HERE / "souffleur.ico"))
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="Souffleur")
