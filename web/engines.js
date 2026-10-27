/*
 * Souffleur – Spracherkennung.
 * Android: Vosk in der App (Objekt SFNative). Windows: Vosk im Programm (pywebview-API).
 * Browser: Web-Speech-API von Chrome/Edge als Notlösung (online).
 * Ereignisse an die Oberfläche: {type: "status"|"partial"|"final"|"level", …}
 */
(function () {
  "use strict";
  const listeners = new Set();
  const emit = (e) => { for (const fn of listeners) { try { fn(e); } catch (err) { console.error(err); } } };
  // Rückruf für die nativen Hüllen
  window.SFSpeech = emit;

  const params = new URLSearchParams(location.search);
  const host = params.get("app") || (window.SFNative ? "android" : "web");

  // ── Android ──
  function androidEngine() {
    const N = () => window.SFNative;
    return {
      kind: "android",
      label: "Offline auf dem Gerät (Vosk, deutsches Modell). Es wird nichts übertragen.",
      grammar: true, level: true,
      available: () => !!N(),
      start: (vocab) => N().start(JSON.stringify(vocab || [])),
      stop: () => N() && N().stop(),
      pause: (on) => N() && N().pause(!!on),
      mics: async () => [],
      setMic: () => {},
    };
  }

  // ── Windows (pywebview) ──
  function windowsEngine() {
    let ready = !!(window.pywebview && window.pywebview.api);
    const waiters = [];
    window.addEventListener("pywebviewready", () => { ready = true; waiters.splice(0).forEach((f) => f()); });
    const api = () => new Promise((res) => (ready ? res(window.pywebview.api) : waiters.push(() => res(window.pywebview.api))));
    return {
      kind: "windows",
      label: "Offline im Programm (Vosk, deutsches Modell). Es wird nichts übertragen.",
      grammar: true, level: true,
      available: () => true,
      start: async (vocab) => (await api()).start(JSON.stringify(vocab || [])),
      stop: async () => (await api()).stop(),
      pause: async (on) => (await api()).pause(!!on),
      mics: async () => { try { return JSON.parse(await (await api()).mics()); } catch (e) { return []; } },
      setMic: async (id) => (await api()).set_mic(String(id || "")),
      call: async (name, ...args) => { const a = await api(); return a[name] ? a[name](...args) : undefined; },
    };
  }

  // ── Browser ──
  function webEngine() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    let rec = null, active = false, paused = false, committed = 0, restarts = 0;
    function make() {
      const r = new SR();
      r.lang = "de-DE"; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
      r.onstart = () => { restarts = 0; emit({ type: "session" }); emit({ type: "status", state: "listening" }); };
      r.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) {
            if (i >= committed) { emit({ type: "final", text: res[0].transcript }); committed = i + 1; }
          } else interim += res[0].transcript + " ";
        }
        if (interim.trim()) emit({ type: "partial", text: interim });
      };
      r.onerror = (e) => {
        if (e.error === "no-speech" || e.error === "aborted") return;
        const msg = e.error === "not-allowed" || e.error === "service-not-allowed" ? "Mikrofon nicht erlaubt"
          : e.error === "network" ? "Keine Verbindung zur Spracherkennung"
          : e.error === "audio-capture" ? "Kein Mikrofon gefunden" : "Spracherkennung: " + e.error;
        if (e.error === "not-allowed" || e.error === "audio-capture" || e.error === "service-not-allowed") active = false;
        emit({ type: "status", state: "error", message: msg });
      };
      r.onend = () => {
        committed = 0;
        if (active && !paused && restarts++ < 50) { try { r.start(); } catch (err) { /* läuft schon */ } }
        else if (!active) emit({ type: "status", state: "off" });
      };
      return r;
    }
    return {
      kind: "web",
      label: SR ? "Spracherkennung des Browsers (online, über den Browser-Anbieter)." : "Dieser Browser hat keine Spracherkennung. Steuere von Hand oder nutze die Android- oder Windows-App.",
      grammar: false, level: false,
      available: () => !!SR,
      start() {
        if (!SR) return;
        active = true; paused = false; committed = 0;
        rec = rec || make();
        emit({ type: "status", state: "loading", message: "Mikrofon wird gestartet" });
        try { rec.start(); } catch (e) { /* läuft schon */ }
      },
      stop() { active = false; paused = false; if (rec) try { rec.stop(); } catch (e) { /* */ } },
      pause(on) {
        paused = !!on;
        if (!rec) return;
        if (paused) { try { rec.stop(); } catch (e) { /* */ } emit({ type: "status", state: "paused" }); }
        else if (active) { try { rec.start(); } catch (e) { /* */ } }
      },
      mics: async () => [],
      setMic: () => {},
    };
  }

  const engine = host === "android" ? androidEngine() : host === "windows" ? windowsEngine() : webEngine();
  engine.host = host;
  engine.on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  window.SFEngine = engine;
})();
