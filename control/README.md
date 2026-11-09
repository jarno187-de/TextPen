# TextPen Control

Serverseitige Verwaltung für TextPen. Öffentliche Anwendung: `textpen.de`. Verwaltung: ebenfalls `textpen.de` unter dem ausschließlich als Secret konfigurierten Pfad.

## Was implementiert ist

- Einzelner Eigentümer-Zugang: Argon2id-Passwortprüfung (19 MiB, zwei Durchläufe), Google-Authenticator-kompatible TOTP-Codes. Kein Registrierungsendpunkt.
- HTTPS, hostgebundene HttpOnly-/Secure-/SameSite-Strict-Cookies, CSRF- und Origin-Prüfung, Login-Limits, atomare TOTP-Wiederverwendungssperre, serverseitiger Sitzungswiderruf. 10 Minuten Inaktivität, höchstens 30 Minuten Sitzung.
- Wartung mit Zeitplanung, Hinweisbanner, Seitenregeln und interne Weiterleitungen, Funktionsschalter, Besucher-IP-Sperren mit Ablauf.
- Aggregierte Seitenaufrufe, Fehler und Sperren; optionale Funktionsereignisse ausschließlich nach gesonderter Einwilligung. Keine Besucherprofile oder Dokumentinhalte. 90 Tage Summen und Audit-Verlauf; 30 Tage Erreichbarkeitsstichproben.
- Automatische Einstellungssicherungen, JSON-Export/-Import, sichere Wiederherstellung und Verwaltungsprotokoll.
- Website-Versionen anzeigen und veröffentlichen, wenn ein gesonderter Cloudflare-API-Zugang konfiguriert wurde. Aktionen ändern ausschließlich den Inhalts-Worker.
- Öffentliche Bewertungen ohne Konto: Rechenaufgabe (Proof of Work), Mindestzeit, Honeypot, Limits je Netz über gesalzene IP-Prüfwerte, Inhaltsregeln. Bewertungen mit Name oder Text erscheinen erst nach Freigabe unter „Bewertungen“. Schlüssel abgeleitet aus `REVIEW_SECRET` oder, falls nicht gesetzt, `TOTP_SECRET`. Test: `npm run test:reviews`.
- Funktionsschalter `goodnotes` (Beta-Export, im Browser zusätzlich nur mit eingeschalteter Beta) und `reviews`.
- AdSense ist derzeit nur vorbereitet. Deshalb ist die Aktivierung absichtlich gesperrt; es werden keine Anzeigenskripte geladen. Eine funktionsfähige Anzeigen- und Einwilligungsintegration muss vor einer Freigabe ergänzt werden.

## Architektur

`control/src/worker.js` ist der einzige öffentliche Eingang. Er akzeptiert nur die beiden vorgesehenen Hostnamen. Am Admin-Pfad werden exakter Zugangspfad, HTTPS und die von Cloudflare gesetzte Client-IP geprüft. Der interne `ControlStore` prüft Sitzung, CSRF und Berechtigung. Die Anmeldung ist aus jedem Netz über IPv4 und IPv6 erreichbar; eine IP-Freigabeliste gibt es nicht. Ein Netzwechsel beendet die Sitzung nicht. Die vertrauenswürdige Client-IP dient weiterhin den Login-Limits und den separaten Besuchersperren. Auch Admin-Assets werden niemals aus einem öffentlichen statischen Verzeichnis ausgeliefert.

Der `ControlStore` verwendet ein SQLite-basiertes Durable Object. Diese Wahl statt einer separaten D1-Datenbank erlaubt atomare Sicherheitsentscheidungen und die nötige Rechenzeit für Argon2id im Free-Tarif. Der ausführbare Passwort-Hash und TOTP-Werte wurden in der lokalen Workers-Laufzeit getestet. Passwortverifikator, TOTP-Schlüssel, Zugangspfad werden über Worker Secrets provisioniert, nicht aus Website-JavaScript geladen.

`textpen-content` stellt ausschließlich das durch den Build erlaubte Website-Paket bereit. Er hat keine öffentliche Route und ist nur über das `SITE`-Service-Binding erreichbar. Website-Versionen haben keinen Zugriff auf Admin-Speicher oder Anmeldedaten. Ein Code-Rollback ersetzt keine Datenbanksicherung.

