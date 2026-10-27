/* Souffleur – Oberfläche: Bibliothek, Editor, Teleprompter */
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const Engine = window.SFEngine;
  const native = window.SFNative || null;

  // ───────────────────────── Speicher ─────────────────────────
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { toast("Speichern nicht möglich: " + e.message); return false; } },
  };

  const DEFAULTS = {
    fontSize: Math.round(clamp(Math.min(innerWidth, innerHeight * 1.6) / 16, 30, 72)),
    measure: 18, line: 33, view: "fluss", bg: "anthrazit", mirror: "aus",
    pause: true, grammar: true, heard: false, mic: "",
  };
  const settings = Object.assign({}, DEFAULTS, store.get("sf.settings", {}));
  const saveSettings = () => store.set("sf.settings", settings);

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  let scripts = store.get("sf.scripts", null);
  if (!Array.isArray(scripts)) { scripts = [exampleScript()]; saveScripts(); }
  function saveScripts() { store.set("sf.scripts", scripts); }

  function exampleScript() {
    return {
      id: newId(), example: true, mode: "satz", updated: Date.now(), lastPart: 0,
      title: "So funktioniert Souffleur",
      text: [
        "# Mitlesen",
        "Lies diesen Text einfach laut vor.",
        "Souffleur hört über das Mikrofon mit und färbt jedes Wort ein, das du schon gesagt hast.",
        "Sobald ein Satz fertig ist, springt die Anzeige zum nächsten.",
        "[Regieanweisungen in eckigen Klammern werden angezeigt, aber nicht mitgelesen.]",
        "Wenn du dich versprichst, fang den Satz einfach noch einmal an. Souffleur geht mit zurück.",
        "",
        "## Von Hand steuern",
        "Tippe rechts für den nächsten Teil und links für den vorigen.",
        "Pfeiltasten, eine Fernbedienung oder ein Scrollring funktionieren genauso.",
        "Mit der Leertaste schaltest du das Mitlesen aus und wieder ein.",
        "",
        "## Eigene Texte",
        "Füge dein Skript ein oder öffne eine Word-Datei.",
        "Überschriften mit einer Raute werden zu Kapiteln, kursive Absätze aus Word zu Regieanweisungen.",
      ].join("\n"),
    };
  }

  // ───────────────────────── Allgemeines ─────────────────────────
  let toastTimer = 0;
  function toast(msg, ms) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms || 3200);
  }

  function show(view) {
    for (const v of ["library", "editor", "prompter"]) $("#v-" + v).hidden = v !== view;
    current.view = view;
    if (native && native.setPrompter) try { native.setPrompter(view === "prompter"); } catch (e) { /* */ }
    if (Engine.host === "windows" && Engine.call) Engine.call("set_prompter", view === "prompter");
  }

  const current = { view: "library", script: null, doc: null };

  function stats(doc) {
    let words = 0;
    for (const t of doc.tokens) if (!t.soft || /\d/.test(t.norm)) words++;
    const min = Math.max(1, Math.round(words / 140));
    return { parts: doc.parts.length, chapters: doc.chapters.length, words, min };
  }
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

  function relTime(ts) {
    const d = new Date(ts), now = new Date();
    const days = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 864e5);
    if (days === 0) return "heute " + d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    if (days === 1) return "gestern";
    if (days < 7) return "vor " + days + " Tagen";
    return d.toLocaleDateString("de-DE", { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
  }

  // ───────────────────────── Bibliothek ─────────────────────────
  function renderLibrary() {
    scripts.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const ul = $("#lib-list");
    ul.innerHTML = "";
    $("#lib-empty").hidden = scripts.length > 0;
    for (const s of scripts) {
      const doc = SFTracker.parse(s.text, { mode: s.mode });
      const st = stats(doc);
      const li = document.createElement("li");
      const meta = [plural(st.parts, "Teil", "Teile"), "ca. " + st.min + " Min"];
      if (s.lastPart > 0 && s.lastPart < st.parts) meta.push("zuletzt bei Teil " + (s.lastPart + 1));
      meta.push(relTime(s.updated || Date.now()));
      li.innerHTML = `<button class="lib-item" data-id="${esc(s.id)}">
        <span class="lib-title">${s.example ? '<span class="tag">Beispiel</span>' : ""}${esc(s.title || "Ohne Titel")}</span>
        <span class="lib-meta">${esc(meta.join(" · "))}</span>
        <svg class="lib-go" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>`;
      ul.appendChild(li);
    }
  }

  $("#lib-list").addEventListener("click", (e) => {
    const b = e.target.closest(".lib-item");
    if (b) openEditor(scripts.find((s) => s.id === b.dataset.id));
  });
  $("#lib-new").addEventListener("click", () => {
    const s = { id: newId(), title: "", text: "", mode: "satz", updated: Date.now(), lastPart: 0 };
    scripts.push(s); saveScripts();
    openEditor(s);
    $("#ed-text").focus();
  });

  // ───────────────────────── Editor ─────────────────────────
  let parseTimer = 0, saveTimer = 0;

  function openEditor(s) {
    if (!s) return;
    current.script = s;
    $("#ed-title").value = s.title || "";
    $("#ed-text").value = s.text || "";
    setMode(s.mode || "satz", false);
    $("#ed-delete-confirm").hidden = true; $("#ed-delete").hidden = false;
    setTab("text");
    reparse();
    show("editor");
  }

  function setMode(mode, persist) {
    for (const b of $$(".ed-tools [data-mode]")) b.setAttribute("aria-checked", String(b.dataset.mode === mode));
    if (current.script) current.script.mode = mode;
    if (persist !== false) { touch(); reparse(); }
  }
  for (const b of $$(".ed-tools [data-mode]")) b.addEventListener("click", () => setMode(b.dataset.mode));

  function setTab(tab) {
    $(".ed-body").dataset.tab = tab;
    $("#tab-text").setAttribute("aria-selected", String(tab === "text"));
    $("#tab-parts").setAttribute("aria-selected", String(tab === "parts"));
  }
  $("#tab-text").addEventListener("click", () => setTab("text"));
  $("#tab-parts").addEventListener("click", () => { reparse(); setTab("parts"); });

  function touch() {
    const s = current.script;
    if (!s) return;
    s.updated = Date.now();
    if (s.example) s.example = false;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveScripts, 500);
  }

  $("#ed-text").addEventListener("input", () => {
    current.script.text = $("#ed-text").value;
    touch();
    clearTimeout(parseTimer);
    parseTimer = setTimeout(reparse, 250);
  });
  $("#ed-title").addEventListener("input", () => { current.script.title = $("#ed-title").value; touch(); });

  function reparse() {
    const s = current.script;
    current.doc = SFTracker.parse(s.text, { mode: s.mode });
    const doc = current.doc, st = stats(doc);
    $("#ed-stats").textContent = doc.parts.length
      ? [plural(st.parts, "Teil", "Teile"), st.chapters ? plural(st.chapters, "Kapitel", "Kapitel") : null, "ca. " + st.min + " Min"].filter(Boolean).join(" · ")
      : "Noch kein Text";
    const ol = $("#ed-parts");
    const frag = document.createDocumentFragment();
    let chap = -2;
    for (const p of doc.parts) {
      if (p.chapter !== chap) {
        chap = p.chapter;
        if (chap >= 0) {
          const h = document.createElement("li");
          h.className = "chap"; h.textContent = doc.chapters[chap].title;
          frag.appendChild(h);
        }
      }
      const li = document.createElement("li");
      const lead = p.lead ? `<span class="note-inline">${esc(p.lead)} </span>` : "";
      li.innerHTML = `<button class="part-btn${p.index === s.lastPart && p.index > 0 ? " last" : ""}" data-i="${p.index}"><span class="n">${p.index + 1}</span><span class="t">${lead}${esc(p.text)}</span></button>`;
      frag.appendChild(li);
    }
    ol.innerHTML = "";
    ol.appendChild(frag);
    $("#ed-start").disabled = !doc.parts.length;
  }

  $("#ed-parts").addEventListener("click", (e) => {
    const b = e.target.closest(".part-btn");
    if (b) startPrompter(+b.dataset.i);
  });
  $("#ed-start").addEventListener("click", () => startPrompter(0));
  $("#ed-back").addEventListener("click", leaveEditor);

  function leaveEditor() {
    clearTimeout(saveTimer);
    const s = current.script;
    if (s && !s.title.trim() && !s.text.trim()) scripts = scripts.filter((x) => x !== s);
    else if (s && !s.title.trim()) s.title = firstWords(s.text);
    saveScripts();
    renderLibrary();
    show("library");
  }

  function firstWords(text) {
    const line = (text.split("\n").find((l) => l.trim()) || "").replace(/^#+\s*/, "").trim();
    return line.length > 48 ? line.slice(0, 46).replace(/\s+\S*$/, "") + " …" : line || "Ohne Titel";
  }

  $("#ed-delete").addEventListener("click", () => { $("#ed-delete").hidden = true; $("#ed-delete-confirm").hidden = false; });
  $("#ed-delete-no").addEventListener("click", () => { $("#ed-delete").hidden = false; $("#ed-delete-confirm").hidden = true; });
  $("#ed-delete-yes").addEventListener("click", () => {
    scripts = scripts.filter((x) => x !== current.script);
    current.script = null;
    saveScripts(); renderLibrary(); show("library");
    toast("Skript gelöscht");
  });

  // ───────────────────────── Dateien ─────────────────────────
  let importInto = null; // null = neues Skript, sonst ins geöffnete Skript einfügen
  for (const l of $$('label[for="file-input"]')) {
    l.addEventListener("click", () => { importInto = current.view === "editor" ? current.script : null; });
  }
  $("#file-input").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (f) await importFile(f, importInto);
  });

  async function importFile(file, into) {
    try {
      const text = await readScriptFile(file);
      if (!text.trim()) { toast("Die Datei enthält keinen Text"); return; }
      if (into) {
        const ta = $("#ed-text");
        const at = ta.selectionStart ?? ta.value.length;
        const sep = ta.value && at > 0 && !ta.value.slice(0, at).endsWith("\n") ? "\n" : "";
        ta.value = ta.value.slice(0, at) + sep + text + ta.value.slice(at);
        into.text = ta.value; touch(); reparse();
        if (!into.title) { into.title = baseName(file.name); $("#ed-title").value = into.title; }
        toast("Eingefügt: " + file.name);
      } else {
        const s = { id: newId(), title: baseName(file.name), text, mode: "satz", updated: Date.now(), lastPart: 0 };
        scripts.push(s); saveScripts();
        openEditor(s);
      }
    } catch (err) {
      console.error(err);
      toast("Datei konnte nicht gelesen werden: " + (err.message || err), 5000);
    }
  }
  const baseName = (n) => String(n || "Skript").replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim() || "Skript";

  async function readScriptFile(file) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (ext === "docx" || /wordprocessingml/.test(file.type)) {
      if (!window.mammoth) throw new Error("Word-Import ist in dieser Fassung nicht enthalten");
      const res = await window.mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
      return htmlToScript(res.value);
    }
    if (ext === "pdf") throw new Error("PDF wird nicht unterstützt – bitte als Word- oder Textdatei speichern");
    return await file.text();
  }

  /** Word-HTML in Skripttext: Überschriften → #, ganz kursive Absätze → [Regieanweisung]. */
  function htmlToScript(html) {
    const dom = new DOMParser().parseFromString(html, "text/html");
    const out = [];
    const textOf = (el) => el.textContent.replace(/\s+/g, " ").trim();
    const strip = (x) => x.replace(/[\s.,;:!?()„“"'’–-]/g, "");
    const allItalic = (el) => {
      const t = strip(textOf(el));
      if (!t) return false;
      let it = "";
      for (const e of el.querySelectorAll("em, i")) it += e.textContent;
      return strip(it).length >= t.length * 0.95;
    };
    const walk = (node) => {
      for (const el of node.children) {
        const tag = el.tagName.toLowerCase();
        if (/^h[1-6]$/.test(tag)) out.push("", "#".repeat(Math.min(3, +tag[1])) + " " + textOf(el));
        else if (tag === "p" || tag === "li") {
          const t = textOf(el);
          if (!t) { out.push(""); continue; }
          out.push(allItalic(el) && !/^\[.*\]$/.test(t) ? "[" + t + "]" : t);
        } else if (tag === "ul" || tag === "ol" || tag === "table" || tag === "tbody" || tag === "tr" || tag === "td" || tag === "div" || tag === "blockquote") walk(el);
        else { const t = textOf(el); if (t) out.push(t); }
      }
    };
    walk(dom.body);
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  // ───────────────────────── Teleprompter ─────────────────────────
  const P = {
    tracker: null, doc: null, partEls: [], wordEls: [], chapEls: [],
    shownPart: -1, shownPos: -1, cursorEl: null, ty: 0,
    listening: false, paused: false, engineState: "off", settleTimer: 0, hudTimer: 0, endShown: false, wake: null,
  };
  const prompter = $("#v-prompter"), flow = $("#flow"), stage = $("#stage");

  function applySettings() {
    prompter.style.setProperty("--fs", settings.fontSize + "px");
    prompter.style.setProperty("--measure", settings.measure + "em");
    prompter.style.setProperty("--line-y", String(settings.line / 100));
    prompter.dataset.view = settings.view;
    prompter.dataset.bg = settings.bg;
    prompter.dataset.mirror = settings.mirror;
    $("#pr-mirror").classList.toggle("on", settings.mirror !== "aus");
    $("#heard").hidden = !settings.heard || current.view !== "prompter";
  }

  function startPrompter(partIndex) {
    const s = current.script;
    if (!s) return;
    clearTimeout(parseTimer);
    s.text = $("#ed-text").value;
    current.doc = SFTracker.parse(s.text, { mode: s.mode });
    if (!current.doc.parts.length) { toast("Das Skript ist noch leer"); return; }
    P.doc = current.doc;
    P.tracker = new SFTracker.Tracker(P.doc);
    buildFlow(P.doc);
    P.tracker.goto(clamp(partIndex || 0, 0, P.doc.parts.length - 1));
    P.shownPart = -1; P.endShown = false;
    $("#pr-end").hidden = true;
    $("#heard").textContent = "";
    show("prompter");
    applySettings();
    prompter.classList.add("no-anim");
    render(true);
    requestAnimationFrame(() => requestAnimationFrame(() => prompter.classList.remove("no-anim")));
    showHud(true);
    keepAwake(true);
    startListening();
  }

  function buildFlow(doc) {
    const html = [];
    let chap = -2;
    for (const p of doc.parts) {
      if (p.chapter !== chap) {
        chap = p.chapter;
        if (chap >= 0) html.push(`<div class="chap-title" data-ch="${chap}" data-first="${p.index}">${esc(doc.chapters[chap].title)}</div>`);
      }
      let h = `<p class="p future" data-i="${p.index}">`;
      if (p.lead) h += `<span class="lead">${esc(p.lead.replace(/^\[|\]$/g, ""))}</span>`;
      for (const s of p.segs) {
        if (s.t === "w") h += `<span class="w" data-a="${s.a}" data-b="${s.b}">${esc(s.text)}</span>`;
        else if (s.t === "n") h += `<span class="note">${esc(s.text)}</span>`;
        else h += esc(s.text);
      }
      html.push(h + "</p>");
    }
    flow.innerHTML = html.join("");
    P.partEls = $$(".p", flow);
    P.chapEls = $$(".chap-title", flow);
    P.wordEls = P.partEls.map((el) => $$(".w", el).map((w) => ({ el: w, a: +w.dataset.a, b: +w.dataset.b })));
    P.ty = 0;
    flow.style.transform = "translateY(0px)";
  }

  /** Anzeige an den Stand des Mitlesens anpassen. */
  function render(force) {
    const tr = P.tracker;
    if (!tr) return;
    const st = tr.state();
    const part = st.part, pos = st.pos;
    if (force || part !== P.shownPart) {
      const prev = P.shownPart;
      const lo = force || prev < 0 ? 0 : Math.max(0, Math.min(prev, part) - 1);
      const hi = force || prev < 0 ? P.partEls.length - 1 : Math.min(P.partEls.length - 1, Math.max(prev, part) + 1);
      for (let i = lo; i <= hi; i++) {
        const el = P.partEls[i];
        el.className = "p " + (i < part ? "past" : i === part ? "current" : "future") + (i === part - 1 ? " prev" : "") + (i === part + 1 ? " next" : "");
        const read = i < part;
        for (const w of P.wordEls[i]) { w.el.classList.toggle("read", read); w.el.classList.remove("cursor"); }
      }
      for (const c of P.chapEls) {
        const f = +c.dataset.first;
        c.classList.toggle("near", f === part || f === part + 1);
      }
      P.shownPart = part;
      P.cursorEl = null;
    }
    // Wörter im aktuellen Teil
    let cursor = null;
    for (const w of P.wordEls[part] || []) {
      const read = w.b > w.a ? w.b <= pos : w.a < pos;
      w.el.classList.toggle("read", read);
      if (!read && !cursor) cursor = w.el;
    }
    if (cursor !== P.cursorEl) {
      if (P.cursorEl) P.cursorEl.classList.remove("cursor");
      if (cursor) cursor.classList.add("cursor");
      P.cursorEl = cursor;
    }
    P.shownPos = pos;
    follow(cursor);
    // Fortschritt und Position
    const total = P.doc.tokens.length || 1;
    $("#progress-bar").style.width = (100 * Math.min(pos, total) / total).toFixed(2) + "%";
    const p = P.doc.parts[part];
    const ch = p && p.chapter >= 0 ? P.doc.chapters[p.chapter].title : "";
    $("#pr-where").textContent = `Teil ${part + 1} / ${P.doc.parts.length}` + (ch ? " · " + ch : "");
    if (st.done && !P.endShown) {
      P.endShown = true;
      setTimeout(() => { if (P.tracker && P.tracker.state().done) { $("#pr-end").hidden = false; pauseListening(true); } }, 1400);
    }
  }

  function follow(cursorEl) {
    const H = stage.clientHeight;
    const partEl = P.partEls[P.shownPart];
    if (!partEl) return;
    let y;
    if (settings.view === "einzeln") {
      const h = partEl.offsetHeight;
      if (h < H * 0.62) y = H * 0.5 - (partEl.offsetTop + h / 2);
      else y = H * 0.3 - (cursorEl ? cursorEl.offsetTop : partEl.offsetTop);
    } else {
      const target = cursorEl ? cursorEl.offsetTop : partEl.offsetTop;
      y = H * settings.line / 100 - target;
    }
    y = Math.round(y);
    if (Math.abs(y - P.ty) < 2) return;
    P.ty = y;
    flow.style.transform = `translateY(${y}px)`;
  }

  function goPart(i) {
    if (!P.tracker) return;
    const n = P.doc.parts.length;
    if (i >= n) { P.tracker.pos = P.doc.tokens.length; render(); return; }
    P.tracker.goto(clamp(i, 0, n - 1));
    P.endShown = false;
    $("#pr-end").hidden = true;
    render();
  }

  function exitPrompter() {
    stopListening();
    keepAwake(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (current.script && P.tracker) {
      const st = P.tracker.state();
      current.script.lastPart = st.done ? 0 : st.part;
      saveScripts();
    }
    P.tracker = null;
    reparse();
    show("editor");
  }

  // ── Mitlesen ──
  Engine.on((e) => {
    if (current.view !== "prompter") return;
    if (e.type === "status") setMic(e.state, e.message);
    else if (e.type === "session") { if (P.tracker) P.tracker.newUtterance(); }
    else if (e.type === "level") { const lv = $("#mic-level"); lv.style.width = Math.round(clamp(e.value, 0, 1) * 100) + "%"; }
    else if ((e.type === "partial" || e.type === "final") && P.tracker && !P.paused) {
      if (P.engineState !== "listening") setMic("listening");
      const r = P.tracker.feed(e.text || "", e.type === "final");
      if (r.changed || e.type === "final") render();
      if (settings.heard) $("#heard").textContent = (e.text || "").trim().split(/\s+/).slice(-12).join(" ");
      clearTimeout(P.settleTimer);
      if (settings.pause) P.settleTimer = setTimeout(() => { if (P.tracker && !P.paused) { const s = P.tracker.settle(); if (s.changed) render(); } }, 1100);
    }
  });

  function startListening() {
    P.paused = false;
    $("#engine-info").textContent = Engine.label;
    if (!Engine.available()) { setMic("none"); return; }
    setMic("loading");
    try {
      const vocab = settings.grammar && Engine.grammar ? P.tracker.vocabulary() : [];
      Promise.resolve(Engine.start(vocab)).catch((err) => setMic("error", String(err && err.message || err)));
      P.listening = true;
    } catch (err) { setMic("error", String(err.message || err)); }
  }
  function stopListening() {
    clearTimeout(P.settleTimer);
    if (P.listening) { try { Engine.stop(); } catch (e) { /* */ } }
    P.listening = false; P.paused = false;
    setMic("off");
  }
  function pauseListening(on) {
    if (!P.listening) { if (!on) startListening(); return; }
    P.paused = on;
    if (on && P.tracker) P.tracker.commit();   // Stand festhalten, damit nach der Pause nichts zurückspringt
    try { Engine.pause(on); } catch (e) { /* */ }
    setMic(on ? "paused" : "listening");
  }

  function setMic(state, message) {
    P.engineState = state;
    const m = $("#mic");
    m.dataset.state = state;
    const text = {
      off: "Mikrofon aus", loading: message || "Wird geladen …", listening: "Hört mit", paused: "Pausiert",
      error: message || "Fehler", none: "Nur von Hand",
    }[state] || state;
    $("#mic-text").textContent = text;
    m.title = state === "none" ? Engine.label : "Mitlesen an/aus (Leertaste)";
    if (state === "error" && message) toast(message, 5000);
    if (state !== "listening") $("#mic-level").style.width = "0";
    if (state === "listening" || state === "paused" || state === "none") scheduleHudHide();
  }

  $("#mic").addEventListener("click", () => {
    if (P.engineState === "none") { toast(Engine.label, 5000); return; }
    if (P.engineState === "error" || P.engineState === "off") { startListening(); return; }
    pauseListening(!P.paused);
  });

  // ── Leisten ein-/ausblenden ──
  function showHud(stay) {
    $("#hud").classList.remove("hide");
    clearTimeout(P.hudTimer);
    if (!stay) scheduleHudHide();
  }
  function scheduleHudHide() {
    clearTimeout(P.hudTimer);
    P.hudTimer = setTimeout(() => {
      if (current.view === "prompter" && !$("#settings").open && P.engineState !== "error") $("#hud").classList.add("hide");
    }, 3500);
  }
  const hudHidden = () => $("#hud").classList.contains("hide");

  // ── Tippen, Wischen, Scrollrad ──
  let down = null;
  stage.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  stage.addEventListener("pointerup", (e) => {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y, dt = Date.now() - down.t;
    down = null;
    if (Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(dx) * 1.3) { stepPart(dy < 0 ? 1 : -1); return; }
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12 || dt > 700) return;
    const w = innerWidth;
    if (e.clientX < w * 0.3) stepPart(-1);
    else if (e.clientX > w * 0.7) stepPart(1);
    else if (hudHidden()) showHud(); else $("#hud").classList.add("hide");
  });
  stage.addEventListener("pointercancel", () => { down = null; });

  let wheelAcc = 0, wheelLock = 0;
  prompter.addEventListener("wheel", (e) => {
    if (e.target.closest(".hud-top, .hud-bottom")) return;
    e.preventDefault();
    const now = Date.now();
    if (now < wheelLock) return;
    wheelAcc += e.deltaY || e.deltaX;
    if (Math.abs(wheelAcc) >= 30 || e.deltaMode === 1) {
      stepPart(wheelAcc > 0 || e.deltaY > 0 ? 1 : -1);
      wheelAcc = 0; wheelLock = now + 320;
    }
  }, { passive: false });

  function stepPart(d) {
    if (!P.tracker) return;
    const st = P.tracker.state();
    if (d < 0 && st.progress > 0.25) goPart(st.part);        // erst an den Anfang des Teils
    else goPart(st.part + d);
  }

  $("#pr-prev").addEventListener("click", () => stepPart(-1));
  $("#pr-next").addEventListener("click", () => stepPart(1));
  $("#pr-restart").addEventListener("click", () => P.tracker && goPart(P.tracker.state().part));
  $("#pr-exit").addEventListener("click", exitPrompter);
  $("#end-exit").addEventListener("click", exitPrompter);
  $("#end-again").addEventListener("click", () => { goPart(0); pauseListening(false); });
  $("#pr-bigger").addEventListener("click", () => changeFont(4));
  $("#pr-smaller").addEventListener("click", () => changeFont(-4));
  $("#pr-mirror").addEventListener("click", () => {
    settings.mirror = settings.mirror === "aus" ? "h" : "aus";
    saveSettings(); applySettings(); syncSettingsForm();
  });
  $("#pr-full").addEventListener("click", toggleFullscreen);
  for (const b of $$(".hud button")) b.addEventListener("click", () => showHud());

  function changeFont(d) {
    settings.fontSize = clamp(settings.fontSize + d, 20, 140);
    saveSettings(); applySettings(); syncSettingsForm();
    rescroll();
  }
  function rescroll() {
    prompter.classList.add("no-anim");
    P.ty = NaN; render(true);
    requestAnimationFrame(() => prompter.classList.remove("no-anim"));
  }
  addEventListener("resize", () => { if (current.view === "prompter") rescroll(); });

  function toggleFullscreen() {
    if (Engine.host === "windows" && Engine.call) { Engine.call("fullscreen"); return; }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else (document.documentElement.requestFullscreen ? document.documentElement.requestFullscreen() : Promise.reject()).catch(() => toast("Vollbild ist hier nicht verfügbar"));
  }

  async function keepAwake(on) {
    if (native && native.keepAwake) { try { native.keepAwake(on); } catch (e) { /* */ } return; }
    if (Engine.host === "windows" && Engine.call) { Engine.call("keep_awake", on); return; }
    try {
      if (on && navigator.wakeLock) P.wake = await navigator.wakeLock.request("screen");
      else if (!on && P.wake) { await P.wake.release(); P.wake = null; }
    } catch (e) { /* abgelehnt */ }
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && current.view === "prompter") keepAwake(true); });

  // ── Tasten (auch Fernbedienungen und Presenter) ──
  document.addEventListener("keydown", (e) => {
    if (current.view !== "prompter" || $("#settings").open) return;
    const k = e.key;
    const map = {
      ArrowRight: 1, ArrowDown: 1, PageDown: 1, Enter: 1, MediaTrackNext: 1, AudioVolumeUp: 1,
      ArrowLeft: -1, ArrowUp: -1, PageUp: -1, Backspace: -1, MediaTrackPrevious: -1, AudioVolumeDown: -1,
    };
    if (map[k]) { e.preventDefault(); stepPart(map[k]); showHud(); return; }
    if (k === " " || k === "MediaPlayPause") { e.preventDefault(); $("#mic").click(); showHud(); return; }
    if (k === "Escape") { e.preventDefault(); exitPrompter(); return; }
    if (k === "Home") { e.preventDefault(); goPart(0); return; }
    if (k === "+" || k === "=") { changeFont(4); return; }
    if (k === "-") { changeFont(-4); return; }
    if (k === "m" || k === "M") { $("#pr-mirror").click(); return; }
    if (k === "r" || k === "R") { $("#pr-restart").click(); return; }
    if (k === "f" || k === "F") { toggleFullscreen(); return; }
  });
  prompter.addEventListener("mousemove", () => { if (hudHidden()) showHud(); });

  // ───────────────────────── Einstellungen ─────────────────────────
  const dlg = $("#settings");
  function openSettings() {
    syncSettingsForm();
    $("#engine-info").textContent = Engine.label;
    loadMics();
    if (!dlg.open) dlg.showModal();
    clearTimeout(P.hudTimer);
  }
  dlg.addEventListener("close", () => { if (current.view === "prompter") { showHud(); rescroll(); } });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  for (const id of ["#lib-settings", "#ed-settings", "#pr-settings"]) $(id).addEventListener("click", openSettings);

  function syncSettingsForm() {
    $("#set-font").value = settings.fontSize; $("#out-font").textContent = settings.fontSize + " px";
    $("#set-measure").value = settings.measure; $("#out-measure").textContent = settings.measure + " em";
    $("#set-line").value = settings.line; $("#out-line").textContent = settings.line + " %";
    $("#set-pause").checked = settings.pause;
    $("#set-grammar").checked = settings.grammar;
    $("#set-grammar").closest("label").hidden = !Engine.grammar;
    $("#set-heard").checked = settings.heard;
    for (const g of $$("[data-setting]", dlg)) {
      for (const b of $$("button", g)) b.setAttribute("aria-checked", String(b.dataset.value === settings[g.dataset.setting]));
    }
  }
  const onRange = (id, key, out, unit) => $(id).addEventListener("input", (e) => {
    settings[key] = +e.target.value; $(out).textContent = settings[key] + unit;
    saveSettings(); applySettings();
    if (current.view === "prompter") rescroll();
  });
  onRange("#set-font", "fontSize", "#out-font", " px");
  onRange("#set-measure", "measure", "#out-measure", " em");
  onRange("#set-line", "line", "#out-line", " %");
  for (const g of $$("[data-setting]", dlg)) {
    g.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-value]");
      if (!b) return;
      settings[g.dataset.setting] = b.dataset.value;
      saveSettings(); syncSettingsForm(); applySettings();
      if (current.view === "prompter") rescroll();
    });
  }
  $("#set-pause").addEventListener("change", (e) => { settings.pause = e.target.checked; saveSettings(); });
  $("#set-heard").addEventListener("change", (e) => { settings.heard = e.target.checked; saveSettings(); applySettings(); });
  $("#set-grammar").addEventListener("change", (e) => {
    settings.grammar = e.target.checked; saveSettings();
    if (current.view === "prompter" && P.listening) { stopListening(); startListening(); }
  });

  async function loadMics() {
    const mics = await Engine.mics();
    $("#row-mic").hidden = !mics.length;
    if (!mics.length) return;
    const sel = $("#set-mic");
    sel.innerHTML = `<option value="">Standard</option>` + mics.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("");
    sel.value = mics.some((m) => String(m.id) === String(settings.mic)) ? settings.mic : "";
  }
  $("#set-mic").addEventListener("change", async (e) => {
    settings.mic = e.target.value; saveSettings();
    await Engine.setMic(settings.mic);
    if (current.view === "prompter" && P.listening) { stopListening(); startListening(); }
  });

  // ───────────────────────── Schnittstelle für die Apps ─────────────────────────
  window.SFApp = {
    /** Zurück-Taste (Android). true = in der App verarbeitet. */
    onBack() {
      if (dlg.open) { dlg.close(); return true; }
      if (current.view === "prompter") { exitPrompter(); return true; }
      if (current.view === "editor") { leaveEditor(); return true; }
      return false;
    },
    /** Fernbedienung über Lautstärketasten (Android) */
    key(cmd) {
      if (current.view !== "prompter") return false;
      if (cmd === "next") stepPart(1); else if (cmd === "prev") stepPart(-1); else if (cmd === "toggle") $("#mic").click();
      return true;
    },
    importText(text, title) {
      const s = { id: newId(), title: title || firstWords(text), text: String(text || ""), mode: "satz", updated: Date.now(), lastPart: 0 };
      scripts.push(s); saveScripts(); openEditor(s);
    },
    async importFile(name, b64, mime) {
      const bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      await importFile(new File([bytes], name || "Skript.txt", { type: mime || "" }), null);
    },
    toast,
    settings: () => JSON.stringify(settings),
  };

  // ───────────────────────── Start ─────────────────────────
  applySettings();
  renderLibrary();
  show("library");
  if (settings.mic) Promise.resolve(Engine.setMic(settings.mic)).catch(() => {});
  if (native && native.ready) try { native.ready(); } catch (e) { /* */ }
  if (Engine.host === "windows" && Engine.call) Engine.call("ready");
  if (Engine.host === "android") $("#pr-full").hidden = true;
  // Zum Testen ohne Mikrofon: SFDemo("gesprochener text", true) in der Konsole
  window.SFDemo = (text, final) => window.SFSpeech({ type: final ? "final" : "partial", text });
})();
