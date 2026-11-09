import { readdir, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = path.join(root, 'textpen-web'), target = path.join(root, '.build/public');
await mkdir(target, { recursive: true });
const files = [];
async function copy(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) { if (relative === 'assets') { await mkdir(path.join(target, relative), { recursive: true }); await copy(path.join(dir, entry.name), relative + '/'); } continue; }
    if (!/\.(html|css|js|ttf|png|jpg|jpeg|webp|svg|ico|woff2?|xml|webmanifest)$/.test(entry.name) && !['robots.txt', 'ads.txt', 'OFL.txt', 'UNICODE-LICENSE.txt'].includes(entry.name)) continue;
    if (entry.name.includes('.test.') || entry.name.startsWith('.')) continue;
    const content = await readFile(path.join(dir, entry.name));
    await copyFile(path.join(dir, entry.name), path.join(target, relative));
    files.push({ path: '/' + relative, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') });
  }
}
await copy(source);
// Remove obsolete generated assets only within this verified build directory.
const { rm } = await import('node:fs/promises');
async function prune(dir, prefix = '') { for (const entry of await readdir(dir, { withFileTypes: true })) { const rel = prefix + entry.name; if (entry.isDirectory()) await prune(path.join(dir, entry.name), rel + '/'); else if (!files.some(f => f.path === '/' + rel)) await rm(path.join(dir, entry.name)); } }
await prune(target);
const pages = [];
for (const file of files.filter(f => f.path.endsWith('.html'))) { const html = await readFile(path.join(target, file.path.slice(1)), 'utf8'); pages.push({ path: file.path === '/index.html' ? '/' : file.path, title: html.match(/<title>(.*?)<\/title>/s)?.[1] || file.path, bytes: file.bytes }); }
const indexHTML = await readFile(path.join(source, 'index.html'), 'utf8');
const manifest = { version: indexHTML.match(/TEXTPEN WEB ([\d.]+)/i)?.[1] || 'Unbekannt', builtAt: new Date().toISOString(), release: createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 12), pages, files: files.length };
await writeFile(path.join(root, '.build/content-worker.mjs'), `const manifest = ${JSON.stringify(manifest)};\nexport default { async fetch(request,env) { const u=new URL(request.url); if(u.pathname==='/.internal/manifest') return Response.json(manifest); if(u.pathname==='/') { u.pathname='/index.html'; return env.ASSETS.fetch(new Request(u,request)); } return env.ASSETS.fetch(request); } };\n`);
console.log(`Built ${files.length} public files; ${pages.length} pages; release ${manifest.release}. No admin secrets are public assets.`);
