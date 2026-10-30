# Souffleur

Teleprompter, der mitliest. Das Mikrofon hört zu, Souffleur markiert jedes gesprochene Wort und schaltet zum nächsten Teil, sobald ein Satz fertig ist. Die Spracherkennung läuft offline auf dem Gerät (Vosk, deutsches Modell); das Skript verlässt das Gerät nicht.

- **Android**: [Souffleur.apk](https://github.com/honeybalecta/souffleur/releases/latest/download/Souffleur.apk) (Android 10 und neuer)
- **Windows**: [Souffleur-Setup.exe](https://github.com/honeybalecta/souffleur/releases/latest/download/Souffleur-Setup.exe), Installation ohne Adminrechte

Beide Links zeigen immer auf die neueste Fassung.
- **Browser**: optional über GitHub Pages; nutzt dort die Spracherkennung von Chrome oder Edge (online)

## Bedienung

| | |
|---|---|
| Skript | einfügen oder als Word-, Markdown- oder Textdatei öffnen; auf Android auch über „Teilen“ |
| Kapitel | Zeilen mit `#` am Anfang |
| Regieanweisungen | `[in eckigen Klammern]` oder in Word ganz kursiv gesetzte Absätze; werden angezeigt, nicht mitgelesen |
| Teile | Sätze oder Absätze, umschaltbar im Editor |
| Start | „Start“ oder auf einen Teil tippen, um dort zu beginnen |
| Von Hand | Tippen rechts/links, Wischen, Pfeiltasten, Bild ↑/↓, Scrollring, Bluetooth-Auslöser (Lauter/Leiser) |
| Mitlesen | Leertaste oder Mikrofon-Knopf schaltet an und aus |
| Versprecher | Satz neu anfangen – Souffleur springt mit zurück |
| Anzeige | Fließtext oder Satz für Satz, Schriftgröße, Zeilenbreite, Lesezeile, Spiegeln (Prompter-Glas), Hintergrund inkl. Greenscreen |
| Ringlicht | Bildschirmrand leuchtet, Text steht im Fenster in der Mitte; Breite und Lichtfarbe (Tageslicht, neutral, warm) einstellbar, Taste L; auf Android volle Helligkeit |

**Mitlesen im Detail:** Die Erkennung ist auf die Wörter des Skripts beschränkt (abschaltbar), das macht sie deutlich genauer. Zahlen, Abkürzungen und Kürzel müssen nicht erkannt werden. Bei einer Sprechpause schaltet Souffleur weiter, wenn vom Satz nur noch ein, zwei Wörter fehlen.

## Aufbau

```
web/        Oberfläche (gemeinsam für alle Fassungen): app.js, tracker.js (Abgleich), engines.js (Erkennung)
android/    Kotlin-App: WebView, lokaler Server, Vosk über das Mikrofon
windows/    Python-App: pywebview (Edge WebView2), Vosk, sounddevice; PyInstaller + Inno Setup
test/       Abgleich-Tests, Oberflächentest in Chrome, Spracherkennungstest (espeak-ng → Vosk → Abgleich)
tools/      Bibliotheken und Sprachmodell holen, Build-Logs
```

## Bauen

Alles läuft über GitHub Actions; jede Änderung auf `main` baut neu und legt APK und Installer im Release `v<version.txt>` ab.

- **Android-Signatur**: Secrets `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (Standard `souffleur`). Ohne Secrets entsteht ein Testbuild mit Debug-Signatur.
- **Browser-Version**: Einstellungen › Pages › Source „GitHub Actions“ einschalten.
- **Berichte**: Jeder Lauf legt Log, Selbsttest und Bildschirmfotos im Zweig `ci-log-test`, `ci-log-android` bzw. `ci-log-windows` ab.

Lokal testen: `node test/tracker.test.mjs`
