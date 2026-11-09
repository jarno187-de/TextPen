const fs = require('fs');
const file = 'textpen-web/index.html';
let html = fs.readFileSync(file, 'utf8');
html = html.replace('<link rel="stylesheet" href="privacy.css">', '<link rel="stylesheet" href="privacy.css"><link rel="stylesheet" href="workspace.css">');
html = html.replace('<script src="privacy.js"></script>', '<script src="privacy.js"></script><script src="guide.js"></script>');
html = html.replace('<button id="help-start"', `
<details class="help-section"><summary>Schritt für Schritt: eigene Zeichen zeichnen und verwalten</summary>
<p>Du musst nicht das ganze Alphabet fertigstellen, bevor du deine Schrift ausprobieren kannst. Bereits ein gespeichertes Zeichen lässt sich verwenden. Für alle fehlenden Zeichen bleibt die Beispielschrift verfügbar.</p>
<ol><li>Wechsle zu <b>„Deine Schrift“</b>. Die Gruppen <b>abc</b>, <b>ABC</b> und <b>123 &amp; !</b> enthalten Kleinbuchstaben, Großbuchstaben sowie Zahlen und Sonderzeichen. Wähle das Zeichen, das du schreiben möchtest.</li>
<li>Zeichne mit Maus, Stift oder Finger im Zeichenfeld. Die blasse Vorlage und die Grundlinie helfen dir bei Größe und Position. Du kannst für ein Zeichen mehrere Striche setzen, etwa für einen i-Punkt oder Umlaute.</li>
<li><b>„↶ Zurück“</b> entfernt den letzten Strich. <b>„Leeren“</b> entfernt die aktuelle Zeichnung. Bereits gespeicherte Zeichen bleiben dabei erhalten. Speichere deine Zeichnung vor dem Wechsel zu einem anderen Zeichen.</li>
<li>Mit <b>„Speichern &amp; weiter“</b> übernimmst du das Zeichen und gelangst zum nächsten noch fehlenden Zeichen. Die Anzeige am Zeichen zählt die gespeicherten Varianten und die gewünschte Anzahl.</li>
<li>Wähle ein bereits gespeichertes Zeichen aus, um darunter seine Varianten zu sehen. Mit dem <b>× neben einer Variante</b> entfernst du genau diese Zeichnung. Anschließend kannst du sie neu zeichnen und speichern.</li>
<li>Mit <b>„Meine Handschrift verwenden“</b> gelangst du zurück zu deinem Text. Unter „Handschrift“ kannst du jederzeit zwischen Beispielschrift und eigener Handschrift wechseln.</li></ol>
</details>
<details class="help-section"><summary>Varianten, Durchgänge und Natürlichkeit verstehen</summary>
<p>Öffne in „Deine Schrift“ den Bereich <b>„Varianten &amp; Fortschritt“</b>. Im Variantenmodus wählst du <b>einen bis fünf Durchgänge</b>. Bei ×2 zeichnest du beispielsweise zwei Fassungen jedes Zeichens. Zuerst werden alle Zeichen eines Durchgangs vervollständigt, danach beginnt der nächste. Vorhandene Varianten zählen mit.</p>
<p><b>„Nächstes fehlendes Zeichen“</b> führt dich zur nächsten Lücke. Grüne Zeichen haben die gewählte Anzahl an Varianten erreicht; die Zahlen und die Fortschrittsanzeige zeigen dir den Stand zusätzlich an. Ist das Ziel für ein Zeichen erreicht, kannst du den Variantenmodus erhöhen oder eine vorhandene Variante löschen und ersetzen.</p>
<p>Unter „Text gestalten“ findest du <b>„Natürlichkeit &amp; Varianten“</b>. <b>Unregelmäßigkeit</b> verändert den Höhenversatz der Buchstaben von 0 bis 100 %. Mit <b>„Versatz &amp; Varianten neu mischen“</b> erhältst du eine neue Zusammenstellung deiner gespeicherten Varianten und des Versatzes. Deine Zeichnungen selbst werden dadurch nicht verändert.</p>
</details>
<details class="help-section"><summary>Schriftgröße und Abstände gezielt einstellen</summary>
<p><b>Schriftgröße:</b> 12 bis 64 px. <b>Buchstabendicke:</b> 1 bis 100 %. Beginne mit den voreingestellten 24 px und 25 % und prüfe in der Vorschau, ob die Schrift für deinen Text passt.</p>
<p><b>Buchstaben- und Wortabstand:</b> jeweils 0 bis 100 %. Bei 0 % wird kein zusätzlicher Abstand hinzugefügt. Mehr Wortabstand kann dichte Wörter besser voneinander trennen, ohne die Buchstaben selbst größer zu machen.</p>
<p><b>Zeilenabstand:</b> Bei leerem, gepunktetem und eigenem Papier steht ein freier Faktor von 1,3 bis 2,3 zur Verfügung. Bei liniertem Papier und Collegeblock wählst du eine bis fünf Papierlinien, bei kariertem Papier eine bis fünf Kästchen. Wenn große Buchstaben in die nächste Zeile hineinragen, erhöhe diesen Wert.</p>
<p>Die Vorschau reagiert auf deine Änderungen. TextPen bricht lange Texte auf weitere Seiten um. Größere Schrift, größere Abstände und breitere Ränder können deshalb die Seitenzahl erhöhen.</p>
</details>
<details class="help-section"><summary>Schreibfarben und eigenes Papier einstellen</summary>
<p>Die Farbfelder wählen <b>Schwarz</b> oder <b>Tintenblau</b>. Über <b>+</b> öffnest du die eigene Farbe. Du kannst den Farbwähler, einen sechsstelligen HEX-Code wie #243F65 oder die Regler für Rot, Grün und Blau von 0 bis 255 verwenden. Die Auswahl betrifft deine Schrift; Hell- und Dunkelmodus verändern nur die Oberfläche.</p>
<p>Als Papier stehen <b>Liniert (schmal)</b>, <b>Liniert (breit)</b>, <b>Kariert</b>, <b>Collegeblock</b>, <b>Gepunktet</b>, <b>Leer</b> und <b>Eigenes Papier</b> zur Verfügung.</p>
<ol><li>Wähle unter „Papier“ <b>„Eigenes Papier“</b> und anschließend <b>„Eigenes Papier auswählen“</b>.</li><li>Öffne ein Bild im Format <b>PNG, JPG oder WebP bis 20 MB</b>, etwa einen Scan oder ein Foto deines Papiers.</li><li>Unter „Bild auf der Seite“ entscheidet <b>„Seite füllen“</b> über eine vollständige Bedeckung mit möglichem Beschnitt. <b>„Ganzes Bild einpassen“</b> erhält das ganze Bild mit möglichen freien Rändern. <b>„Auf Seitengröße strecken“</b> füllt die Seite und kann die Proportionen verändern.</li></ol>
<p>Öffne <b>„Papierformat &amp; Ränder“</b> für A4, A5, A6, US Letter oder eine eigene Größe. Eigene Breite und Höhe reichen jeweils von <b>90 bis 420 mm</b>. Du kannst Hoch- oder Querformat und einen Seitenrand von <b>5 bis 40 mm</b> wählen.</p>
</details>
<details class="help-section"><summary>Vorschau, PDF, Bild und Drucken im Alltag</summary>
<p><b>„Zur Vorschau“</b> aktualisiert das Ergebnis und führt dich zur Vorschau. Bei mehreren Seiten kannst du innerhalb der Vorschau nach unten scrollen. Die Anzeige neben „Dein Ergebnis“ nennt Papierformat, Abmessungen und Seitenzahl.</p>
<dl class="control-guide"><div><dt>PDF herunterladen</dt><dd>Erstellt ein Dokument mit allen Seiten im gewählten Papierformat. Geeignet, wenn du den vollständigen Text als Dokument weitergeben möchtest.</dd></div><div><dt>Bild herunterladen</dt><dd>Speichert eine Seite als PNG. Bei mehreren Seiten erscheint „Bildseite“: Wähle zuerst die gewünschte Seite und lade dann das Bild herunter.</dd></div><div><dt>Drucken</dt><dd>Öffnet den Druckdialog deines Browsers. Kontrolliere dort Papierformat, Skalierung und die Vorschau des Druckers, bevor du den Druck startest.</dd></div></dl>
<p>Nach einem Export erscheint unter den Schaltflächen ein Link zur erstellten Datei. Darüber kannst du sie erneut öffnen oder speichern. Solange kein Text eingegeben ist, sind die Export- und Druckschaltflächen deaktiviert.</p>
</details>
<details class="help-section"><summary>Eigene Schrift sichern, laden und später weiterarbeiten</summary>
<p><b>„Schrift sichern“</b> im Bereich „Deine Schrift“ lädt eine JSON-Datei mit deinen gespeicherten Zeichen, Varianten und dem Variantenmodus herunter. Bewahre diese Datei auf, wenn du deine Schrift später oder auf einem anderen Gerät verwenden möchtest.</p>
<p>Mit <b>„Schrift laden“</b> wählst du eine solche TextPen-Datei aus. Wenn bereits Zeichen vorhanden sind, fragt TextPen vor dem Ersetzen nach. Deine Text-, Papier- und Farbeinstellungen werden durch die Schriftdatei nicht gesichert. Für das fertige Ergebnis nutze PDF oder Bild.</p>
<p>Ob TextPen deine Arbeit und den Farbmodus bei einem späteren Besuch wiederherstellen darf, bestimmst du in den vorhandenen <b>Datenschutzeinstellungen</b> im Seitenfuß. Ohne optionale Speicherung solltest du deine Schrift und fertigen Dokumente vor dem Schließen selbst herunterladen.</p>
</details>
<details class="help-section"><summary>Bedienung mit Tastatur, Smartphone und Tablet</summary>
<p>Mit <b>Tab</b> erreichst du Bedienelemente und erkennst den aktuellen Fokus an der Umrandung. Schaltflächen lassen sich mit <b>Enter</b> oder der <b>Leertaste</b> bedienen, Regler nach dem Fokussieren mit den <b>Pfeiltasten</b>. Aufklappbare Bereiche öffnen sich über ihre Überschrift.</p>
<p>Auf kleinen Bildschirmen folgt die Vorschau unter der Eingabe und den Einstellungen. <b>„Zur Vorschau“</b> bringt dich direkt dorthin. Im Zeichenfeld kannst du mit dem Finger oder einem Stift zeichnen; außerhalb des Felds scrollst du durch die Seite.</p>
<p>Über die Darstellungsschaltfläche oben wechselst du zwischen Hell- und Dunkelmodus. Diese Anleitung ist jederzeit über <b>„So funktioniert’s“</b> erreichbar. Schließe sie mit <b>×</b>, <b>Escape</b> oder <b>„Los geht’s – Text eingeben“</b>.</p>
</details>
<button id="help-start"`);
fs.writeFileSync(file, html);
