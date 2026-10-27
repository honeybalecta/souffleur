"""Erzeugt aus web/icon.svg das Windows-Symbol (windows/souffleur.ico) und web/icon-192.png. Braucht ffmpeg (librsvg) und Pillow."""
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parent.parent
svg = (root / "web" / "icon.svg").read_text(encoding="utf-8")
with tempfile.TemporaryDirectory() as tmp:
    big = Path(tmp) / "icon.svg"
    big.write_text(svg.replace('viewBox="0 0 108 108"', 'viewBox="0 0 108 108" width="512" height="512"', 1), encoding="utf-8")
    png = Path(tmp) / "icon.png"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(big), str(png)], check=True)
    img = Image.open(png).convert("RGBA")
img.resize((192, 192), Image.LANCZOS).save(root / "web" / "icon-192.png")
img.save(root / "windows" / "souffleur.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("ok")
