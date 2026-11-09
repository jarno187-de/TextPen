# TextPen: radierbarer GoodNotes-Export und Bewertungen ohne Spam

Recherche zu GPT Genie (gptgenie.pro), Umsetzungsplan für TextPen und lauffähiger Prototyp.
Stand: 02.11.2026.

> **Umgesetzt und live (02.11.2026):** Beide Funktionen sind in `textpen-web/` und `control/` eingebaut und auf textpen.de veröffentlicht. Der GoodNotes-Export erscheint nur, wenn in den Einstellungen unter „Beta“ die Beta-Funktionen eingeschaltet sind. Bewertungen moderierst du im Control-Panel unter „Bewertungen“. Dieser Ordner bleibt als Prototyp und Planungsstand.

---

## Kurzfassung

**Radieren in GoodNotes.** GPT Genie macht keinen PDF-Trick. Es baut eine echte GoodNotes-Datei (`.goodnotes`),
in der jeder Buchstabe aus nativen GoodNotes-Kugelschreiber-Strichen besteht. Das Papier liegt als feste
Hintergrund-PDF darunter. GoodNotes behandelt diese Striche wie selbst geschriebene Tinte: radieren, mit dem
Lasso verschieben, umfärben. Eine PDF kann das grundsätzlich nicht, weil GoodNotes importierte PDFs zum
unveränderlichen Hintergrund macht.

**Bewertungen.** GPT Genie verhindert Spam fast nur über Konten: Schreiben dürfen nur angemeldete Nutzer mit
bestätigter E-Mail (6-stelliger Code oder Google), eine Bewertung pro Konto. CAPTCHA, Honeypot oder Moderation
gibt es dort sichtbar nicht. TextPen hat keine Konten und verspricht „keine Besucherprofile“. Deshalb nutzt der
Plan sechs Schutzschichten ohne Konten. Bewertungen mit Name oder Text gibt der Betreiber vorher frei.

**Prototyp.** Beides ist fertig programmiert und getestet:
- GoodNotes-Export: Writer, Export-Knopf, radierbare Mittellinien für die eingebaute Schrift.
- Bewertungen: Server-Logik für den bestehenden Cloudflare Durable Object, Dialog, lokale Moderation.
- 10 automatische Tests sind grün. Der Ablauf wurde im echten Browser geprüft.
- **Nicht** geprüft: der Import in die echte GoodNotes-App. Dieser Test auf deinem Gerät fehlt noch (Abschnitt 5).

---

## 1. Recherche: wie GPT Genie es macht

### 1.1 Radierbare Schrift in GoodNotes

Quellen: der ausgelieferte Code von gptgenie.pro (`/js/app/goodnotes-writer.js`, `goodnotes-export.js`,
`ink-vector.js`, `download-file.js` und weitere Writer), die Seiten `/goodnotes` und `/neuigkeiten` sowie die
Formatbeschreibung der MIT-Bibliothek goodnotes-codec, auf die GPT Genie selbst verweist.

**Was exportiert wird**
- Seit 12.10.2026: `.goodnotes`, Samsung Notes `.sdocx`, OneNote `.one`, Notability `.ntb` / `.note`.
  Seit 22.10.2026 zusätzlich `.freenotes` und `.noteful`. Alle laufen über denselben Ablauf mit je einem eigenen „Writer“.
- Grundlagen: GoodNotes nach goodnotes-codec (Taylor Nilsen, MIT), Samsung nach twangodev/sdocx (nur Fakten),
  OneNote nach den offenen Microsoft-Spezifikationen MS-ONESTORE/MS-ONE und OfficeIMO (MIT).
  Die anderen Formate stammen aus Beispieldateien einer Testperson („Marflux“).
- Der Export läuft komplett im Browser. Laut GPT Genie verlässt der Text das Gerät nicht.

**Warum eine PDF nicht radierbar ist.** GoodNotes macht eine importierte PDF zum festen Seitenhintergrund.
Was in anderen Apps auf die PDF geschrieben wurde, wird dabei eingebrannt. GPT Genie schreibt dazu: Ein falsches
Wort bekommt man nur weg, indem man es überdeckt.

