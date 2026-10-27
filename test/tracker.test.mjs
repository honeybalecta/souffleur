// Tests für die Abgleich-Logik: node test/tracker.test.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const SF = require("../web/tracker.js");

let failed = 0, passed = 0;
function check(name, cond, info) {
  if (cond) { passed++; return; }
  failed++;
  console.log("✗ " + name + (info !== undefined ? "  → " + JSON.stringify(info) : ""));
}

// Zufall mit Startwert, damit Läufe reproduzierbar sind
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

const SCRIPT = `# Einstieg
Am 3. Oktober 2026 sind in ganz Deutschland Menschen auf die Straße gegangen. Die Gewerkschaften haben zu Sozialprotesten aufgerufen, z. B. in Nürnberg, Berlin und Leipzig.
[Schnitt auf Demo-Bilder]
Was sie fordern, ist nicht neu. Aber es wird lauter: Löhne, die zum Leben reichen, und Mieten, die man bezahlen kann.

## Die Reaktion
Die CDU-Fraktion spricht von Panikmache. Dr. Müller sagte im Bundestag, die Arbeiter:innen sollten sich gedulden.
Warum eigentlich? Wer seit Jahren wartet, hat ein Recht darauf, ungeduldig zu sein!
Die Zahlen sind eindeutig: Rund 3,5 Millionen Menschen arbeiten im Niedriglohnsektor.

## Schluss
Solidarität heißt, verlässlich zu sein. Genau darum geht es im 21. Jahrhundert.`;

// ── Zerlegen ──
const doc = SF.parse(SCRIPT, { mode: "satz" });
const texts = doc.parts.map((p) => p.text);
check("Kapitel erkannt", doc.chapters.length === 3 && doc.chapters[1].title === "Die Reaktion", doc.chapters);
check("Datum trennt keinen Satz", texts[0].startsWith("Am 3. Oktober 2026") && texts[0].endsWith("gegangen."), texts[0]);
check("z. B. trennt keinen Satz", texts[1].includes("z. B. in Nürnberg"), texts[1]);
check("Regieanweisung wandert zum nächsten Teil", doc.parts[2].lead === "[Schnitt auf Demo-Bilder]" && texts[2].startsWith("Was sie fordern"), doc.parts[2]);
check("Dr. trennt keinen Satz", texts.some((t) => t.startsWith("Dr. Müller sagte")), texts);
check("21. Jahrhundert bleibt zusammen", texts[texts.length - 1] === "Genau darum geht es im 21. Jahrhundert.", texts[texts.length - 1]);
check("Fragezeichen trennt", texts.includes("Warum eigentlich?"), texts);
check("Kapitel zeigen auf Teile", doc.chapters[1].firstPart === doc.parts.findIndex((p) => p.text.startsWith("Die CDU")), doc.chapters);
const absatz = SF.parse(SCRIPT, { mode: "absatz" });
check("Absatzmodus: eine Zeile je Teil", absatz.parts.length === 6, absatz.parts.map((p) => p.text));

const tok = (s) => doc.tokens.filter((t) => t.norm === s);
check("Gendern mit Doppelpunkt zusammengezogen", tok("arbeiterinnen").length === 1);
check("Bindestrich teilt", tok("cdu").length === 1 && tok("fraktion").length === 1);
check("Kürzel und Zahlen sind weich", tok("cdu")[0].soft && doc.tokens.find((t) => t.norm === "35").soft && doc.tokens.find((t) => t.norm === "2026").soft);
check("Wortschatz ohne Zahlen", !SF.vocabulary(doc).some((w) => /\d/.test(w)) && SF.vocabulary(doc).includes("solidarität"));
check("Gehörtes normalisiert", JSON.stringify(SF.heardWords("Sachsen-Anhalt [unk] Straße")) === JSON.stringify(["sachsen", "anhalt", "strasse"]));

// ── Hilfen zum Simulieren ──
// So spricht ein Mensch das Skript; Zahlen und Kürzel werden ausgesprochen wie Vosk sie liefern würde
const SPOKEN = { "2026": "zweitausendsechsundzwanzig", "3": "dritten", "35": "drei komma fünf", "21": "einundzwanzigsten", cdu: "c d u", zb: "zum beispiel", dr: "doktor" };
function spokenWords(part) {
  const out = [];
  for (let i = part.tokenStart; i < part.tokenEnd; i++) {
    const t = doc.tokens[i];
    if (SPOKEN[t.norm]) out.push(...SPOKEN[t.norm].split(" "));
    else out.push(t.lex || t.norm);
  }
  return out;
}

const SIMILAR = { die: "sie", das: "dass", ist: "es", wird: "wir", sind: "sind", recht: "rechts" };
function noisy(words, rand, rate) {
  const out = [];
  for (const w of words) {
    const r = rand();
    if (r < rate * 0.4) continue;                                        // verschluckt
    if (r < rate * 0.8) { out.push(SIMILAR[w] || (w.length > 4 ? w.slice(0, -1) + "e" : w)); continue; } // verhört
    out.push(w);
    if (r > 1 - rate * 0.2) out.push(["äh", "und", "also"][Math.floor(rand() * 3)]);  // eingeschoben
  }
  return out;
}

