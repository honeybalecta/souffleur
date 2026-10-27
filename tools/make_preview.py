"""Baut eine einzelne HTML-Vorschau der Oberfläche (ohne Mikrofon, mit Probelauf). Aufruf: python tools/make_preview.py <ziel.html>"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
W = ROOT / "web"
html = (W / "index.html").read_text(encoding="utf-8")
css = (W / "app.css").read_text(encoding="utf-8")
css = re.sub(r"@font-face\s*\{[^}]*\}\s*", "", css, count=1)

PROBE = r"""
(function () {
  "use strict";
  const listeners = new Set();
  const emit = (e) => { for (const fn of listeners) { try { fn(e); } catch (err) { console.error(err); } } };
  window.SFSpeech = emit;
  let timer = 0, active = false, paused = false, utt = [], lastPart = -1;
  function tick() {
    if (!active || paused) return;
    const s = window.SFApp && window.SFApp.peek();
    if (!s || s.done) { if (utt.length) emit({ type: "final", text: utt.join(" ") }); utt = []; return; }
    if (s.part !== lastPart && utt.length) { emit({ type: "final", text: utt.join(" ") }); utt = []; }
    lastPart = s.part;
    utt.push(s.word);
    emit({ type: "partial", text: utt.join(" ") });
    emit({ type: "level", value: 0.3 + Math.random() * 0.55 });
    let d = 290 + Math.random() * 170;
    if (s.endOfPart) { emit({ type: "final", text: utt.join(" ") }); utt = []; d = 950; setTimeout(() => emit({ type: "level", value: 0.04 }), 250); }
    timer = setTimeout(tick, d);
  }
  window.SFEngine = {
    host: "web", kind: "probe", grammar: false, level: true,
    label: "Vorschau: Hier ist das Mikrofon gesperrt, deshalb liest Souffleur probeweise selbst vor. In der Android- und der Windows-App hört es dir zu.",
    available: () => true,
    start() {
      active = true; paused = false; utt = []; clearTimeout(timer);
      emit({ type: "status", state: "loading", message: "Probelauf startet …" });
      timer = setTimeout(() => { emit({ type: "status", state: "listening" }); tick(); }, 1200);
    },
    stop() { active = false; clearTimeout(timer); emit({ type: "status", state: "off" }); },
    pause(on) {
      paused = !!on; clearTimeout(timer);
      if (!paused && active) { utt = []; emit({ type: "session" }); timer = setTimeout(tick, 400); }
    },
    mics: async () => [], setMic() {},
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
})();
"""

body = html.split("<body>", 1)[1].split("</body>", 1)[0]
body = re.sub(r'<script src="vendor/mammoth\.browser\.min\.js" defer></script>',
              '<script src="https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js" defer></script>', body)
body = body.replace('<script src="tracker.js"></script>', "<script>\n" + (W / "tracker.js").read_text(encoding="utf-8") + "\n</script>")
body = body.replace('<script src="engines.js"></script>', "<script>\n" + PROBE + "\n</script>")
body = body.replace('<script src="app.js"></script>', "<script>\n" + (W / "app.js").read_text(encoding="utf-8") + "\n</script>")
head = (
    "<title>Souffleur</title>\n"
    '<meta name="claude:viewport-fit-sides" content="cover">\n'
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400..700&display=swap">\n'
    "<style>\n" + css + "\n</style>\n"
)
Path(sys.argv[1]).write_text(head + body, encoding="utf-8")
print("Vorschau:", sys.argv[1], round(len(head + body) / 1024), "KB")