Öffentliche Inhalte passieren die Betriebs-/IP-Prüfung; HTML, Dateien und Einstellungen erhalten `Cache-Control: no-store`. Nur `site-control.js`, `site-control.css` und die öffentlichen, rein lesenden Policy-Endpunkte bleiben bei Wartung und Sperren erreichbar, damit geöffnete Seiten nach der Freigabe selbstständig zurückkehren. Bereits heruntergeladene Inhalte lassen sich nicht zurückholen. Funktionsschalter sind Oberflächensteuerung für lokale Funktionen, kein DRM. Browser-Ereignisse bleiben manipulierbare Meldungen.

Alle vier öffentlichen Seiten abonnieren `/__site/live?path=…` über einen WebSocket mit Durable-Object-Hibernation. Nach einer gespeicherten Änderung, Wiederherstellung oder einem Import sendet der Server die aktuelle öffentliche Policy an alle verbundenen Seiten. Pro Verbindung werden nur Seitenpfad und die am Edge geprüfte IP als temporäres Socket-Attachment gehalten; Admin-Einstellungen, Sperrgründe und Secrets werden nicht übertragen. Banner, Funktionsschalter, Wartung und Seiten-/IP-Sperren greifen ohne Neuladen. Der Wartungs-/Sperrdialog erhält den vorhandenen Editor samt Inhalt; eine ausdrücklich konfigurierte Weiterleitung navigiert zur Zielseite. Wer erst während der Wartung eintrifft, erhält eine Statusseite, die nach der Freigabe die Anwendung lädt.

Durable-Object-Alarme veröffentlichen Beginn/Ende geplanter Banner und Wartung sowie ablaufende IP-Sperren. Heartbeats erkennen unterbrochene Verbindungen; der Client verbindet sich mit ansteigender Wartezeit erneut. Bei fehlender Live-Verbindung dient `/__site/policy?path=…` als HTTP-Fallback. Nach Rückkehr in einen pausierten Tab oder ins Netz wird der Stand erneut abgeglichen. Bei Verbindungsfehlern bleibt die Arbeit erhalten, Exportknöpfe werden vorübergehend verborgen. Tabs, die bereits vor der erstmaligen Veröffentlichung dieses Clients geöffnet waren, brauchen einmalig einen neuen Seitenaufruf; danach erfolgen Einstellungen live. Neue HTML-/JavaScript-Website-Versionen werden nicht in laufende Editor-Sitzungen injiziert.

## Lokale Einrichtung

Voraussetzung: Node.js 22. In diesem Projektordner:

```powershell
npm install
npm run build
npm test
npm run test:integration
npm run test:browser
npm run test:live
npm run test:maintenance
```

Der Browser-Test verwendet das mitinstallierte Playwright mit lokalem Google Chrome. Er verwendet ausschließlich isolierte Testzugangsdaten und eine lokale Workers-Laufzeit. Kein Test liest produktive Secrets.

Die angefragte Einrichtung liegt bereits privat unter `%LOCALAPPDATA%\TextPenControl` (außerhalb von OneDrive und des Projekts):

- `secrets.json`: Zugangspfad, Argon2id-Verifikator, TOTP-Schlüssel und Wiederherstellungskennung. Kein Klartextpasswort.
- `authenticator.html`: vollständig lokale QR-Einrichtung für Google Authenticator, ohne externe Ressourcen.
- `enrollment.json`: Status der einmaligen Bestätigung durch den Eigentümer.

Diese Dateien sind mit Windows-Dateiberechtigungen auf das aktuelle Benutzerkonto beschränkt. **Niemals in den Website-Ordner kopieren oder hochladen.** Den Authenticator-Schlüssel bzw. die Einrichtungsdatei an einem sicheren Ort als Wiederherstellungskopie aufbewahren.

1. `authenticator.html` im Browser öffnen.
2. In Google Authenticator „+“ → „QR-Code scannen“ wählen.
3. Im Projektterminal `npm run confirm-authenticator` starten und den aktuellen TextPen-Code eingeben.