/** Vosk-artig einspeisen: Teilergebnisse wachsen Wort für Wort, Äußerungen enden an Kommas/Satzenden. */
function speak(tr, words, opts = {}) {
  const log = [];
  let utt = [];
  const flush = (final) => { log.push(tr.feed(utt.slice(), final)); if (final) utt = []; };
  words.forEach((w, i) => {
    utt.push(w);
    flush(false);
    if (opts.breakEvery && (i + 1) % opts.breakEvery === 0) flush(true);
  });
  if (utt.length) flush(true);
  if (opts.pause !== false) log.push(tr.settle());
  return log;
}

// ── Sauber vorgelesen ──
{
  const tr = new SF.Tracker(doc);
  const visited = [0];
  for (const p of doc.parts) {
    for (const r of speak(tr, spokenWords(p), { breakEvery: 7 })) if (r.part !== visited[visited.length - 1]) visited.push(r.part);
  }
  check("Sauber: alle Teile nacheinander", visited.join() === doc.parts.map((p) => p.index).join() || visited.join() === doc.parts.map((p) => p.index).concat(doc.parts.length - 1).join(), visited);
  check("Sauber: am Ende angekommen", tr.state().done, tr.state());
}

// ── Mit Erkennungsfehlern (viele Durchläufe) ──
{
  let ok = 0, backJumps = 0, runs = 60;
  const reached = [];
  for (let seed = 1; seed <= runs; seed++) {
    const rand = rng(seed);
    const tr = new SF.Tracker(doc);
    let prev = 0, maxPart = 0;
    for (const p of doc.parts) {
      for (const r of speak(tr, noisy(spokenWords(p), rand, 0.25), { breakEvery: 3 + Math.floor(rand() * 6) })) {
        if (r.part < prev) backJumps++;
        prev = r.part; maxPart = Math.max(maxPart, r.part);
      }
    }
    if (tr.state().done || tr.state().part === doc.parts.length - 1 && tr.state().progress > 0.5) ok++;
    reached.push(maxPart);
  }
  check("Fehlerhaft (25 %): fast immer bis zum Schluss", ok >= runs * 0.9, { ok, runs, reached });
  check("Fehlerhaft: keine Rücksprünge", backJumps === 0, backJumps);
}

// ── Erkennung mit Grammatik: Fehler sind oft andere Skriptwörter ──
{
  const big = SF.parse([SCRIPT, SCRIPT, SCRIPT].join("\n"));
  const vocab = SF.vocabulary(big);
  let ok = 0, back = 0, early = 0;
  const runs = 40;
  for (let seed = 1; seed <= runs; seed++) {
    const rand = rng(seed * 97);
    const tr = new SF.Tracker(big);
    let prev = 0;
    for (const p of big.parts) {
      const w = [];
      for (let i = p.tokenStart; i < p.tokenEnd; i++) if (!big.tokens[i].soft) w.push(big.tokens[i].lex);
      const said = [];
      for (const x of w) {
        const r = rand();
        if (r < 0.09) continue;
        if (r < 0.22) { said.push(vocab[Math.floor(rand() * vocab.length)]); continue; }
        said.push(x);
        if (r > 0.96) said.push(vocab[Math.floor(rand() * vocab.length)]);
      }
      let utt = [];
      said.forEach((x, i) => {
        utt.push(x);
        const r = tr.feed(utt.slice(), false);
        if (r.part < prev) back++;
        if (r.part > p.index && i < said.length - 3) early++;
        prev = r.part;
        if ((i + 1) % 5 === 0) { tr.feed(utt.slice(), true); utt = []; }
      });
      if (utt.length) tr.feed(utt.slice(), true);
      prev = tr.settle().part;
    }
    if (tr.state().done || tr.state().part === big.parts.length - 1) ok++;
  }
  check("Grammatik-Fehler: kommt durch", ok >= runs * 0.95, ok);
  check("Grammatik-Fehler: kaum Fehlsprünge", back + early <= 4, { back, early });
}

// ── Neuanfang eines Satzes ──
{
  const tr = new SF.Tracker(doc);
  const k = doc.parts.findIndex((p) => p.text.startsWith("Wer seit Jahren"));
  tr.goto(k);
  const w = spokenWords(doc.parts[k]);
  speak(tr, w.slice(0, 6), { pause: false });
  const mid = tr.state().pos;
  speak(tr, w, { pause: false });         // noch einmal von vorn, ganz
  const st = tr.state();
  check("Neuanfang: Satz wird von vorn verfolgt und abgeschlossen", mid > doc.parts[k].tokenStart + 3 && st.part === k + 1, { mid, st, k });
}

