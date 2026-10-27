/*
 * Souffleur – Skript zerlegen und Mitlesen.
 *
 * parse(text, {mode})  zerlegt ein Skript in Teile (Sätze oder Absätze), Kapitel (#-Zeilen)
 *                      und Regieanweisungen ([in eckigen Klammern], werden nicht gesprochen).
 * new Tracker(doc)     gleicht gehörte Wörter mit dem Skript ab und meldet, wo gerade gelesen wird.
 *
 * Läuft im Browser (window.SFTracker) und in Node (module.exports) – die Tests liegen in test/.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SFTracker = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ───────────────────────── Normalisieren ─────────────────────────

  /** Für den Vergleich: klein, Umlaute ausgeschrieben, nur Buchstaben und Ziffern. */
  function fold(s) {
    return s.toLowerCase()
      .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]/g, "");
  }

  /** Für die Erkennungs-Grammatik: klein, Umlaute bleiben, nur Buchstaben. */
  function lex(s) {
    return s.toLowerCase().replace(/[^\p{L}]/gu, "");
  }

  const STOP = new Set((
    "der die das den dem des ein eine einen einem einer eines und oder aber doch denn sondern " +
    "in im ins an am auf aus bei mit nach von vom vor zu zum zur ueber unter fuer durch gegen ohne um bis " +
    "als wie so ja nein nicht nur auch noch schon sehr ist sind war waren wird werden wurde wurden " +
    "hat haben hatte hatten sein bin bist seid es er sie wir ihr ich du man sich mich dich mir dir uns euch " +
    "ihm ihn ihnen ihre seine seinen seiner dass da wo was wer wen wem wenn ob dann mal hier dort jetzt " +
    "eben also nun kein keine keinen dieser diese dieses diesen diesem jede jeder jedes alle allem allen"
  ).split(" "));

  // Abkürzungen: kein Satzende nach diesem Wort mit Punkt; als Wort gesprochen oft anders („bzw.“ → „beziehungsweise“)
  const ABBR = new Set((
    "z b zb bzw ca dr prof nr abs art vgl ggf evtl inkl usw etc mio mrd st jh jhd s ff sog hr fr mr mrs ms " +
    "u a ua d h dh o bspw insb max min tel str gg v chr i e ie jr sen gem lt mind zzgl abb kap bd hrsg ebd aufl " +
    "bsp allg ehem gegr geb gest ggue n hl jhs mdb mdl nrw zt"
  ).split(" "));

  const MONTHS = new Set("januar februar maerz april mai juni juli august september oktober november dezember jahrhundert jahrhunderts".split(" "));

  // ───────────────────────── Zerlegen ─────────────────────────

  /** Markdown-Reste entfernen, die beim Einfügen oder Import mitkommen. */
  function cleanLine(line) {
    return line
      .replace(/\[([^\]]+)\]\((?:[^)\s]+)\)/g, "$1")      // [Text](Link)
      .replace(/(\*\*|__)(.+?)\1/g, "$2")                  // fett
      .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, "$1$2") // kursiv
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^\s*>\s?/, "")                             // Zitatblock
      .replace(/^\s*(?:[-*•–]|\d{1,3}[.)])\s+/, "")       // Aufzählung
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Einen Absatz in Sätze teilen (deutsche Abkürzungen, Ordnungszahlen, Datumsangaben). */
  function splitSentences(text) {
    const out = [];
    const re = /([.!?…]+)(["“”„»«'’)\]]*)(\s+)/g;
    let start = 0, m;
    while ((m = re.exec(text))) {
      const end = m.index + m[1].length + m[2].length;
      const before = text.slice(start, m.index);
      const next = text.slice(re.lastIndex);
      if (!isBoundary(before, m[1], next)) continue;
      const s = text.slice(start, end).trim();
      if (s) out.push(s);
      start = re.lastIndex;
    }
    const rest = text.slice(start).trim();
    if (rest) out.push(rest);
    return out;
  }

  function isBoundary(before, punct, next) {
    const nextChar = next.charAt(0);
    if (!nextChar) return false;
    // Satzanfang: Großbuchstabe, Ziffer, Anführung oder Klammer
    if (/\p{Ll}/u.test(nextChar)) return false;
    if (punct !== ".") return true;
    const lastWord = (before.match(/([\p{L}\p{N}]+)\s*$/u) || [])[1] || "";
    if (!lastWord) return true;
    const lw = fold(lastWord);
    if (ABBR.has(lw)) return false;
    if (/^\p{Lu}$/u.test(lastWord)) return false;                 // Initiale: „A. Merkel“
    if (/^\d{1,2}$/.test(lastWord)) {                             // Ordnungszahl: „3. Oktober“, „19. Jahrhundert“
      const nw = fold((next.match(/^[„"»]?([\p{L}]+)/u) || [])[1] || "");
      if (MONTHS.has(nw) || /^\d/.test(nextChar)) return false;
    }
    return true;
  }

  // Ein „Wort“ für Anzeige und Abgleich: Buchstaben/Ziffern, innen auch : - ' . , zwischen Ziffern
  const WORD_RE = /[\p{L}\p{N}]+(?:(?:[’'·:*_\-‐–]|\.(?=\p{L}\.)|\.(?=\p{N})|,(?=\p{N}))[\p{L}\p{N}]+)*\.?/gu;

  /**
   * Ein Anzeigewort in Abgleich-Teile zerlegen: Bindestriche trennen („CDU-Fraktion“ → cdu, fraktion),
   * Doppelpunkt und Apostroph verbinden („Arbeiter:innen“ → arbeiterinnen).
   */
  function wordUnits(word) {
    const w = word.replace(/\.$/, "");
    if (/\p{N}/u.test(w) && /^[\p{N}.,]+$/u.test(w)) return [{ raw: w, kind: "num" }];
    return w.split(/[\-‐–]+/).filter(Boolean).map((part) => {
      const joined = part.replace(/[:’'·*_]/g, "");
      let kind = "word";
      if (/\p{N}/u.test(joined)) kind = "num";
      else if (/\./.test(part)) kind = "abbr";                     // z.B., u.a.
      else if ((joined.match(/\p{Lu}/gu) || []).length >= 2 && joined.length <= 6 && !/^\p{Lu}\p{Ll}+$/u.test(joined)) kind = "acro";
      else if (joined.length === 1) kind = "abbr";
      else if (ABBR.has(fold(joined)) && /\.$/.test(word)) kind = "abbr";
      return { raw: joined.replace(/\./g, ""), kind };
    });
  }

  /**
   * Skript zerlegen.
   * @param {string} text
   * @param {{mode?: "satz"|"absatz"}} [opts]
   * @returns {{parts: Part[], tokens: Token[], chapters: {title: string, firstPart: number}[]}}
   */
  function parse(text, opts) {
    const mode = (opts && opts.mode) || "satz";
    const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    const chapters = [];
    const rawParts = []; // {chapter, text}
    let chapter = -1;
    for (const line of lines) {
      const h = line.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/);
      if (h) {
        chapters.push({ title: cleanLine(h[1]), firstPart: -1 });
        chapter = chapters.length - 1;
        continue;
      }
      const t = cleanLine(line);
      if (!t || /^[-–—_*=~]{3,}$/.test(t)) continue;
      const pieces = mode === "absatz" ? [t] : splitSentences(t);
      for (const p of pieces) rawParts.push({ chapter, text: p });
    }

    const parts = [], tokens = [];
    let carryNote = []; // reine Regieanweisungen wandern zum nächsten Teil
    for (const rp of rawParts) {
      const segs = segment(rp.text);
      const spoken = segs.some((s) => s.t === "w" && s.units.some((u) => u.kind !== "ignore"));
      if (!spoken) { carryNote.push(rp.text); continue; }
      const part = {
        index: parts.length, chapter: rp.chapter, text: rp.text,
        lead: carryNote.length ? carryNote.join(" ") : "", segs: [],
        tokenStart: tokens.length, tokenEnd: tokens.length, words: 0, firm: 0,
      };
      carryNote = [];
      for (const s of segs) {
        if (s.t !== "w") { part.segs.push(s); continue; }
        const a = tokens.length;
        for (const u of s.units) {
          const norm = fold(u.raw);
          if (!norm) continue;
          const soft = u.kind !== "word";
          tokens.push({ norm, lex: lex(u.raw), soft, stop: !soft && STOP.has(norm), part: part.index, seg: part.segs.length });
          if (!soft) part.firm++;
        }
        part.segs.push({ t: "w", text: s.text, a, b: tokens.length });
        part.words++;
      }
      part.tokenEnd = tokens.length;
      if (part.tokenEnd === part.tokenStart) { carryNote.push(rp.text); continue; }
      parts.push(part);
      if (rp.chapter >= 0 && chapters[rp.chapter].firstPart < 0) chapters[rp.chapter].firstPart = part.index;
    }
    if (carryNote.length && parts.length) {
      const last = parts[parts.length - 1];
      last.segs.push({ t: "s", text: " " }, { t: "n", text: carryNote.join(" ") });
    }
    // Kapitel ohne eigenen Text zeigen auf den nächsten Teil
    for (let i = chapters.length - 1, next = parts.length ? parts.length - 1 : -1; i >= 0; i--) {
      if (chapters[i].firstPart < 0) chapters[i].firstPart = next;
      else next = chapters[i].firstPart;
    }
    return { parts, tokens, chapters, mode };
  }

  /** Text eines Teils in Wörter, Zwischenraum/Satzzeichen und Regieanweisungen gliedern. */
  function segment(text) {
    const segs = [];
    const noteRe = /\[[^\]]*\]/g;
    let pos = 0, m;
    const pushText = (s) => {
      let last = 0, w;
      WORD_RE.lastIndex = 0;
      while ((w = WORD_RE.exec(s))) {
        if (w.index > last) segs.push({ t: "s", text: s.slice(last, w.index) });
        let word = w[0];
        // Satzpunkt nicht zum Wort zählen, außer bei Abkürzungen
        if (word.endsWith(".") && !ABBR.has(fold(word.slice(0, -1))) && !/\.\p{L}\.$/u.test(word)) {
          segs.push({ t: "w", text: word.slice(0, -1), units: wordUnits(word.slice(0, -1)) });
          segs.push({ t: "s", text: "." });
        } else segs.push({ t: "w", text: word, units: wordUnits(word) });
        last = w.index + w[0].length;
      }
      if (last < s.length) segs.push({ t: "s", text: s.slice(last) });
    };
    while ((m = noteRe.exec(text))) {
      if (m.index > pos) pushText(text.slice(pos, m.index));
      segs.push({ t: "n", text: m[0].slice(1, -1).trim() });
      pos = m.index + m[0].length;
    }
    if (pos < text.length) pushText(text.slice(pos));
    return segs;
  }

  /** Gehörten Text in Vergleichswörter zerlegen (gleiche Regeln wie das Skript). */
  function heardWords(text) {
    if (Array.isArray(text)) text = text.join(" ");
    const out = [];
    const s = String(text || "").replace(/\[unk\]|<unk>/gi, " ");
    WORD_RE.lastIndex = 0;
    let w;
    while ((w = WORD_RE.exec(s))) {
      for (const u of wordUnits(w[0])) {
        const f = fold(u.raw);
        if (f && f !== "unk") out.push(f);
      }
    }
    return mergeLetters(out);
  }

  /** Einzeln buchstabierte Kürzel zusammenziehen: „c d u“ → „cdu“. */
  function mergeLetters(list) {
    const out = [];
    for (let i = 0; i < list.length; i++) {
      if (list[i].length === 1 && /[a-z]/.test(list[i]) && i + 1 < list.length && list[i + 1].length === 1) {
        let j = i, w = "";
        while (j < list.length && list[j].length === 1 && /[a-z]/.test(list[j])) w += list[j++];
        out.push(w); i = j - 1;
      } else out.push(list[i]);
    }
    return out;
  }

  // ───────────────────────── Ähnlichkeit ─────────────────────────

  function lev(a, b, max) {
    if (a === b) return 0;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    let prev = new Array(lb + 1), cur = new Array(lb + 1);
    for (let j = 0; j <= lb; j++) prev[j] = j;
    for (let i = 1; i <= la; i++) {
      cur[0] = i;
      let rowMin = i;
      const ca = a.charCodeAt(i - 1);
      for (let j = 1; j <= lb; j++) {
        const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > max) return max + 1;
      const t = prev; prev = cur; cur = t;
    }
    return prev[lb];
  }

  function allowed(len) { return len <= 3 ? 0 : len <= 5 ? 1 : len <= 8 ? 2 : len <= 12 ? 3 : 4; }

  /** Passt das gehörte Wort h zum Skriptwort t? 0 = nein, 1 = ja, 0.5 = nur der Anfang (Rest folgt). */
  function similar(h, t) {
    if (h === t) return 1;
    if (!h || !t) return 0;
    if (lev(h, t, allowed(Math.max(h.length, t.length))) <= allowed(Math.max(h.length, t.length))) return 1;
    if (t.length >= 7 && h.length >= Math.max(4, Math.ceil(t.length * 0.45)) && t.startsWith(h)) return 0.5;
    return 0;
  }

  // ───────────────────────── Mitlesen ─────────────────────────

  const DEFAULTS = {
    lookahead: 6,      // so viele Skriptwörter darf ein gehörtes Wort überspringen
    tailWords: 2,      // bei einer Sprechpause weiter, wenn höchstens so viele Wörter fehlen
    minShare: 0.5,     // … und mindestens dieser Anteil des Teils gehört wurde
    resyncScore: 5,    // Mindestpunkte für einen Sprung zurück (Neuanfang) oder weit nach vorn
  };

  class Tracker {
    constructor(doc, opts) {
      this.doc = doc;
      this.opts = Object.assign({}, DEFAULTS, opts || {});
      this.matched = new Uint8Array(doc.tokens.length);
      this.goto(0);
    }

    get tokens() { return this.doc.tokens; }
    get parts() { return this.doc.parts; }

    /** Zu einem Teil springen (Tippen, Tasten, Kapitelwahl). */
    goto(partIndex) {
      const p = this.parts[Math.max(0, Math.min(partIndex, this.parts.length - 1))];
      this.pos = p ? p.tokenStart : 0;
      this.base = this.pos;          // Stand zu Beginn der laufenden Äußerung
      this.baseRecent = [];
      this.recent = [];
      this.skip = this.lastLen;      // schon gehörte Wörter dieser Äußerung nicht neu auswerten
      this.pending = null;
      for (let i = this.pos; i < this.matched.length; i++) this.matched[i] = 0;
      this.part = p ? p.index : 0;
      return this.state();
    }

    reset() { this.lastLen = 0; return this.goto(0); }

    /** Die Erkennung beginnt neu (neue Sitzung): ab dem jetzigen Stand weiter. */
    newUtterance() {
      this.base = this.pos;
      this.baseRecent = (this.recent || []).slice(-6);
      this.skip = 0; this.lastLen = 0; this.pending = null;
    }

    /** Laufende Äußerung festschreiben (Pause): bereits Gehörtes wird nicht neu ausgewertet. */
    commit() {
      this.base = this.pos;
      this.baseRecent = (this.recent || []).slice(-6);
      this.skip = this.lastLen || 0;
      this.pending = null;
    }

    partOf(pos) {
      const parts = this.parts;
      if (!parts.length) return 0;
      if (pos >= this.tokens.length) return parts.length - 1;
      return this.tokens[pos].part;
    }

    state() {
      const p = this.parts[this.part];
      const read = p ? Math.max(0, Math.min(this.pos, p.tokenEnd) - p.tokenStart) : 0;
      return {
        pos: this.pos, part: this.part, done: this.pos >= this.tokens.length,
        progress: p ? read / Math.max(1, p.tokenEnd - p.tokenStart) : 0,
      };
    }

    /**
     * Gehörtes einspeisen. words: Text oder Wortliste der laufenden Äußerung (kumulativ, wie Vosk sie liefert).
     * final = Äußerung abgeschlossen. Rückgabe: {part, pos, changed, advanced, jumped}
     */
    feed(words, final) {
      const all = Array.isArray(words) && words.every((w) => /^[a-z0-9]*$/.test(w)) ? mergeLetters(words) : heardWords(words);
      if (this.lastLen === undefined) this.lastLen = 0;
      // Deutlich kürzer als zuvor: neue Äußerung ohne Abschluss der alten (z. B. neue Erkennungssitzung)
      if (this.skip && all.length < this.skip / 2) this.newUtterance();
      const skip = Math.min(this.skip || 0, all.length);
      const list = all.slice(skip);
      const before = { pos: this.pos, part: this.part };

      // Ab dem Stand zu Beginn der Äußerung neu ausrichten (Teilergebnisse ändern sich noch)
      let pos = this.base, recent = this.baseRecent.slice(), pending = null;
      const hits = [];
      for (const w of list) {
        const r = this.step(pos, w, recent, pending, hits);
        pos = r.pos; pending = r.pending;
      }
      // Markierungen für gelesene Wörter
      for (let i = this.base; i < this.matched.length; i++) this.matched[i] = 0;
      for (const j of hits) if (j >= this.base && j < pos) this.matched[j] = 1;
      this.pos = pos;
      this.recent = recent;
      this.lastLen = all.length;
      if (final) {
        this.base = pos; this.baseRecent = recent.slice(-6); this.skip = 0; this.lastLen = 0;
      }
      this.part = this.partOf(pos);
      this.autoComplete();
      const st = this.state();
      return Object.assign(st, {
        changed: st.pos !== before.pos || st.part !== before.part,
        advanced: st.part > before.part,
        jumped: st.part < before.part || st.part > before.part + 1,
      });
    }

    /** Ein gehörtes Wort verarbeiten. */
    step(pos, w, recent, pending, hits) {
      const T = this.tokens, N = T.length;
      recent.push(w);
      if (recent.length > 6) recent.shift();
      // Rest eines geteilt gehörten Worts („arbeiter“ + „innen“)
      if (pending && similar(w, pending) === 1) return { pos, pending: null };

      const fm = this.forward(pos, w);
      if (fm && fm.strong) { hits.push(...fm.js); return { pos: fm.end, pending: fm.pending }; }
      const rs = this.resync(pos, recent);
      if (rs && rs.end !== pos && (!fm || rs.end !== fm.end)) {
        for (const j of rs.hits) hits.push(j);
        return { pos: rs.end, pending: null };
      }
      if (fm) { hits.push(...fm.js); return { pos: fm.end, pending: fm.pending }; }
      return { pos, pending: null };
    }

    /** Nächstes passendes Skriptwort ab pos suchen (kleine Auslassungen erlaubt). */
    forward(pos, w) {
      const T = this.tokens, N = T.length, look = this.opts.lookahead;
      const cur = this.parts[this.partOf(Math.min(pos, N - 1))];
      const limit = cur && pos < cur.tokenEnd ? cur.tokenEnd : N;
      let skipped = 0;
      for (let j = pos; j < N && skipped <= look; j++) {
        const t = T[j];
        const s = similar(w, t.norm);
        let hit = null;
        if (s === 1) hit = { js: [j], end: j + 1, pending: null };
        else if (s === 0.5) hit = { js: [j], end: j + 1, pending: t.norm.slice(w.length) };
        else if (j + 1 < N && !t.soft && w.length >= 6 && similar(w, t.norm + T[j + 1].norm) === 1) hit = { js: [j, j + 1], end: j + 2, pending: null };
        if (hit) {
          // Nicht über das Satzende hinweg springen, wenn davor noch mehr als ein paar Wörter fehlen
          if (hit.end >= limit && skipped > this.opts.tailWords) return null;
          const weak = t.stop || w.length <= 3;
          // In den nächsten Teil nur mit einem tragenden Wort direkt nach dem Satzende
          if (j >= limit && (weak || skipped > 1)) return null;
          if (skipped === 0) { hit.strong = !weak; return hit; }
          if (weak && skipped > 1) { /* Füllwort weit vorn: nicht springen */ }
          else if (skipped > 3 && w.length < 5) { /* kurze Wörter nur in der Nähe */ }
          else { hit.strong = !weak && w.length >= 5; return hit; }
        }
        if (!t.soft) skipped++;
      }
      return null;
    }

    /**
     * Neu ansetzen: Kette aus den letzten gehörten Wörtern im Umfeld (vorheriger bis übernächster Teil) suchen.
     * Erkennt Neuanfänge eines Satzes und übersprungene Passagen.
     */
    resync(pos, recent) {
      const T = this.tokens, parts = this.parts;
      if (!parts.length || recent.length < 3) return null;
      const cur = this.partOf(Math.min(pos, T.length - 1));
      const lo = parts[Math.max(0, cur - 1)].tokenStart;
      const hi = parts[Math.min(parts.length - 1, cur + 2)].tokenEnd;
      const H = recent.slice(-6), K = H.length;
      // best[i][j]: beste Kette, die mit H[i] ≙ T[j] endet
      const width = hi - lo;
      const best = [];
      for (let i = 0; i < K; i++) {
        const row = new Array(width);
        for (let j = 0; j < width; j++) {
          const t = T[lo + j];
          if (similar(H[i], t.norm) !== 1) { row[j] = null; continue; }
          const wgt = t.stop ? 1 : 2, ns = t.stop ? 0 : 1;
          let cell = { score: wgt, len: 1, ns, prev: null, j };
          for (let pi = Math.max(0, i - 2); pi < i; pi++) {
            const prow = best[pi];
            for (let pj = Math.max(0, j - 4); pj < j; pj++) {
              const pc = prow[pj];
              if (!pc) continue;
              let gap = 0;
              for (let g = pj + 1; g < j; g++) if (!T[lo + g].soft) gap++;
              if (gap > 2) continue;
              const sc = pc.score + wgt - 0.75 * gap - 0.75 * (i - pi - 1);
              if (sc > cell.score) cell = { score: sc, len: pc.len + 1, ns: pc.ns + ns, prev: pc, j };
            }
          }
          row[j] = cell;
        }
        best.push(row);
      }
      // Die Kette muss beim zuletzt gehörten Wort enden
      let pick = null;
      const last = best[K - 1];
      if (H[K - 1].length < 4) return null;
      for (let j = 0; j < width; j++) {
        const c = last[j];
        if (c && T[lo + j].stop) continue;          // Kette muss auf einem tragenden Wort enden
        if (!c || c.len < 3 || c.ns < 2 || c.score < this.opts.resyncScore) continue;
        const end = lo + j + 1;
        const rank = c.score - 0.03 * Math.abs(end - pos);
        if (!pick || rank > pick.rank) pick = { rank, cell: c, end };
      }
      if (!pick) return null;
      const hits = [];
      for (let c = pick.cell; c; c = c.prev) hits.push(lo + c.j);
      return { end: pick.end, hits, score: pick.cell.score };
    }

    /** Teil vollständig? Fehlen nur noch weiche Wörter (Zahlen, Kürzel), geht es sofort weiter. */
    autoComplete() {
      const p = this.parts[this.part];
      if (!p || this.pos <= p.tokenStart || this.pos >= p.tokenEnd) return false;
      for (let i = this.pos; i < p.tokenEnd; i++) if (!this.tokens[i].soft) return false;
      return this.advance();
    }

    /** Sprechpause: weiter, wenn vom aktuellen Teil nur noch wenige Wörter fehlen. */
    settle() {
      const p = this.parts[this.part];
      if (!p) return this.state();
      let missing = 0, heard = 0;
      for (let i = this.pos; i < p.tokenEnd; i++) if (!this.tokens[i].soft) missing++;
      for (let i = p.tokenStart; i < p.tokenEnd; i++) if (this.matched[i] && !this.tokens[i].soft) heard++;
      const firm = Math.max(1, p.firm);
      const before = this.part;
      const tail = Math.max(this.opts.tailWords, Math.round(firm * 0.15));
      if (this.pos > p.tokenStart && missing > 0 && missing <= tail && heard >= Math.max(1, Math.ceil(firm * this.opts.minShare))) {
        this.advance();
      }
      return Object.assign(this.state(), { advanced: this.part > before, changed: this.part !== before });
    }

    advance() {
      const p = this.parts[this.part];
      if (!p) return false;
      this.pos = this.base = p.tokenEnd;
      this.baseRecent = [];
      this.skip = this.lastLen || 0;
      this.part = Math.min(this.part + 1, this.parts.length - 1);
      if (this.pos >= this.tokens.length) this.part = this.parts.length - 1;
      return true;
    }

    /** Wortliste für die Erkennungs-Grammatik (nur echte Wörter, wie sie gesprochen werden). */
    vocabulary() {
      const set = new Set();
      for (const t of this.tokens) if (!t.soft && t.lex.length > 0) set.add(t.lex);
      return Array.from(set);
    }
  }

  function vocabulary(doc) { return Tracker.prototype.vocabulary.call({ tokens: doc.tokens }); }

  return { parse, Tracker, heardWords, fold, similar, splitSentences, vocabulary };
});
