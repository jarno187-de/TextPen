// Local preview of the prototype: serves textpen-web unchanged, injects the prototype scripts into the
// start page, and answers /__site/reviews with the same ReviewBook the Durable Object would run.
// /dev/moderation stands in for the TextPen Control panel. Local only (127.0.0.1); not for deployment.
//   node textpen-prototyp/dev/serve.mjs   →  http://localhost:8780
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ReviewBook } from '../reviews/review-store.js';
import { memorySql } from '../reviews/sqlite-adapter.js';

const here = path.dirname(fileURLToPath(import.meta.url)), prototype = path.join(here, '..'), site = path.join(here, '../../textpen-web');
const port = Number(process.env.PORT) || 8780;
const { sql, limit } = memorySql(path.join(here, 'reviews-dev.sqlite'));
const reviews = new ReviewBook(sql, 'local-dev-secret-not-for-production', limit);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.svg': 'image/svg+xml' };
const inject = `<link rel="stylesheet" href="/prototyp/reviews/reviews.css">
<script src="/prototyp/goodnotes/goodnotes-writer.js"></script><script src="/prototyp/goodnotes/font-strokes.js"></script>
<script src="/prototyp/goodnotes/goodnotes-export.js"></script><script src="/prototyp/reviews/reviews.client.js"></script>`;

async function readJSON(req) {
  let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 12000) throw Object.assign(Error('Anfrage zu groß.'), { status: 413 }); }
  return raw ? JSON.parse(raw) : {};
}
function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
async function file(res, root, rel) {
  const target = path.join(root, rel);
  if (!target.startsWith(root + path.sep)) return send(res, 404, { error: 'Nicht gefunden.' });
  try { send(res, 200, await readFile(target), types[path.extname(target)] || 'application/octet-stream'); }
  catch { send(res, 404, { error: 'Nicht gefunden.' }); }
}

const moderation = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Moderation (lokal)</title>
<style>body{font:15px system-ui;max-width:760px;margin:24px auto;padding:0 16px}li{border:1px solid #ccc;border-radius:8px;padding:10px;margin:8px 0;list-style:none}textarea{width:100%}</style>
<h1>Bewertungen moderieren (lokaler Ersatz für TextPen Control)</h1><h2>Warten auf Prüfung</h2><ol id="queue"></ol><h2>Zuletzt entschieden</h2><ol id="recent"></ol>
<script>
const el=(t,p={},...c)=>{const n=Object.assign(document.createElement(t),p);n.append(...c);return n;};
async function act(body){await fetch('/dev/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});load();}
function item(r){const reply=el('textarea',{rows:2,value:r.reply,placeholder:'Antwort (öffentlich)'});
 return el('li',{},el('strong',{textContent:'#'+r.id+' · '+'★'.repeat(r.rating)+' · '+(r.name||'Anonym')+' · '+r.status}),el('p',{textContent:r.text||'(nur Sterne)'}),reply,
  el('div',{},el('button',{textContent:'Veröffentlichen',onclick:()=>act({action:'published',id:r.id})}),' ',el('button',{textContent:'Ablehnen',onclick:()=>act({action:'rejected',id:r.id})}),' ',
  el('button',{textContent:'Antwort speichern',onclick:()=>act({action:'reply',id:r.id,text:reply.value})}),' ',el('button',{textContent:'Löschen',onclick:()=>act({action:'purge',id:r.id})})));}
async function load(){const d=await (await fetch('/dev/api')).json();queue.replaceChildren(...d.queue.map(item));recent.replaceChildren(...d.recent.map(item));}
load();
</script>`;

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'), p = decodeURIComponent(url.pathname);
    if (p.startsWith('/__site/reviews')) {
      const data = req.method === 'GET' ? Object.fromEntries(url.searchParams) : await readJSON(req);
      const [status, body] = await reviews.api(req.method, p, data, req.socket.remoteAddress);
      return send(res, status, body);
    }
    if (p === '/dev/moderation') return send(res, 200, moderation, types['.html']);
    if (p === '/dev/save' && req.method === 'POST') {   // keeps the last export for the Node reader (test/goodnotes-reader.mjs)
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      await writeFile(path.join(here, 'last-export.goodnotes'), Buffer.concat(chunks));
      return send(res, 200, { ok: true });
    }
    if (p === '/dev/api') {
      if (req.method === 'GET') return send(res, 200, { queue: reviews.queue(), recent: reviews.recent() });
      const { action, id, text } = await readJSON(req);
      if (action === 'reply') reviews.reply(id, text); else if (action === 'purge') reviews.purge(id); else reviews.moderate(id, action);
      return send(res, 200, { ok: true });
    }
    if (p.startsWith('/prototyp/')) return file(res, prototype, p.slice('/prototyp/'.length));
    if (p === '/' || p === '/index.html') {
      const html = await readFile(path.join(site, 'index.html'), 'utf8');
      // textpen-web now ships these scripts itself; only inject into an older copy.
      return send(res, 200, html.includes('reviews.css') ? html : html.replace('</body>', inject + '</body>'), types['.html']);
    }
    if (p.startsWith('/__site/')) return send(res, 404, { error: 'Im lokalen Test nicht vorhanden.' });
    return file(res, site, p.slice(1));
  } catch (e) { send(res, e.status || 500, { error: e.message }); }
}).listen(port, '127.0.0.1', () => console.log(`TextPen-Prototyp: http://localhost:${port}  ·  Moderation: http://localhost:${port}/dev/moderation`));
