// node --test control/test/goodnotes.test.mjs  — writes .goodnotes files and reads them back with an independent reader.
// When GOODNOTES_FIXTURE points to a real GoodNotes export, the written records must carry the same fields.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';
import { read, delimited, message, one } from './goodnotes-reader.mjs';

// The writer is a browser script; run it as one and take its global.
const GoodNotesFile = vm.runInThisContext(readFileSync(new URL('../../textpen-web/goodnotes-writer.js', import.meta.url), 'utf8') + '\n;GoodNotesFile');
const load = (file, name) => vm.runInThisContext(readFileSync(new URL('../../textpen-web/' + file, import.meta.url), 'utf8') + '\n;' + name);
const InkCurves = load('ink-curves.js', 'InkCurves'), FontStrokes = load('assets/font-strokes.js', 'FontStrokes'), HandwritingVectors = load('assets/handwriting-vectors.js', 'HandwritingVectors');
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

test('a curve is stored as it is: start point and quadratic pieces, no straight substitutes', async () => {
  const doc = GoodNotesFile.create('Kurve'), page = doc.addPage(doc.attach(pdf), 595.28, 841.89), unit = 11 / 6;
  page.curve([10, 20, 30, 60, 50, 20, 70, -20, 90, 20], 1.5);
  page.curve([100, 100], 2);          // dot
  page.curve([NaN, 1, 2, 3, 4, 5], 1); // never written
  const [a, dot, ...rest] = read(await doc.save()).pages[0].strokes.map(s => s.geometry);
  assert.equal(rest.length, 0);
  assert.deepEqual(a.kinds, [0, 1, 1]);
  const near = (got, want) => got.every((v, i) => Math.abs(v - want[i] * unit) < 0.02);
  assert.ok(a.moves.length === 1 && near(a.moves[0], [10, 20]));
  assert.ok(near(a.quads[0], [30, 60, 50, 20]) && near(a.quads[1], [70, -20, 90, 20]), 'control points arrive unchanged');
  assert.equal(dot.quads.length, 1);
});

// Angles between the end of one curve piece and the start of the next, in degrees.
function kinks(path) {
  const out = [];
  for (let i = 6; i + 3 < path.length; i += 4) {
    const ax = path[i - 2] - path[i - 4], ay = path[i - 1] - path[i - 3], bx = path[i] - path[i - 2], by = path[i + 1] - path[i - 1];
    out.push(Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) * 180 / Math.PI);
  }
  return out;
}
const PEN = { tolerance: 0.8, smooth: 2.5, cornerSpan: 5 };   // as in goodnotes-export.js
let seed = 5; const random = () => (seed = Math.imul(seed, 1103515245) + 12345 >>> 0) / 4294967296;

test('a drawn line becomes one smooth pen curve without straight pieces or kinks', () => {
  // An "o"-like arc drawn with a jittery pointer that reports whole pixels.
  const drawn = [];
  for (let i = 0; i <= 240; i++) { const t = i / 240 * 5.5; drawn.push(Math.round(300 + 60 * Math.cos(t) + (random() - 0.5) * 1.4), Math.round(150 + 60 * Math.sin(t) + (random() - 0.5) * 1.4)); }
  const path = InkCurves.fit(drawn, PEN), pieces = (path.length - 2) / 4;
  assert.ok(pieces >= 4 && pieces <= 20, `${pieces} curve pieces for ${drawn.length / 2} pointer samples`);
  assert.deepEqual(path.slice(0, 2), drawn.slice(0, 2)); assert.deepEqual(path.slice(-2), drawn.slice(-2));
  assert.ok(Math.max(...kinks(path)) < 3, 'neighbouring pieces share their tangent');
  const flat = InkCurves.flatten(path, 0.5); let worst = 0;
  for (let i = 0; i < flat.length; i += 2) worst = Math.max(worst, Math.abs(Math.hypot(flat[i] - 300, flat[i + 1] - 150) - 60));
  assert.ok(worst < 1.5, `stays on the drawn circle (off by ${worst.toFixed(2)})`);
  // The old export joined the samples with straight pieces: kinks everywhere.
  const straight = drawn.slice(0, 2); for (let i = 2; i < drawn.length; i += 2) straight.push((drawn[i - 2] + drawn[i]) / 2, (drawn[i - 1] + drawn[i + 1]) / 2, drawn[i], drawn[i + 1]);
  assert.ok(kinks(straight).filter(k => k > 8).length > 50);
});