**Aufbau einer `.goodnotes`-Datei** (rekonstruiertes Schema 24; selbst geprüft an einer echten GoodNotes-6-Datei)
- ZIP-Archiv. Jede `.pb`-Datei ist eine Folge von Protobuf-Nachrichten, jeweils mit vorangestellter Länge (Varint).
- `index.events.pb` ist ein Änderungsprotokoll (CRDT-artig, „last writer wins“):
  - `30` Dokument (Titel, Ausrichtung)
  - `6` Anhang (Pflicht, sonst ignoriert GoodNotes die Datei); `105` Suchindex des Anhangs
  - `2` Papier-Ebene: Hintergrund-Anhang, PDF-Seite, Seitengröße, Linienabstand, Schreibbereich
  - `54` Seite mit Reihenfolge-Schlüssel (ASCII-sortiert); `10` aktuelle Seite
  - `105`/`104`/`102` „Notizen-Gruppe angelegt / indiziert / Inhalt geändert“, beim Befüllen mit neuer 63-Bit-Version
- `notes/<Seiten-ID + 1>`: die Elemente einer Seite, je zwei Einträge.
  - Meta: ID, Versionsstempel, Gerät, laufende Nummer, `5381`, Schema
  - Inhalt: Feld `7` = Tintenstrich
- Strich-Geometrie: Vorlage `tpl\0` mit Schema `vuA(v)A(S(uu))A(S(uuuu))vA(f)`.
  - Inhalt: Version, Breite, Befehlsarten, ein Startpunkt, quadratische Kurven, keine Breite pro Punkt
  - Verpackt in `bv41`-Blöcke (LZ4, höchstens 32 KiB)
  - Kugelschreiber = feste Breite, runde Enden. Farbe RGBA als float.
- Einheiten: 1 PDF-Punkt = 11/6 GoodNotes-Einheiten (A4 = 1091 × 1544).
- Außerdem: `index.notes.pb`, `index.attachments.pb`, `attachments/<ID>` (Papier-PDF), `schema.pb`, optional `thumbnail.jpg`.

**Vom Buchstaben zum Strich (GPT Genie)**
- Bis Oktober 2026 waren die Buchstaben Bilder. `ink-vector.js` rechnet die Tinte in Striche um:
  1. Maske
  2. Abstand zum Rand
  3. Skelett nach Zhang & Suen
  4. Linien an Kreuzungen „möglichst gerade“ verbinden
  5. Wo sich die Dicke ändert, in Striche mit fester Breite teilen
  6. Mit dem Bild vergleichen und fehlende Spitzen nachsetzen
  Das läuft in Web-Worker-Threads mit Zwischenspeicher und startet schon, wenn man das Format auswählt.
- Seit Oktober 2026 speichert GPT Genie die gezeichneten Striche mit. Sie werden direkt exportiert und zur
  Sicherheit mit dem Bild verglichen (90 % Überdeckung nötig).
- Das Papier wird gerastert: A4 × 4 als JPEG in einer Hintergrund-PDF. Eine volle Seite hat dadurch etwa 1 MB.
  GoodNotes nimmt ohne Abo nur Dateien bis 5 MB an.
- Bekannte Grenzen: keine Stift-Struktur (Korn, Streifen); der Textmarker wird zum GoodNotes-Textmarker;
  winzige Tintenreste werden absichtlich weggelassen, damit beim Radieren keine Punkte übrig bleiben;
  der Weg zurück in GPT Genie geht nicht.

### 1.2 Bewertungen bei GPT Genie

Quellen: `/js/app/feedback.js`, `feedback-ui.js`, `auth.js`, `account.js` und der öffentliche Endpunkt `/get-all-feedbacks`.

**Funktionen**
- Dialog mit 5 Sternen und Kommentar
- Durchschnitt mit Sternen und Verteilung je Sternzahl
- Liste mit maskierten E-Mail-Adressen („ma***@g***.com“) und „(bearbeitet)“
- Emoji-Reaktionen; Antworten des Erstellers („Marko · Ersteller“)
- Eigene Bewertung bearbeiten oder löschen
- Nach jeder 3. erstellten PDF fragt die Seite nach einer Bewertung (nur angemeldete Nutzer ohne Bewertung)

**Spam- und Bot-Schutz**
- Nur angemeldete Konten dürfen schreiben und reagieren. Gäste sehen nur die Liste.
- Ein Konto braucht eine bestätigte E-Mail (6-stelliger Code) oder Google-Anmeldung (verifizierte Google-Adresse).
- Eine Bewertung pro Konto: erneutes Senden aktualisiert sie.
- Der Server erkennt den Nutzer an der Sitzung. Er maskiert die E-Mail selbst und setzt `own` passend.
- Im Client gibt es **kein** CAPTCHA, keinen Honeypot, keine Rechenaufgabe und keine Moderations-Warteschlange.
  Bewertungen erscheinen sofort. Serverseitige Prüfungen sind von außen nicht sichtbar.
