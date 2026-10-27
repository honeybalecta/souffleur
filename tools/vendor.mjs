// Kopiert die Bibliotheken für die Oberfläche nach web/vendor (Word-Import, Schrift Inter).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "web", "vendor");
fs.mkdirSync(out, { recursive: true });
const copies = [
  ["node_modules/mammoth/mammoth.browser.min.js", "mammoth.browser.min.js"],
  ["node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2", "inter.woff2"],
];
for (const [src, dst] of copies) {
  const from = path.join(root, src);
  if (!fs.existsSync(from)) { console.error("fehlt: " + src); process.exit(1); }
  fs.copyFileSync(from, path.join(out, dst));
  console.log("✓ " + dst + " (" + Math.round(fs.statSync(from).size / 1024) + " KB)");
}
