// Zerlegt das Testskript wie die App und schreibt Teile und Wortschatz für den Spracherkennungstest.
// Aufruf: node test/asr_prepare.mjs <skript.txt> <ausgabe-ordner>
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const SF = require("../web/tracker.js");
const [src, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const doc = SF.parse(fs.readFileSync(src, "utf8"), { mode: "satz" });
const parts = doc.parts.map((p) => p.text.replace(/\[[^\]]*\]/g, "").trim());
fs.writeFileSync(path.join(out, "parts.json"), JSON.stringify(parts, null, 1));
fs.writeFileSync(path.join(out, "vocab.json"), JSON.stringify(SF.vocabulary(doc)));
console.log(parts.length + " Teile, " + SF.vocabulary(doc).length + " Wörter im Wortschatz");