- Stand 02.11.2026: 111 Bewertungen, davon 99 mit 5 Sternen.
- Schwachstelle: Wegwerf-Adressen ergeben beliebig viele Konten, und es gibt keine Freigabe vor der Veröffentlichung.

---

## 2. Ausgangslage TextPen

- Die App rechnet alles im Browser. `render()` setzt die Seiten einmal und malt sie in ein „Canvas-artiges Ziel“:
  in die Vorschau, ins PNG oder in `VectorPdf.Context` für die Vektor-PDF.
- **Zwei Quellen für Buchstaben:**
  1. **Eigene Handschrift**: Striche auf einem 600 × 300-Zeichenfeld, gezeichnet mit fester Breite und runden Enden.
     Das passt genau zu GoodNotes-Kugelschreiber-Strichen. TextPen ist hier besser dran als GPT Genie, das von Bildern ausging.
  2. **Eingebaute Schrift** (Caveat, OFL): gefüllte Umrisse. Sie braucht Mittellinien.
- Server: Cloudflare Worker mit SQLite Durable Object (`ControlStore`). Admin-Zugang mit Argon2id und TOTP.
  Keine Besucherkonten, Datensparsamkeit.
- **Folgerung:** Das Kontomodell von GPT Genie passt nicht. Es bräuchte Registrierung, E-Mail-Versand und
  Passwörter, widerspricht dem Datenschutzansatz und kostet Betriebsaufwand.

---

## 3. Lösung A: GoodNotes-Datei mit radierbarer Schrift

### 3.1 Dateien

- `goodnotes/goodnotes-writer.js`: eigener `.goodnotes`-Writer (ZIP, Protobuf, `tpl`/`bv41`, Ereignisse).
  Aufbau nach der MIT-Formatbeschreibung; jedes Feld mit einer echten GoodNotes-Datei abgeglichen.
  **Kein Code von GPT Genie übernommen**, denn deren Code hat keine Lizenz.
- `goodnotes/goodnotes-export.js`: `Sink`, ein weiteres Canvas-artiges Ziel für `render()`, und der Knopf „GoodNotes-Datei ↓“.
- `goodnotes/font-strokes.js`: erzeugte Mittellinien aller 754 Zeichen der eingebauten Schrift (203 KB).
- `tools/build-font-strokes.mjs`: Generator; einmal ausführen, nicht im Browser.

### 3.2 Ablauf beim Export

1. `render({ vector: Sink })` setzt Seiten genau wie für die PDF. Das Layout ist dasselbe, der Code auch.
2. Aufrufe für Papier (`fillRect`, `arc`/`fill`, `drawImage`) gehen an einen echten `VectorPdf.Context`.
   Daraus entsteht **eine** Hintergrund-PDF, die alle Seiten teilen. Bei TextPen ist das Papier auf jeder Seite gleich.
3. Tinten-Aufrufe werden zu Strichen:
   - `stroke()`: eigene Handschrift, 1:1
   - `fillText()`: Mittellinien aus `font-strokes.js`
   - `strokeText()`: der Dicke-Regler; er verbreitert die Mittellinie um genau die Umrissbreite
4. Punkte werden ausgedünnt (Douglas-Peucker, 0,15 px), in Punkt und dann in GoodNotes-Einheiten umgerechnet.
   Dazu kommt ein Vorschaubild der ersten Seite.

### 3.3 Warum so

- **Gleicher Layout-Code wie PDF und Vorschau.** Es gibt keinen zweiten Satz-Algorithmus, der abweichen kann.
- **Papier als Vektor-PDF statt JPEG.** Linien- und Punktpapier ergeben 533 Byte statt etwa 1 MB pro Seite bei GPT Genie.
  Die 5-MB-Grenze ohne GoodNotes-Abo ist damit kaum erreichbar.
- **Mittellinien beim Build statt im Browser.** Keine Bildverarbeitung und keine Worker zur Laufzeit; der Export
  ist sofort fertig. Der Generator:
  - rastert jeden Umriss und skelettiert ihn nach Zhang & Suen
  - entfernt Treppenpixel (Yokoi-Zahl)
  - läuft die Linien „wie ein Stift“ in die geradeste Richtung ab, damit ein `t`-Stamm ein Strich bleibt
  - teilt Striche, wo sich die Dicke stark ändert
  - setzt Punkte für Kommas und Anführungszeichen
  - gleicht die Breite je Zeichen an die Tintenfläche des Umrisses an
