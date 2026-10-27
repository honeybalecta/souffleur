// Oberflächentest in echtem Chrome: Bibliothek → Editor → Teleprompter mit eingespielter Erkennung, Word-Import.
// Aufruf: node test/e2e.mjs <web-ordner> <ausgabe> [docx-datei]
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const [WEB, OUT, DOCX] = process.argv.slice(2).map((p) => p && path.resolve(p));
fs.mkdirSync(OUT, { recursive: true });
const R = { steps: [], errors: [] };
const step = (name, ok, info) => { R.steps.push({ name, ok, info }); console.log((ok ? "✓ " : "✗ ") + name + (info !== undefined ? "  " + JSON.stringify(info).slice(0, 300) : "")); };

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(WEB, p);
  if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(8124);
const BASE = "http://localhost:8124/index.html";

let browser;
try { browser = await chromium.launch({ channel: "chrome" }); } catch (e) { browser = await chromium.launch(); }

async function session(name, opts, fn) {
  const ctx = await browser.newContext({ viewport: opts.viewport, deviceScaleFactor: opts.scale || 1, colorScheme: opts.scheme || "light", locale: "de-DE", hasTouch: !!opts.touch, isMobile: !!opts.mobile });
  // Keine Browser-Erkennung im Test: Wörter werden über SFDemo eingespielt
  await ctx.addInitScript(() => { window.webkitSpeechRecognition = undefined; window.SpeechRecognition = undefined; });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { R.errors.push(name + ": " + String(e).slice(0, 400)); console.log("SEITENFEHLER", String(e).slice(0, 300)); });
  page.on("console", (m) => { if (m.type() === "error") R.errors.push(name + " console: " + m.text().slice(0, 300)); });
  const shot = (n) => page.screenshot({ path: path.join(OUT, `${name}-${n}.png`) });
  try { await fn(page, shot); } catch (e) { step(name + ": Ablauf", false, String(e).slice(0, 400)); await shot("fehler").catch(() => {}); }
  await ctx.close();
}

const ev = (page, fn, arg) => page.evaluate(fn, arg);
const currentPart = (page) => ev(page, () => { const el = document.querySelector("#flow .p.current"); return el ? +el.dataset.i : -1; });
async function say(page, words, final) {
  // Wort für Wort wie Vosk: wachsende Teilergebnisse, am Ende ein Abschluss
  for (let i = 1; i <= words.length; i++) {
    await ev(page, (t) => window.SFDemo(t, false), words.slice(0, i).join(" "));
    await page.waitForTimeout(40);
  }
  if (final) await ev(page, (t) => window.SFDemo(t, true), words.join(" "));
}

// ── Handy, hell ──
await session("handy", { viewport: { width: 390, height: 844 }, scale: 2, touch: true, mobile: true }, async (page, shot) => {
  await page.goto(BASE);
  await page.waitForSelector(".lib-item");
  step("Bibliothek mit Beispiel", (await page.locator(".lib-item").count()) === 1 && (await page.locator(".tag").count()) === 1);
  await shot("01-bibliothek");
  await page.click(".lib-item");
  await page.waitForSelector("#v-editor:not([hidden])");
  step("Editor zeigt Teilezahl", /Teile/.test(await page.textContent("#ed-stats")), await page.textContent("#ed-stats"));
  await shot("02-editor");
  await page.click("#tab-parts");
  await shot("03-teile");
  await page.click("#ed-start");
  await page.waitForSelector("#v-prompter:not([hidden])");
  await page.waitForTimeout(500);
  step("Teleprompter beginnt bei Teil 1", (await currentPart(page)) === 0);
  step("Ohne Erkennung: Hinweis „Nur von Hand“", (await page.textContent("#mic-text")).includes("Hand"), await page.textContent("#mic-text"));
  await say(page, ["lies", "diesen", "text"], false);
  await page.waitForTimeout(600);
  await shot("04-prompter-mitten-im-satz");
  const read = await ev(page, () => document.querySelectorAll("#flow .p.current .w.read").length);
  step("Gelesene Wörter markiert", read === 3, read);
  await say(page, ["lies", "diesen", "text", "einfach", "laut", "vor"], true);
  await page.waitForTimeout(600);
  step("Nach dem Satz weiter zu Teil 2", (await currentPart(page)) === 1, await currentPart(page));
  await say(page, "souffleur hört über das mikrofon mit und färbt jedes wort ein das du schon".split(" "), false);
  await page.waitForTimeout(1500);
  step("Sprechpause vor dem letzten Wort: weiter", (await currentPart(page)) === 2, await currentPart(page));
  await page.waitForTimeout(4200);
  await shot("05-prompter-leiste-aus");
  // Tippen rechts/links
  await page.touchscreen.tap(370, 500);
  await page.waitForTimeout(300);
  step("Tippen rechts: nächster Teil", (await currentPart(page)) === 3, await currentPart(page));
  await page.touchscreen.tap(20, 500);
  await page.waitForTimeout(300);
  step("Tippen links: voriger Teil", (await currentPart(page)) === 2, await currentPart(page));
  await page.touchscreen.tap(195, 500);
  await page.waitForTimeout(300);
  await shot("06-prompter-leiste");
  await page.click("#pr-settings");
  await page.waitForSelector("#settings[open]");
  await shot("07-einstellungen");
  await page.click('[data-setting="view"] [data-value="einzeln"]');
  await page.click('[data-setting="bg"] [data-value="green"]');
  await page.click('#settings .sheet-head button');
  await page.waitForTimeout(700);
  await shot("08-satz-fuer-satz-greenscreen");
  const visible = await ev(page, () => [...document.querySelectorAll("#flow .p")].filter((p) => getComputedStyle(p).display !== "none").length);
  step("Satz für Satz: höchstens drei Teile sichtbar", visible <= 3 && visible >= 2, visible);
  await page.click("#pr-exit");
  await page.waitForSelector("#v-editor:not([hidden])");
  step("Zurück im Editor, Stand gemerkt", await ev(page, () => document.querySelector(".part-btn.last") !== null));
});

