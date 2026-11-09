import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import QRCode from 'qrcode';
import { base32, escapeHTML, passwordHash, token } from '../src/security.js';

export const privateDirectory = path.join(process.env.LOCALAPPDATA || homedir(), 'TextPenControl');
const secretsPath = path.join(privateDirectory, 'secrets.json');
async function protect(directory) {
  if (process.platform === 'win32') {
    const account = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
    const result = spawnSync('icacls.exe', [directory, '/inheritance:r', '/grant:r', `${account}:(OI)(CI)F`], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw Error('Dateiberechtigungen konnten nicht abgesichert werden.');
  } else await chmod(directory, 0o700);
}
export async function provision(input) {
  const adminPath = String(input.path || '').replace(/^https:\/\/bez\.textpen\.de\//, '').replace(/^\//, '').replace(/\/$/, '');
  if (!/^[A-Za-z0-9_-]{50,512}$/.test(adminPath)) throw Error('Der Zugangspfad muss 50–512 URL-taugliche Zeichen enthalten.');
  let previous; try { previous = JSON.parse(await readFile(secretsPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous && !input.update && !input.rotate) throw Error('Einrichtung existiert bereits. Mit --update Zugangsdaten aktualisieren; --rotate ersetzt auch den Authenticator-Schlüssel.');
  await mkdir(privateDirectory, { recursive: true, mode: 0o700 }); await protect(privateDirectory);
  const secrets = {
    ADMIN_PATH: adminPath,
    PASSWORD_HASH: passwordHash(input.password),
    TOTP_SECRET: previous && !input.rotate ? previous.TOTP_SECRET : base32(crypto.getRandomValues(new Uint8Array(20))),
    RECOVERY_NONCE: token(16)
  };
  if (previous?.CF_ACCOUNT_ID) secrets.CF_ACCOUNT_ID = previous.CF_ACCOUNT_ID;
  if (previous?.CF_API_TOKEN) secrets.CF_API_TOKEN = previous.CF_API_TOKEN;
  await writeFile(secretsPath, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  if (!previous || input.rotate) await writeFile(path.join(privateDirectory, 'enrollment.json'), JSON.stringify({ confirmed: false }), { mode: 0o600 });
  await writeAuthenticator(secrets);
  console.log('Zugang lokal vorbereitet. Passwort nur als Argon2id-Verifikator gespeichert.');
  console.log('Private Dateien außerhalb des Projekts: ' + privateDirectory);
  console.log('Google Authenticator über authenticator.html einrichten und anschließend bestätigen.');
}
export async function writeAuthenticator(secrets) {
  const adminPath = secrets.ADMIN_PATH;
  const uri = `otpauth://totp/${encodeURIComponent('TextPen:Eigentümer')}?secret=${secrets.TOTP_SECRET}&issuer=TextPen&algorithm=SHA1&digits=6&period=30`;
  const svg = await QRCode.toString(uri, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
  await writeFile(path.join(privateDirectory, 'authenticator.html'), `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>TextPen · Google Authenticator einrichten</title><style>body{font:16px/1.6 system-ui;background:#101510;color:#edf3e8;margin:40px auto;max-width:650px;padding:24px}main{border:1px solid #435338;border-radius:20px;padding:30px}h1{line-height:1.2}svg{display:block;width:260px;max-width:100%;background:white;border-radius:10px;margin:25px 0}code{overflow-wrap:anywhere;color:#c8ee8c}small{color:#a1b09b}</style><main><h1>TextPen mit Google Authenticator verbinden</h1><ol><li>Öffne Google Authenticator auf deinem Handy.</li><li>Tippe auf „+“ und „QR-Code scannen“.</li><li>Scanne diesen QR-Code. Der Eintrag heißt „TextPen“.</li><li>Bestätige anschließend einmal deinen sechsstelligen Code mit <code>npm run confirm-authenticator</code>.</li></ol>${svg}<details><summary>Schlüssel manuell eingeben</summary><p><code>${secrets.TOTP_SECRET}</code></p><p>Zeitbasiert · 6 Ziffern · 30 Sekunden</p></details><p>Admin-Adresse:<br><code>https://textpen.de/${escapeHTML(adminPath)}</code></p><p><strong>Diese Datei ist geheim.</strong> Bewahre eine geschützte Kopie für die Wiederherstellung auf. Lade sie nicht auf die Website hoch und teile den QR-Code nicht.</p><small>Die Einrichtung enthält keine externen Ressourcen. Dein Passwort wird nicht in dieser Datei gespeichert.</small></main></html>`, { mode: 0o600 });
}
async function main() {
  if (process.argv.includes('--from-stdin')) {
    let raw = ''; for await (const chunk of process.stdin) raw += chunk; await provision(JSON.parse(raw)); return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const accessPath = await rl.question('Zugangspfad (ohne Domain): ');
  rl.close();
  if (!process.stdin.isTTY) throw Error('Passwort nur in einem interaktiven Terminal eingeben.');
  process.stdout.write('Passwort (Eingabe unsichtbar): ');
  const password = await new Promise((resolve, reject) => {
    let value = ''; process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
    const listener = chunk => { for (const char of chunk) { if (char === '\u0003') { cleanup(); reject(Error('Abgebrochen.')); return; } if (char === '\r' || char === '\n') { cleanup(); resolve(value); return; } if (char === '\u007f' || char === '\b') value = value.slice(0, -1); else value += char; } };
    const cleanup = () => { process.stdin.off('data', listener); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); };
    process.stdin.on('data', listener);
  });
  await provision({ path: accessPath, password, update: process.argv.includes('--update'), rotate: process.argv.includes('--rotate') });
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(.:\/)/, '$1'))) main().catch(error => { console.error(error.message); process.exitCode = 1; });