- **Strich-IDs mit gemeinsamem Präfix** (eindeutig, aber gut komprimierbar): 24 % kleinere Dateien.

### 3.4 Gemessen (Prototyp)

- **Formatgleichheit:** Alle Ereignisse und Strich-Einträge haben dieselben Felder wie die echte GoodNotes-6-Datei (Test).
  ZIP-Prüfsummen gültig (Python `zipfile`). Ein unabhängiger Leser liest die Datei zurück.
- **Beispielseite (eingebaute Schrift):** 274 Striche, 35 KB, Export in 1,5 s im Browser.
- **Lagegenauigkeit eingebaute Schrift:** 99,9 % der GoodNotes-Tinte liegen höchstens 0,25 px neben der Vorschau-Tinte.
  IoU 0,92; Tintenmenge 99 % der Vorschau.
- **Lagegenauigkeit eigene Handschrift:** IoU 0,98.
- **Schrift-Generator:** 754 Zeichen in 2586 Strichen (a = 1, o = 1, i = 2, t = 3), mittlere IoU 0,90.
  Schwächste Zeichen: `ˆ` 0,56; `′` und einige Akzente etwa 0,77.
- **Writer:** 40 000 Striche (10 dichte Seiten) in etwa 2,7 s, 3,8 MB.

### 3.5 Offen und Risiken

- **Echter Import in GoodNotes nicht getestet.** In dieser Umgebung gibt es kein GoodNotes. Bitte prüfen
  (Abschnitt 5): Import auf iPad, Windows und Android; teilweise und ganz radieren; Lasso; Umfärben.
  - Die Testdatei von goodnotes-codec stammt aus Schema 25, wir schreiben 24 wie goodnotes-codec und GPT Genie (dort im Live-Betrieb).
- **Das Format ist rekonstruiert.** Ein GoodNotes-Update kann es brechen. Deshalb bleibt die PDF Standard;
  GoodNotes kommt als „Beta“ mit Feature-Schalter (sofort abschaltbar im Control-Panel).
- **Eigenes Papierfoto:** Das Foto landet einmal als JPEG (Qualität 0,98, volle Größe) in der Hintergrund-PDF.
  Für GoodNotes sollte es vorher auf etwa 2000 px und Qualität 0,85 verkleinert werden. Im Prototyp ist das **noch nicht** umgesetzt.
- **Marke:** „GoodNotes“ nur beschreibend verwenden („Datei für GoodNotes“), kein Logo.
  Rekonstruktion eines Dateiformats für Interoperabilität ist üblich; das ist keine Rechtsberatung.

### 3.6 Einbau in textpen-web

1. Dateien nach `textpen-web/` kopieren:
   - `goodnotes-writer.js`, `goodnotes-export.js`
   - `font-strokes.js` nach `assets/`
2. `privacy.js` lädt die Skripte. Neue Reihenfolge:
   `… 'vector-pdf.js', 'goodnotes-writer.js', 'assets/font-strokes.js', 'glyph-cleanup.js', 'app.js', 'goodnotes-export.js', 'web.js', …`
3. `app.js`, eine Zeile in `newPage()`, damit der Sink ohne Tausch übergeben werden kann:
   `if(vector){ctx=new (vector===true?VectorPdf.Context:vector)(W,H);…`
   In `goodnotes-export.js` dann `runExport(button, action, { vector: Sink })`, und der markierte Tausch
   (`shortcut:`) entfällt.
4. `index.html`: den Knopf `<button id="goodnotes" class="secondary">GoodNotes-Datei ↓</button>` direkt nach `#pdf`
   einfügen statt ihn per Skript zu erzeugen.
5. Feature-Schalter:
   - `site-control.js`, im `mapping`: `goodnotes: 'goodnotes'`
   - `control/src/model.js`: `features.goodnotes: true` in `DEFAULT_SETTINGS`; Prüfung in `validateSettings` ergänzen
   - Schalter im Panel
6. `anleitung.html`, neuer Abschnitt „In GoodNotes radieren“:
   - iPad: in Safari laden → GoodNotes „+“ → „Importieren“ → Downloads
   - Windows/Android: „+“ → „Importieren“
   - Hinweis: Papier bleibt fest, die Schrift ist radierbar
7. `npm run build` und die bestehenden Tests; der Build kopiert `textpen-web` automatisch.
8. Später möglich, mit demselben Sink: Samsung Notes, Notability, OneNote. Reihenfolge nach Nachfrage.