Die Bestätigung prüft vor der Eingabe öffentliche HTTPS-Zeitangaben mehrerer Anbieter. Bei mindestens zwei übereinstimmenden Angaben verwendet sie die geprüfte Netzwerkzeit statt einer eventuell falschen Windows-Uhr. Hierbei werden weder Authenticator-Schlüssel noch Codes übertragen. Die normale Server-Anmeldung behält ihr ursprüngliches Zeitfenster. Der Bestätigungsdialog akzeptiert gruppierte Codes wie `123 456`, erhält führende Nullen und erlaubt mehrere Versuche, ohne den Schlüssel neu zu erzeugen. Bei einer Abweichung die Windows-Uhr unter Einstellungen → Zeit und Sprache → Datum und Uhrzeit → Jetzt synchronisieren korrigieren.

Neue Einrichtung auf einem anderen Computer: `npm run setup`. Passwort wird unsichtbar abgefragt. Mit `npm run setup -- --update` werden Passwort und Pfad aktualisiert, der vorhandene Authenticator bleibt erhalten. `--rotate` ersetzt auch den Authenticator-Schlüssel und verlangt eine erneute Bestätigung. Die Cloudflare-Secrets müssen anschließend mit `wrangler secret bulk` aktualisiert werden.

Die sichere lokale Einrichtung setzt eine neue `RECOVERY_NONCE`; Änderungen an Zugangsdaten oder Wiederherstellungskennung widerrufen beim nächsten Aufruf sämtliche Sitzungen. Alte IP-Freigaben werden aus dem Admin-Speicher entfernt und frühere IP-Secrets ignoriert. Eine Wiederherstellung über HTTP ohne Anmeldung existiert nicht.

## Veröffentlichung bei Cloudflare

Die Live-Aktualisierung wurde am 17.10.2026 auf den bestehenden Workern `textpen-control` und `textpen-content` für `textpen.de` veröffentlicht. Bei späteren Code-Updates beide Worker mit Wrangler aktualisieren; die vorhandenen Secrets bleiben beim normalen Deployment erhalten. Das vollständige Einrichtungsskript unten ist für die Erstprovisionierung gedacht. Ein erfolgreicher lokaler Test oder Dry-Run allein veröffentlicht keine Website.

1. `npx wrangler login` ausführen und im eigenen Cloudflare-Konto anmelden. Bei mehreren Konten das korrekte `account_id` in beiden Konfigurationen ergänzen.
2. Sicherstellen, dass Workers Free und SQLite Durable Objects verfügbar sind. Die Dienste ausschließlich auf dem kostenlosen Tarif betreiben; das Skript kauft keinen Tarif.
3. Die Google-Authenticator-Einrichtung wie oben bestätigen.
4. **Vor dem Domainwechsel bestehendes Pages-/Workers-Routing prüfen.** Ein bestehender Pages-Domain-Eintrag für `textpen.de` kann die Worker-Custom-Domain blockieren. Alte direkte `pages.dev`- und Vorschau-Adressen müssen bei der Umstellung deaktiviert oder mit Zugangsschutz versehen werden; sonst könnten sie die neue Betriebsprüfung umgehen. Keine ungeschützte alte Variante als Ausweichadresse lassen.
5. `npm run deploy` veröffentlicht zunächst den intern erreichbaren Inhalts-Worker, dann den Kontroll-Worker und zuletzt die Secrets. Bis vollständige Secrets vorliegen, bleibt der Admin-Zugang gesperrt. Domain- oder API-Fehler brechen das Skript ab.
6. DNS/TLS für `textpen.de` prüfen. Die Startseite bleibt öffentlich; die Verwaltung liegt unter dem geheimen Pfad auf derselben Domain. Die Login-Seite muss aus beliebigen Netzen erreichbar sein. Admin-API und Panel-Skript müssen ohne Anmeldung 401 liefern. Die Anmeldung aus einem IPv4- und einem IPv6-Netz testen.
7. Wartung ein-/ausschalten, IP-Sperre mit einer separaten Testadresse prüfen, Einstellungen exportieren/importieren und die erste Erreichbarkeitsprüfung kontrollieren.

`workers_dev: false`, `preview_urls: false` und deaktivierte Worker-Logs sind ausdrücklich konfiguriert. Cloudflare-Plattformprotokolle und eigene Kontozugriffe sind dennoch kein Unsichtbarkeitsversprechen. Der geheime Verwaltungspfad wird nicht öffentlich verlinkt. Passwort und Authenticator-Code werden serverseitig geprüft. Eine separate Admin-Subdomain ist nicht erforderlich.

