// node --test control/test/goodnotes.test.mjs  — writes .goodnotes files and reads them back with an independent reader.
// When GOODNOTES_FIXTURE points to a real GoodNotes export, the written records must carry the same fields.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';
import { read, delimited, message, one } from './goodnotes-reader.mjs';

// The writer is a browser script; run it as one and take its global.
const GoodNotesFile = vm.runInThisContext(readFileSync(new URL('../../textpen-web/goodnotes-writer.js', import.meta.url), 'utf8') + '\n;GoodNotesFile');
const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');

async function sample() {
  const doc = GoodNotesFile.create('Test äöü'), paper = doc.attach(pdf);
  const first = doc.addPage(paper, 595.28, 841.89);
  first.stroke([10, 20, 30, 40, 50, 20], 1.2, [0.1, 0.2, 0.3, 1]);
  first.stroke([100, 100], 2);                       // a dot (i-dot, full stop)
  const long = []; for (let i = 0; i < 3000; i++) long.push(i / 10, Math.sin(i / 50) * 20 + 300);
  first.stroke(long, 0.8);                           // geometry above 32 KiB spans several bv41 chunks
  doc.addPage(paper, 595.28, 841.89).stroke([0, 0, 595.28, 841.89], 1);
  doc.addPage(paper, 595.28, 841.89);                // empty page stays valid
  return doc.save();
}

test('written notebook reads back with pages, order, paper and exact geometry', async () => {
  const doc = read(await sample());
  assert.equal(doc.title, 'Test äöü');
  assert.deepEqual(doc.pages.map(p => p.strokes.length), [3, 1, 0]);
  const [page] = doc.pages, unit = 11 / 6;
  assert.ok(doc.files.has('attachments/' + page.background), 'paper PDF is attached');
  assert.ok(Math.abs(page.size[0] - 595.28 * unit) < 0.01 && Math.abs(page.size[1] - 841.89 * unit) < 0.01);
  const g = page.strokes[0].geometry;
  assert.equal(g.schema, 'vuA(v)A(S(uu))A(S(uuuu))vA(f)');
  assert.equal(g.version, 2); assert.equal(g.rest, 0); assert.equal(g.one, 1); assert.deepEqual(g.widths, []);
  assert.deepEqual(g.kinds, [0, 1, 1]);
  assert.ok(Math.abs(g.width - 1.2 * unit) < 1 / 64);
  assert.ok(Math.abs(g.moves[0][0] - 10 * unit) < 0.02 && Math.abs(g.quads[1][2] - 50 * unit) < 0.02 && Math.abs(g.quads[1][3] - 20 * unit) < 0.02);
  assert.deepEqual([...page.strokes[0].color.values()].map(v => +v[0].toFixed(3)), [0.1, 0.2, 0.3, 1]);
  assert.equal(page.strokes[1].geometry.kinds.length, 2, 'dot has a tiny tail');
  assert.equal(page.strokes[2].geometry.quads.length, 2999);
  const notes = doc.files.get('notes/' + page.notes), records = delimited(notes).map(message);
  const sequences = records.filter(r => !r.has(7)).map(r => one(r, 9));
  assert.deepEqual(sequences, [...sequences].sort((a, b) => a - b), 'creation sequence increases');
});

test('event log references stay consistent', async () => {
  const doc = read(await sample()), ids = new Set();
  for (const e of doc.events) ids.add(new TextDecoder().decode(one(e, 1)));
  for (const p of doc.pages) { assert.ok(ids.has(p.id)); assert.ok(ids.has(p.notes)); }
  assert.equal(doc.kinds.filter(k => k === 102).length, 2, 'one "items updated" event per page with ink');
  assert.equal(doc.kinds[0], 30);
  assert.equal(new Set(doc.pages.map(p => p.key)).size, 3);
});

const fixture = process.env.GOODNOTES_FIXTURE;
test('records carry the same fields as a real GoodNotes export', { skip: !fixture || !existsSync(fixture) }, async () => {
  const real = read(new Uint8Array(readFileSync(fixture))), mine = read(await sample());
  const fields = (doc, kind) => { const e = doc.events.find(x => x.has(kind) && (kind !== 105 || message(one(x, kind)).has(4))); return [...message(one(e, kind)).keys()].sort((a, b) => a - b).join(','); };
  for (const kind of [30, 6, 54, 10, 104, 102, 105]) assert.equal(fields(mine, kind), fields(real, kind), 'event ' + kind);
  const layer = d => [...message(one(d.events.find(x => x.has(2) && message(one(x, 2)).has(8)), 2)).keys()].filter(k => k !== 9).join(',');
  assert.equal(layer(mine), layer(real), 'paper layer event (template name 9 is optional)');
  const stroke = d => { const p = d.pages[0], r = delimited(d.files.get('notes/' + p.notes)).map(message); const i = r.findIndex(x => x.has(7) && !message(one(x, 7)).has(3) && !message(one(x, 7)).has(5)); return [[...r[i - 1].keys()].join(','), [...message(one(r[i], 7)).keys()].join(',')]; };
  assert.deepEqual(stroke(mine), stroke(real));
  assert.deepEqual([...real.files.keys()].filter(n => !n.includes('/') && n !== 'thumbnail.jpg').sort(), [...mine.files.keys()].filter(n => !n.includes('/')).sort());
});