---

## 4. Lösung B: Bewertungen ohne Spam und Bots

### 4.1 Schutzschichten (alle ohne Konto)

1. **Rechenaufgabe (Proof of Work, selbst gehostet).** Der Server signiert eine Zufallsaufgabe (HMAC).
   Der Browser sucht eine Zahl, deren SHA-256 mit 16 Null-Bits beginnt. Das sind etwa 65 000 Versuche,
   unter 2 s und unsichtbar, weil die Rechnung beim Öffnen des Dialogs startet. Jede Aufgabe gilt einmal
   (Replay-Tabelle) und läuft nach 30 min ab. Kein Drittanbieter, keine Cookies; anders als ein CAPTCHA oder Turnstile.
2. **Zeitsperre.** Wer schneller als 4 s nach Öffnen absendet, ist ein Skript.
3. **Honeypot.** Ein unsichtbares Feld „Website“. Ist es ausgefüllt, antwortet der Server „erfolgreich“, speichert aber nichts.
   Der Bot lernt nichts.
4. **Limits.** Schlüssel ist ein gesalzener Hash der IP; die IP selbst wird nie gespeichert.
   Pro Netz: 10 Versuche je Stunde und 2 neue Bewertungen je Tag. Gesamt: 200 neue Bewertungen je Tag.
5. **Inhaltsregeln.** Keine Links, E-Mail-Adressen oder Telefonnummern; keine Zeichenketten-Fluten;
   Name höchstens 40, Text höchstens 1000 Zeichen; kein doppelter Text; Sterne nur ganzzahlig 1 bis 5.
6. **Moderation.** Bewertungen mit Name oder Text erscheinen erst nach Freigabe im Control-Panel.
   Reine Sternbewertungen ohne Text erscheinen sofort, weil sie keinen Inhalt tragen
   (umstellbar: `MODERATE_STARS_ONLY = true`). Wird ein Text geändert, geht er erneut in die Prüfung.
   Eine abgelehnte Bewertung kann sich nicht selbst wieder freischalten.

Eigene Bewertung bearbeiten und löschen funktioniert ohne Konto: Der Server gibt einmal einen Schlüssel zurück und speichert
nur dessen Hash. Der Browser merkt sich den Schlüssel in `localStorage` (`textpen-review`).

### 4.2 Recht und Datenschutz (keine Rechtsberatung)

- **UWG § 5b Abs. 3:** Wer Bewertungen zeigt, muss sagen, ob und wie er prüft, dass sie von echten Nutzern stammen.
  Ohne Konten kann TextPen das nicht prüfen. Der Dialog sagt das ehrlich unter „So prüfen wir Bewertungen“.
  Nie „verifiziert“ schreiben.
- **UWG Anhang Nr. 23b/23c:** keine gekauften oder eigenen Bewertungen. Kritische Bewertungen nicht löschen;
  die Moderation prüft nur Spam und Rechtsverstöße, nie die Sternzahl.
- **DSGVO:** gespeichert werden Sterne, optional Name und Text, Zeiten, der Hash des Bearbeitungsschlüssels und
  ein Text-Hash gegen Dubletten. Die IP nur gesalzen gehasht in Limit-Einträgen, die höchstens 24 h leben.
  - `datenschutz.html` braucht einen neuen Abschnitt: Zweck, Rechtsgrundlage Art. 6 Abs. 1 lit. f, Speicherdauer, Löschung.
  - `localStorage` für den Bearbeitungsschlüssel ist für die angefragte Funktion nötig (§ 25 Abs. 2 Nr. 2 TDDDG); trotzdem erwähnen.

### 4.3 Einbau in Worker und ControlStore

1. `reviews/review-store.js` nach `control/src/reviews.js` kopieren und den Import auf `./security.js` ändern.
2. In `store.js`, Konstruktor:
   `this.reviews = new ReviewBook(this.sql, this.env.REVIEW_SECRET, (k, m, w) => this.consumeLimit(k, m, w));`
   Dazu eine RPC-Methode `reviewApi(method, path, data, ip) { return this.reviews.api(method, path, data, ip); }`.
   Neues Worker-Secret `REVIEW_SECRET` (mindestens 32 Zufallszeichen) in `setup.mjs` und `wrangler secret`.
