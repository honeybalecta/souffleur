// Spielt die erkannten Ereignisse in den Abgleich ein (mit Sprechpausen-Logik wie die App) und bewertet das Ergebnis.
// Aufruf: node test/asr_check.mjs <skript.txt> <ordner> <events.json> [mindestanteil]
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const SF = require("../web/tracker.js");
const [src, work, evFile, minShareArg] = process.argv.slice(2);
const minShare = +(minShareArg || 0.9);
const doc = SF.parse(fs.readFileSync(src, "utf8"), { mode: "satz" });
const spans = JSON.parse(fs.readFileSync(path.join(work, "spans.json"), "utf8"));
const events = JSON.parse(fs.readFileSync(path.join(work, evFile), "utf8"));
const tr = new SF.Tracker(doc);
const advancedAt = new Array(doc.parts.length).fill(null); // Zeitpunkt, zu dem der Teil abgeschlossen wurde
let part = 0, lastWords = -1, early = 0, back = 0;
const note = (t) => {
  const st = tr.state();
  if (st.part < part) back++;
  for (let i = part; i < st.part; i++) if (advancedAt[i] === null) advancedAt[i] = t;
  if (st.done) for (let i = part; i < doc.parts.length; i++) if (advancedAt[i] === null) advancedAt[i] = t;
  part = st.part;
};
let lastChange = 0;
for (const e of events) {
  if (e.type !== "partial" && e.type !== "final") continue;
  // Sprechpause: nach 1,1 s ohne neue Wörter wie in der App
  if (e.t - lastChange >= 1.1) { tr.settle(); note(lastChange + 1.1); }
  const n = (e.text || "").split(/\s+/).filter(Boolean).length;
  tr.feed(e.text || "", e.type === "final");
  note(e.t);
  if (e.type === "final" || n !== lastWords) lastChange = e.t;
  lastWords = e.type === "final" ? -1 : n;
}
tr.settle(); note(events.length ? events[events.length - 1].t + 1.1 : 0);
const rows = [];
let ok = 0;
for (let i = 0; i < doc.parts.length; i++) {
  const s = spans[i], a = advancedAt[i];
  const isEarly = a !== null && a < s.end - 0.6;
  if (isEarly) early++;
  const good = a !== null && !isEarly && a <= s.end + 3;
  if (good) ok++;
  rows.push(`| ${i + 1} | ${doc.parts[i].text.slice(0, 60)} | ${s.start.toFixed(1)}–${s.end.toFixed(1)} s | ${a === null ? "–" : a.toFixed(1) + " s"} | ${a === null ? "nicht erreicht" : isEarly ? "zu früh" : (a - s.end).toFixed(1) + " s nach Satzende"} |`);
}
const share = ok / doc.parts.length;
const report = [
  `**${evFile}**: ${ok} von ${doc.parts.length} Teilen rechtzeitig weitergeschaltet (${Math.round(share * 100)} %), ${early} zu früh, ${back} Rücksprünge`,
  "", "| Teil | Text | gesprochen | weiter bei | Bewertung |", "|---|---|---|---|---|", ...rows, "",
].join("\n");
console.log(report);
fs.appendFileSync(path.join(work, "report.md"), report + "\n");
process.exit(share >= minShare ? 0 : 1);