// ── Vorigen Satz wiederholen, nachdem schon weitergeschaltet wurde ──
{
  const tr = new SF.Tracker(doc);
  const k = doc.parts.findIndex((p) => p.text.startsWith("Die CDU"));
  tr.goto(k);
  speak(tr, spokenWords(doc.parts[k]));
  check("Wiederholen: zuerst weitergeschaltet", tr.state().part === k + 1, tr.state());
  speak(tr, spokenWords(doc.parts[k]).slice(0, 6), { pause: false });
  check("Wiederholen: zurück zum vorigen Satz", tr.state().part === k, tr.state());
}

// ── Satz übersprungen ──
{
  const tr = new SF.Tracker(doc);
  const k = doc.parts.findIndex((p) => p.text.startsWith("Die CDU"));
  tr.goto(k);
  speak(tr, spokenWords(doc.parts[k + 1]).slice(0, 7), { pause: false });
  check("Übersprungen: folgt in den nächsten Satz", tr.state().part === k + 1 && tr.state().progress > 0.3, tr.state());
}

// ── Abschweifen bewegt nichts ──
{
  const tr = new SF.Tracker(doc);
  const k = doc.parts.findIndex((p) => p.text.startsWith("Solidarität"));
  tr.goto(k);
  speak(tr, "ja also ich muss kurz was trinken moment noch mal kamera läuft".split(" "), { pause: false });
  check("Abschweifen: Stand bleibt am Satzanfang", tr.state().pos - doc.parts[k].tokenStart <= 2 && tr.state().part === k, tr.state());
}

// ── Sprechpause ──
{
  const tr = new SF.Tracker(doc);
  const k = doc.parts.findIndex((p) => p.text.startsWith("Was sie fordern"));
  tr.goto(k);
  const w = spokenWords(doc.parts[k]);
  speak(tr, w.slice(0, 3));
  check("Pause mitten im Satz: kein Weiterschalten", tr.state().part === k, tr.state());
  speak(tr, w.slice(3, w.length - 1));
  check("Pause vor dem letzten Wort: weiter", tr.state().part === k + 1, tr.state());
}

// ── Zahl am Satzende: sofort weiter ──
{
  const d2 = SF.parse("Die Abstimmung war am 12. Mai 2025. Danach kam nichts mehr.");
  const tr = new SF.Tracker(d2);
  speak(tr, "die abstimmung war am zwölften mai".split(" "), { pause: false });
  check("Zahl am Ende: weiter ohne Pause", tr.state().part === 1, tr.state());
}

// ── Getrennt gehörte Wörter ──
{
  const d2 = SF.parse("Die Arbeiter:innen streiken. Der Bundestag schweigt.");
  const tr = new SF.Tracker(d2);
  speak(tr, ["die", "arbeiter", "innen", "streiken"], { pause: false });
  check("Arbeiter + innen", tr.state().part === 1, tr.state());
  speak(tr, ["der", "bundes", "tag", "schweigt"], { pause: false });
  check("Bundes + Tag", tr.state().done, tr.state());
}

// ── Von Hand springen während einer laufenden Äußerung ──
{
  const tr = new SF.Tracker(doc);
  tr.feed("am dritten oktober zweitausendsechsundzwanzig sind", false);
  tr.goto(4);
  tr.feed("am dritten oktober zweitausendsechsundzwanzig sind in ganz", false);
  check("Handsprung: alte Wörter zählen nicht neu", tr.state().part === 4 && tr.state().pos === doc.parts[4].tokenStart, tr.state());
}

// ── Lange Absätze ──
{
  const long = Array.from({ length: 8 }, (_, i) => `Absatz ${i + 1} beginnt hier. ` + "Wir reden über Löhne, Mieten, Pflege und die Frage, wer den Preis bezahlt. ".repeat(3)).join("\n");
  const d3 = SF.parse(long, { mode: "absatz" });
  const tr = new SF.Tracker(d3);
  const rand = rng(7);
  for (const p of d3.parts) {
    const w = [];
    for (let i = p.tokenStart; i < p.tokenEnd; i++) w.push(d3.tokens[i].lex || d3.tokens[i].norm);
    speak(tr, noisy(w, rand, 0.2), { breakEvery: 9 });
  }
  check("Absätze mit Wiederholungen: bis zum Ende", tr.state().done || tr.state().part === d3.parts.length - 1, tr.state());
}

// ── Geschwindigkeit ──
{
  const big = SCRIPT.repeat(40);
  const t0 = Date.now();
  const d4 = SF.parse(big);
  const tr = new SF.Tracker(d4);
  for (const p of d4.parts.slice(0, 80)) {
    const w = [];
    for (let i = p.tokenStart; i < p.tokenEnd; i++) w.push(d4.tokens[i].lex || d4.tokens[i].norm);
    speak(tr, w, { breakEvery: 12 });
  }
  const ms = Date.now() - t0;
  check("Langes Skript bleibt schnell", ms < 1500, { ms, parts: d4.parts.length, tokens: d4.tokens.length });
}

console.log(`${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