### Veröffentlichungen direkt aus dem Panel

Zusätzlich `CF_ACCOUNT_ID` und ein minimal berechtigtes `CF_API_TOKEN` als Secrets des Kontroll-Workers konfigurieren. Benötigt werden die Cloudflare-Berechtigungen für das Auflisten und Veröffentlichen von Worker-Versionen. Keinen globalen API-Key verwenden. Cloudflare kann diese Berechtigung auf Kontoebene vergeben; der Token muss deshalb wie ein Deployment-Schlüssel geschützt werden. Das Panel verwendet ausschließlich den fest konfigurierten `SITE_SCRIPT=textpen-content`, keine vom Browser gelieferten Skriptnamen.

Neue Website-Pakete zunächst mit `npm run build` und den passenden Tests prüfen, dann `npx wrangler versions upload --config control/content.wrangler.jsonc` verwenden. Das Panel listet diese vorbereiteten Versionen. Eine Veröffentlichung verlangt erneut Passwort und frischen Authenticator-Code; die aktive Version wird über die Provider-API nachgelesen. Nicht bestätigte Ergebnisse erscheinen als Fehler statt als Erfolg.

## Kosten und Grenzen

Worker Free: derzeit 100.000 Anfragen täglich. Die vorangestellte Prüfung bedeutet, dass auch statische Dateiaufrufe Worker-Aufrufe sind. SQLite Durable Objects haben zusätzlich eigene kostenlose Anfrage-, Rechenzeit-, Lese-/Schreib- und Speicherlimits. Messdaten sind begrenzt; Kontoverbrauch wird im Panel nicht erfunden und muss bis zu einer API-Anbindung im Cloudflare-Dashboard nachgesehen werden.

Bei Dienst- oder Kontingentfehlern wird kein ungeschützter Fallback aktiviert. Dadurch kann die Seite ausfallen. Kostenloser Betrieb und unbegrenzte Verfügbarkeit sind nicht gleichzeitig zugesichert. Betriebseinstellungen und Sperren werden serverseitig gespeichert, auch wenn dein PC ausgeschaltet ist.

## Abnahme

- Unit-Tests: IP-Normalisierung, lange Passwörter, RFC-TOTP-Vektor, Zeitfenster, Weiterleitungsschleifen, ungültige Konfiguration.
- Lokale echte Workers-/SQLite-Integration: Zugang aus IPv4-/IPv6-Netzen, Host-/HTTPS-Prüfung, Header-Spoofing, fehlende Konfiguration, Argon2id+TOTP, Replay, Rate-Limits, Cookie/CSRF, Wartung vor Assets, IP-Sperren, atomare Revisionen, Telemetrie ohne Inhaltsfelder, Sicherungen, Sitzungswiderruf und Fehlerpfade.
- Echter Chrome-Browser: Anmeldung und Cookiefluss, gespeicherter Banner auf der Website, Funktionsschalter, tatsächlicher PNG-Export, Einwilligung/Widerruf, IP-Sperre, sieben Ansichten bei 390 und 1440 Pixeln, Browserfehlerfreiheit.
- Live-Tests: vier bereits geöffnete öffentliche Seiten, Banner an/ändern/aus, Wiederverbindung, Funktionsschalter und Einwilligung ohne Reload, Wartung und IP-Sperren mit Erhalt des Editorinhalts, neue Besucher während Wartung. Workers-Tests prüfen zusätzlich Zeitpläne, ablaufende Sperren, Wiederherstellung/Import, Heartbeats und Origin-/Pfadprüfung.
- Wartungsregression: Der Haken für Informationsseiten sperrt Impressum/Datenschutz und blendet deren Links sowohl im ausgelieferten Wartungs-HTML als auch im Live-Dialog aus. Aufheben des Hakens stellt Links und Zugriff ohne Neuladen wieder her; die übrige Website bleibt im Wartungsmodus.
- Zusätzlich vor Live-Freigabe erforderlich: tatsächliche Cloudflare-Konfiguration, alternatives Routing, reale Handy-Anmeldung und Live-Verhalten aus zwei Netzen.