3. `worker.js`:
   - Für Pfade, die mit `/__site/reviews` beginnen, `POST`, `PUT` und `DELETE` erlauben (heute nur `/__site/events`).
   - Bei Schreibzugriffen Origin prüfen; Body mit `body(request, 4000)`.
   - Route **nach** der Policy-Prüfung, damit gesperrte IPs und Wartung greifen, und **vor** `if (url.pathname.startsWith('/__site/')) return hidden();`.
   - Antwort: `const [status, data] = await control.reviewApi(...); return json(data, status);`
4. Feature-Schalter `features.reviews` wie beim GoodNotes-Knopf. Der Footer-Knopf verschwindet, wenn er aus ist.
5. **Panel:** neue Ansicht „Bewertungen“.
   - Warteschlange: freigeben, ablehnen, antworten, löschen; dazu „zuletzt entschieden“; Zahl wartender als Badge.
   - In `state()` kommt `reviews.queue()` / `reviews.recent()` dazu.
   - Neue `action`-Fälle `review-moderate`, `review-reply`, `review-delete`, jeweils mit `audit()`.
   - Vorlage: `dev/serve.mjs` → `/dev/moderation` zeigt dieselben Aufrufe.
6. `index.html`: `reviews.css` und `reviews.client.js` regulär einbinden.

### 4.4 Stellschrauben (`review-store.js`)

- `DIFFICULTY` (16): +1 verdoppelt die Rechenzeit.
- `MIN_FILL_MS` (4000)
- Limits: 2 je Netz und Tag, 200 gesamt
- `MODERATE_STARS_ONLY`

### 4.5 Bewusst weggelassen

- Konten und E-Mail-Bestätigung: passen nicht zu TextPen (siehe Abschnitt 2).
- Emoji-Reaktionen: wenig Nutzen, zusätzliche Spam-Fläche.
- Konfetti.

Alles lässt sich später ergänzen.

---

## 5. Prototyp ausprobieren

Lokaler Server (liefert `textpen-web` unverändert und spielt die Prototyp-Skripte ein):

```bash
node textpen-prototyp/dev/serve.mjs
```

- App mit GoodNotes-Knopf und „Bewertungen“ im Footer: http://localhost:8780
- Moderation, lokaler Ersatz fürs Panel: http://localhost:8780/dev/moderation
- Schrift-Striche prüfen (grau = Umriss, farbig = je ein radierbarer Strich): http://localhost:8780/prototyp/dev/font-check.html?size=200

Tests (10 Stück):

```bash
node --test "textpen-prototyp/test/*.test.mjs"
```

Optional mit echter GoodNotes-Vergleichsdatei: Umgebungsvariable `GOODNOTES_FIXTURE=<Pfad zu einer .goodnotes-Datei>`.

Schrift-Striche neu erzeugen (nach Änderung von `assets/handwriting-vectors.js`):

```bash
node textpen-prototyp/tools/build-font-strokes.mjs
```

**Test in GoodNotes:** `dev/last-export.goodnotes` (Beispieltext, erzeugt im Browser) auf iPad, Windows oder Android
in GoodNotes importieren. Dann prüfen:
- Lässt sich ein einzelner Buchstabe radieren (teilweise und als ganzer Strich)?
- Bleibt das Papier stehen?
- Funktionieren Lasso und Umfärben?

Danach einen eigenen Export mit eigener Handschrift und liniertem Papier testen.

---

## 6. Reihenfolge

1. GoodNotes-Datei auf echten Geräten testen. Danach Einbau als „Beta“ mit Schalter und Anleitung (3.6).
2. Bewertungen: Server (4.3), Panel-Ansicht, Datenschutztext. Erst Lesen und Schreiben mit Moderation,
   dann die Nachfrage nach dem 3. Export.
3. Optional: weitere Apps (Samsung Notes, Notability, OneNote) mit demselben Sink; Papierfoto verkleinern (3.5).

## 7. Quellen

- GPT Genie: https://gptgenie.pro/, /goodnotes, /neuigkeiten, /js/app/*.js (gelesen 02.11.2026)
- goodnotes-codec (MIT): https://github.com/Taylor-Nilsen/goodnotes-codec, docs/FORMAT.md, tests/fixtures/gn-mac-mixed-pens.goodnotes
- GoodNotes-Hilfe zur 5-MB-Importgrenze für kostenlose Konten: https://support.goodnotes.com/hc/en-us/articles/7353717816463
- GoodNotes-Feedbackforum, eingebrannte Anmerkungen beim PDF-Import:
  https://feedback.goodnotes.com/forums/191274-customer-suggestions-for-goodnotes/suggestions/47608964-import-external-app-annotations
