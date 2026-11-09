import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { privateDirectory } from './setup.mjs';
import { matchTotp, normalizeTotpCode } from '../src/security.js';
import { referenceClock } from './clock.mjs';
const secrets = JSON.parse(await readFile(path.join(privateDirectory, 'secrets.json'), 'utf8'));
let rl;
try {
  console.log('Prüfe die Uhrzeit über öffentliche HTTPS-Zeitangaben. Dein Code und dein Schlüssel werden nicht übertragen.');
  const clock = await referenceClock();
  if (clock.trusted && Math.abs(clock.offset) > 15000) console.log(`Die Windows-Uhr geht ungefähr ${Math.round(Math.abs(clock.offset) / 1000)} Sekunden ${clock.offset > 0 ? 'nach' : 'vor'}. Für diese Bestätigung wird die geprüfte Netzwerkzeit verwendet. Bitte auch unter Windows → Einstellungen → Zeit und Sprache → Datum und Uhrzeit → Jetzt synchronisieren die Uhr korrigieren.`);
  if (!clock.trusted) console.log('Netzwerkzeit konnte nicht unabhängig bestätigt werden. Verwende die automatische Uhrzeit auf PC und Handy.');
  rl = createInterface({ input: process.stdin, output: process.stdout });
  let confirmed = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const input = await rl.question('Aktueller sechsstelliger TextPen-Code (oder q zum Beenden): ');
    if (input.trim().toLowerCase() === 'q') throw Error('Bestätigung abgebrochen. Dein Schlüssel bleibt bestehen.');
    const code = normalizeTotpCode(input);
    if (!code) { console.log('Bitte genau sechs Ziffern eingeben. Leerzeichen zwischen den Ziffern sind erlaubt.'); continue; }
    if (await matchTotp(secrets.TOTP_SECRET, code, Date.now() + clock.offset) !== null) { confirmed = true; break; }
    console.log('Dieser Code passt noch nicht zum gespeicherten TextPen-Schlüssel und der geprüften Uhrzeit. Warte auf den nächsten Code und versuche es erneut. Falls mehrere TextPen-Einträge existieren, verwende den zur aktuellen lokalen QR-Datei gehörenden Eintrag.');
  }
  if (!confirmed) throw Error('Noch nicht bestätigt. Der bestehende Authenticator-Schlüssel wurde nicht verändert.');
  await writeFile(path.join(privateDirectory, 'enrollment.json'), JSON.stringify({ confirmed: true, confirmedAt: new Date().toISOString() }), { mode: 0o600 });
  console.log('Google Authenticator bestätigt. Die Einrichtung ist bereit für die Veröffentlichung.');
} catch (error) { console.error(error.message); process.exitCode = 1; } finally { rl?.close(); }