// ── Laptop, dunkel ──
await session("laptop", { viewport: { width: 1366, height: 800 }, scheme: "dark" }, async (page, shot) => {
  await page.goto(BASE);
  await page.waitForSelector(".lib-item");
  await shot("01-bibliothek");
  await page.click("#lib-new");
  await page.fill("#ed-title", "Die bestellte Schuld");
  await page.fill("#ed-text", [
    "# Einstieg",
    "Am 17. Oktober gingen in Frankreich Schüler:innen auf die Straße. Die Polizei antwortete mit Gewalt.",
    "[Einblendung: Videoausschnitt]",
    "In den deutschen Medien las man davon fast nichts. Warum eigentlich?",
    "## Die Berichterstattung",
    "Der Spiegel schrieb von Krawallen, z. B. in Lyon und Marseille. Wer genau hinsah, sah etwas anderes.",
  ].join("\n"));
  await page.waitForTimeout(500);
  await shot("02-editor");
  const parts = await page.locator(".part-btn").count();
  step("Eigenes Skript: Teile erkannt", parts === 6, parts);
  await page.keyboard.press("Tab");
  await page.click(".part-btn >> nth=0");
  await page.waitForSelector("#v-prompter:not([hidden])");
  await page.waitForTimeout(500);
  await say(page, "am siebzehnten oktober gingen in frankreich schülerinnen auf".split(" "), false);
  await page.waitForTimeout(700);
  await page.mouse.move(600, 400);
  await shot("03-prompter");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(200);
  step("Pfeil rechts: nächster Teil", (await currentPart(page)) === 1);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(500);
  step("Scrollrad: nächster Teil", (await currentPart(page)) === 2, await currentPart(page));
  await page.keyboard.press("m");
  await page.waitForTimeout(500);
  await shot("04-gespiegelt");
  await page.keyboard.press("m");
  await page.keyboard.press("End");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#v-editor:not([hidden])");
  if (DOCX && fs.existsSync(DOCX)) {
    await page.click("#ed-back");
    await page.waitForSelector("#v-library:not([hidden])");
    await page.setInputFiles("#file-input", DOCX);
    await page.waitForSelector("#v-editor:not([hidden])");
    await page.waitForTimeout(400);
    const text = await page.inputValue("#ed-text");
    step("Word-Import: Überschrift wird Kapitel", /^# Kapitel eins/m.test(text), text.slice(0, 200));
    step("Word-Import: kursiver Absatz wird Regieanweisung", /\[Hier Bild einblenden\.?\]/.test(text), text);
    step("Word-Import: Titel aus Dateiname", (await page.inputValue("#ed-title")) === "Testskript");
    await shot("05-word-import");
  }
});

await browser.close();
server.close();
step("Keine Seitenfehler", R.errors.length === 0, R.errors);
fs.writeFileSync(path.join(OUT, "e2e.json"), JSON.stringify(R, null, 2));
const failed = R.steps.filter((s) => !s.ok).length;
console.log(`${R.steps.length - failed} von ${R.steps.length} Schritten in Ordnung`);
process.exit(failed ? 1 : 0);