test('real corners stay sharp, loops close smoothly, odd input is harmless', () => {
  const zigzag = []; for (let i = 0; i <= 80; i++) zigzag.push(i, 200 - 2 * i); for (let i = 1; i <= 80; i++) zigzag.push(80 + i, 40 + 2 * i);   // "Λ"
  const path = InkCurves.fit(zigzag, PEN), sharp = kinks(path).filter(k => k > 3);
  assert.equal(sharp.length, 1); assert.ok(sharp[0] > 50);
  let tip = Infinity; for (let i = 0; i < path.length; i += 2) tip = Math.min(tip, Math.hypot(path[i] - 80, path[i + 1] - 40));
  assert.ok(tip < 1.5, 'the corner point is still on the curve');
  const ring = []; for (let i = 0; i < 120; i++) ring.push(100 + 40 * Math.cos(i / 120 * 2 * Math.PI), 100 + 25 * Math.sin(i / 120 * 2 * Math.PI));
  const loop = InkCurves.fit(ring, { tolerance: 0.4, closed: true });
  assert.deepEqual(loop.slice(0, 2), loop.slice(-2));
  assert.ok(Math.max(...kinks([...loop, ...loop.slice(2, 6)])) < 3, 'no kink where the loop closes');
  assert.deepEqual(InkCurves.fit([]), []); assert.deepEqual(InkCurves.fit([3, 4, 3, 4]), [3, 4]); assert.deepEqual(InkCurves.fit([0, 0, 10, 0]), [0, 0, 5, 0, 10, 0]);
  for (let k = 0; k < 200; k++) {   // scribbles
    const p = []; let x = random() * 600, y = random() * 300;
    for (let i = 0, n = 1 + Math.floor(random() * 60); i < n; i++) { x += (random() - 0.5) * 30; y += (random() - 0.5) * 30; p.push(Math.round(x), Math.round(y)); }
    const out = InkCurves.fit(p, PEN);
    assert.ok(out.every(Number.isFinite) && (out.length - 2) % 4 === 0);
  }
});

test('built-in font: every glyph is written as pen strokes that run inside its ink', () => {
  const rings = path => {
    const out = []; let ring, nums = [];
    for (const t of path.split(/\s+/).filter(Boolean)) {
      if (!/^[mlch]$/.test(t)) { nums.push(+t); continue; }
      if (t === 'm') out.push(ring = [[nums[0], nums[1]]]); else if (t === 'l') ring.push([nums[0], nums[1]]);
      else if (t === 'c') { const [x0, y0] = ring.at(-1), [x1, y1, x2, y2, x3, y3] = nums; for (let k = 1; k <= 8; k++) { const a = k / 8, b = 1 - a; ring.push([b * b * b * x0 + 3 * b * b * a * x1 + 3 * b * a * a * x2 + a * a * a * x3, b * b * b * y0 + 3 * b * b * a * y1 + 3 * b * a * a * y2 + a * a * a * y3]); } }
      nums = [];
    }
    return out;
  };
  const inside = (R, x, y) => { let wind = 0; for (const r of R) for (let i = 0; i < r.length; i++) { const [x0, y0] = r[i], [x1, y1] = r[(i + 1) % r.length]; if ((y0 <= y) !== (y1 <= y) && x0 + (y - y0) / (y1 - y0) * (x1 - x0) > x) wind += y1 > y0 ? 1 : -1; } return wind !== 0; };
  assert.deepEqual(FontStrokes.chars, HandwritingVectors.chars); assert.equal(FontStrokes.paths.length, HandwritingVectors.paths.length);
  let samples = 0, outside = 0, joints = 0, bent = 0;
  for (const [char, glyph] of Object.entries(HandwritingVectors.chars)) {
    const outline = rings(HandwritingVectors.paths[glyph]), strokes = FontStrokes.paths[glyph]; let mine = 0, off = 0;
    assert.equal(strokes.length > 0, outline.length > 0, `strokes for "${char}"`);
    for (const [width, ...curve] of strokes) {
      assert.ok(width > 0 && curve.length >= 2 && (curve.length - 2) % 4 === 0 && curve.every(Number.isInteger), `stroke layout of "${char}"`);
      const flat = InkCurves.flatten(curve, 4);
      for (let i = 0; i < flat.length; i += 2) { mine++; if (!inside(outline, flat[i], flat[i + 1])) off++; }
      for (const k of kinks(curve)) { joints++; if (k > 8) bent++; }
    }
    assert.ok(off <= 0.06 * mine, `pen path of "${char}" leaves the letter`);
    samples += mine; outside += off;
  }
  assert.ok(outside < 0.001 * samples, `${outside} of ${samples} path points outside the ink`);
  // Mostly smooth joints; the rest are the corners of letters like "k", "M", "z" (stored in whole font units).
  assert.ok(bent < 0.12 * joints, `${bent} of ${joints} joints bend`);
  for (const char of 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789äöüÄÖÜß') assert.ok(FontStrokes.paths[FontStrokes.chars[char]].length <= 4, `"${char}" is written in few strokes`);
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
