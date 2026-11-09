import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { privateDirectory } from './setup.mjs';
const secrets = JSON.parse(await readFile(path.join(privateDirectory, 'secrets.json'), 'utf8'));
const needles = [secrets.ADMIN_PATH, secrets.TOTP_SECRET, secrets.PASSWORD_HASH];
let inspected = 0;
async function scan(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.name.startsWith('.') || item.name === 'node_modules') continue;
    const file = path.join(directory, item.name);
    if (item.isDirectory()) await scan(file);
    else if (/\.(?:js|mjs|html|css|json|jsonc|txt|md)$/.test(item.name)) {
      const content = await readFile(file, 'utf8'); inspected++;
      if (needles.some(secret => content.includes(secret))) throw Error('Secret found in project file: ' + file);
    }
  }
}
await scan('textpen-web'); await scan('control'); await scan('.build/public');
console.log(`Secret scan passed for ${inspected} source/public text files.`);
