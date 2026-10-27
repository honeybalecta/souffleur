"""Erzeugt windows/souffleur.ico aus dem Symbol (drei Zeilen, die mittlere rot) – ohne Zusatzpakete."""
import struct, zlib
from pathlib import Path

BG, CREME, ROT, GRAU = (0x13, 0x13, 0x12), (0xED, 0xE7, 0xDA), (0xE5, 0x40, 0x2A), (0xA9, 0xA3, 0x97)
SHAPES = [((0, 0, 108, 108, 24), BG), ((30, 34, 78, 44, 5), CREME), ((30, 49, 62, 59, 5), ROT), ((30, 64, 70, 74, 5), GRAU)]

def inside(x, y, r):
    x0, y0, x1, y1, rad = r
    if x < x0 or x >= x1 or y < y0 or y >= y1:
        return False
    cx = min(max(x, x0 + rad), x1 - rad)
    cy = min(max(y, y0 + rad), y1 - rad)
    return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad

def render(size, ss=4):
    px = []
    for j in range(size):
        row = []
        for i in range(size):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sj in range(ss):
                for si in range(ss):
                    x = (i + (si + 0.5) / ss) * 108 / size
                    y = (j + (sj + 0.5) / ss) * 108 / size
                    col = None
                    for r, c in SHAPES:
                        if inside(x, y, r):
                            col = c
                    if col:
                        acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2]; acc[3] += 255
            n = ss * ss
            a = acc[3] / n
            if a > 0:
                row.append((round(acc[0] / (acc[3] / 255)), round(acc[1] / (acc[3] / 255)), round(acc[2] / (acc[3] / 255)), round(a)))
            else:
                row.append((0, 0, 0, 0))
        px.append(row)
    return px

def png(px):
    h, w = len(px), len(px[0])
    raw = b"".join(b"\0" + bytes(v for p in row for v in p) for row in px)
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")

sizes = [16, 24, 32, 48, 64, 128, 256]
imgs = [png(render(s, 4 if s <= 64 else 2)) for s in sizes]
out = struct.pack("<HHH", 0, 1, len(imgs))
off = 6 + 16 * len(imgs)
for s, d in zip(sizes, imgs):
    out += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(d), off)
    off += len(d)
out += b"".join(imgs)
root = Path(__file__).resolve().parent.parent
(root / "windows" / "souffleur.ico").write_bytes(out)
(root / "web" / "icon-192.png").write_bytes(png(render(192, 2)))
print("ok", len(out))
