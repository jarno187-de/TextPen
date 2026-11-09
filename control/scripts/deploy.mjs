import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { privateDirectory } from './setup.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const wrangler = path.join(root, 'node_modules/wrangler/bin/wrangler.js');
const run = (args, extra = {}) => { const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...extra }); if (result.status !== 0) throw Error('Schritt fehlgeschlagen; Veröffentlichung nicht als erfolgreich bestätigt.'); };
try {
  const secretFile = path.join(privateDirectory, 'secrets.json');
  const secrets = JSON.parse(await readFile(secretFile, 'utf8'));
  const enrollment = JSON.parse(await readFile(path.join(privateDirectory, 'enrollment.json'), 'utf8'));
  if (!enrollment.confirmed) throw Error('Bitte zuerst npm run confirm-authenticator ausführen und deinen Handy-Code bestätigen.');
  run(['control/scripts/build.mjs']);
  run([wrangler, 'deploy', '--config', 'control/content.wrangler.jsonc']);
  // The control Worker denies every admin request until its secret configuration is complete.
  run([wrangler, 'deploy', '--config', 'control/wrangler.jsonc']);
  run([wrangler, 'secret', 'bulk', secretFile, '--config', 'control/wrangler.jsonc']);
  console.log('Cloudflare hat beide Dienste und die Secrets angenommen. Jetzt Anmeldung, Domain-Routing und Ausschluss alter Pages-/Preview-Adressen live prüfen.');
} catch (error) { console.error(error.code === 'ENOENT' ? 'Private Einrichtung fehlt. Zuerst npm run setup ausführen.' : error.message); process.exitCode = 1; }
