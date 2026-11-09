// Builds goodnotes/font-strokes.js: centreline pen strokes for every glyph of the built-in font.
// GoodNotes can only erase pen strokes, but handwriting.ttf (Caveat) glyphs are filled outlines.
// Per glyph: rasterise the outline, thin it to a 1 px skeleton (Zhang & Suen), trace the skeleton into
// polylines, join branches that continue straight through a junction, and give each polyline the
// median stroke width measured on the skeleton. Finally every glyph's widths are scaled so the
// strokes cover as much ink as the outline, and the coverage (IoU) is reported.
// Run: node control/scripts/build-font-strokes.mjs   (only after handwriting-vectors.js changes; output is a static asset)
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url), S = 0.25, PAD = 4;   // pixels per font unit, border
const source = readFileSync(new URL('textpen-web/assets/handwriting-vectors.js', root), 'utf8');
const font = JSON.parse(source.slice(source.indexOf('{'), source.lastIndexOf('}') + 1));

/** PDF path ("x y m", "x y l", "x1 y1 x2 y2 x3 y3 c", "h") → closed rings of [u, v] font-unit points. */
function rings(path) {
  const out = []; let ring = null, nums = [];
  for (const t of path.split(/\s+/).filter(Boolean)) {
    if (!/^[mlch]$/.test(t)) { nums.push(+t); continue; }
    if (t === 'm') { ring = [[nums[0], nums[1]]]; out.push(ring); }
    else if (t === 'l') ring.push([nums[0], nums[1]]);
    else if (t === 'c') {
      const [x0, y0] = ring[ring.length - 1], [x1, y1, x2, y2, x3, y3] = nums;
      for (let k = 1; k <= 12; k++) { const a = k / 12, b = 1 - a; ring.push([b * b * b * x0 + 3 * b * b * a * x1 + 3 * b * a * a * x2 + a * a * a * x3, b * b * b * y0 + 3 * b * b * a * y1 + 3 * b * a * a * y2 + a * a * a * y3]); }
    }
    nums = [];
  }
  return out.filter(r => r.length > 2);
}

/** Non-zero winding scanline fill at pixel centres. */
function rasterise(polys, w, h) {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const cy = y + 0.5, hits = [];
    for (const r of polys) for (let i = 0; i < r.length; i++) {
      const [x0, y0] = r[i], [x1, y1] = r[(i + 1) % r.length];
      if ((y0 <= cy) !== (y1 <= cy)) hits.push([x0 + (cy - y0) / (y1 - y0) * (x1 - x0), y1 > y0 ? 1 : -1]);
    }
    hits.sort((a, b) => a[0] - b[0]);
    let wind = 0;
    for (let i = 0; i < hits.length - 1; i++) {
      wind += hits[i][1];
      if (wind) for (let x = Math.max(0, Math.ceil(hits[i][0] - 0.5)); x < Math.min(w, Math.ceil(hits[i + 1][0] - 0.5)); x++) mask[y * w + x] = 1;
    }
  }
  return mask;
}

function thin(mask, w, h) {
  const s = new Uint8Array(mask);
  for (let changed = true; changed;) {
    changed = false;
    for (const step of [0, 1]) {
      const kill = [];
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x; if (!s[i]) continue;
        const p = [s[i - w], s[i - w + 1], s[i + 1], s[i + w + 1], s[i + w], s[i + w - 1], s[i - 1], s[i - w - 1]];   // P2…P9
        const b = p.reduce((a, c) => a + c, 0); if (b < 2 || b > 6) continue;
        let a = 0; for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) % 8]) a++;
        if (a !== 1) continue;
        if (step === 0 ? p[0] * p[2] * p[4] || p[2] * p[4] * p[6] : p[0] * p[2] * p[6] || p[0] * p[4] * p[6]) continue;
        kill.push(i);
      }
      for (const i of kill) s[i] = 0;
      if (kill.length) changed = true;
    }
  }
  // Zhang & Suen leaves 2 px thick stair-steps on diagonals. Remove every pixel whose removal keeps the
  // 8-connectivity of its neighbours (Yokoi number 1), except line ends.
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x; if (!s[i]) continue;
    const n = [s[i + 1], s[i - w + 1], s[i - w], s[i - w - 1], s[i - 1], s[i + w - 1], s[i + w], s[i + w + 1]].map(v => 1 - v);   // E NE N NW W SW S SE, inverted
    let yokoi = 0; for (const k of [0, 2, 4, 6]) yokoi += n[k] - n[k] * n[k + 1] * n[(k + 2) % 8];
    if (yokoi === 1 && n.filter(v => !v).length >= 2) s[i] = 0;
  }
  return s;
}

/** Distance from a pixel centre to the nearest background pixel centre. */
function distance(mask, w, h, i) {
  const x = i % w, y = (i - x) / w; let best = Infinity;
  for (let r = 1; r * r < best && r < 60; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= w || yy >= h || !mask[yy * w + xx]) best = Math.min(best, dx * dx + dy * dy);
  }
  return Math.sqrt(best);
}

const N8 = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]];
/** Skeleton → polylines of pixel indices, the way a pen would draw them: start at free ends, keep going in
 *  the straightest direction (so a stem runs straight through a junction), then trace leftover branches and
 *  loops. A branch that stops next to an earlier line is connected to it, so junctions have no gaps. */
function trace(sk, w, h) {
  const near = i => { const x = i % w, y = (i - x) / w, out = []; for (const [dx, dy] of N8) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h && sk[yy * w + xx]) out.push(yy * w + xx); } return out; };
  const pixels = []; for (let i = 0; i < w * h; i++) if (sk[i]) pixels.push(i);
  const owner = new Map(), lines = [];
  const step = (a, b) => [b % w - a % w, Math.floor(b / w) - Math.floor(a / w)];
  function walk(start) {
    const line = [start]; owner.set(start, line);
    for (;;) {
      const cur = line[line.length - 1], free = near(cur).filter(n => !owner.has(n));
      if (!free.length) break;
      // Heading = average of the last few steps, so pixel stair-steps do not count as turns.
      const back = line[Math.max(0, line.length - 5)], [hx, hy] = line.length > 1 ? step(back, cur) : [0, 0], hl = Math.hypot(hx, hy) || 1;
      const score = n => { const [dx, dy] = step(cur, n), d = Math.hypot(dx, dy); return (hx * dx + hy * dy) / hl / d - (d > 1 ? 0.05 : 0); };
      const next = free.reduce((a, b) => score(b) > score(a) ? b : a);
      if (line.length > 2 && score(next) < -0.3) break;   // never fold back on itself
      line.push(next); owner.set(next, line);
    }
    for (const end of [0, 1]) {   // join into an earlier line (or close a loop) when it ends right next to one
      const p = end ? line[line.length - 1] : line[0], skip = new Set(end ? line.slice(-4) : line.slice(0, 4));
      const join = near(p).find(n => owner.has(n) && !skip.has(n) && (owner.get(n) !== line || line.length > 6));
      if (join !== undefined) end ? line.push(join) : line.unshift(join);
    }
    lines.push(line);
  }
  const ends = pixels.filter(i => near(i).length === 1);
  for (const i of ends) if (!owner.has(i)) walk(i);
  for (const i of pixels) if (!owner.has(i)) walk(i);
  return lines;
}

const xy = (i, w) => [i % w + 0.5, Math.floor(i / w) + 0.5];
function simplify(P, tol) {
  if (P.length < 3) return P;
  const keep = new Uint8Array(P.length); keep[0] = keep[P.length - 1] = 1;
  for (const stack = [[0, P.length - 1]]; stack.length;) {
    const [a, b] = stack.pop(), [ax, ay] = P[a], dx = P[b][0] - ax, dy = P[b][1] - ay, L = dx * dx + dy * dy;
    let best = 0, at = -1;
    for (let i = a + 1; i < b; i++) {
      const t = L ? Math.max(0, Math.min(1, ((P[i][0] - ax) * dx + (P[i][1] - ay) * dy) / L)) : 0, d = Math.hypot(ax + t * dx - P[i][0], ay + t * dy - P[i][1]);
      if (d > best) { best = d; at = i; }
    }
    if (best > tol) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return P.filter((_, i) => keep[i]);
}
const smooth = P => P.length < 3 ? P : P.map((p, i) => i === 0 || i === P.length - 1 ? p : [(P[i - 1][0] + 2 * p[0] + P[i + 1][0]) / 4, (P[i - 1][1] + 2 * p[1] + P[i + 1][1]) / 4]);

function cover(strokes, w, h) {
  const out = new Uint8Array(w * h);
  for (const { pts, width } of strokes) {
    const r = width / 2, segs = pts.length > 1 ? pts.slice(1).map((p, i) => [pts[i], p]) : [[pts[0], pts[0]]];
    for (const [[x0, y0], [x1, y1]] of segs) {
      const dx = x1 - x0, dy = y1 - y0, L = dx * dx + dy * dy;
      for (let y = Math.max(0, Math.floor(Math.min(y0, y1) - r)); y < Math.min(h, Math.ceil(Math.max(y0, y1) + r)); y++)
        for (let x = Math.max(0, Math.floor(Math.min(x0, x1) - r)); x < Math.min(w, Math.ceil(Math.max(x0, x1) + r)); x++) {
          const cx = x + 0.5, cy = y + 0.5, t = L ? Math.max(0, Math.min(1, ((cx - x0) * dx + (cy - y0) * dy) / L)) : 0;
          if (Math.hypot(x0 + t * dx - cx, y0 + t * dy - cy) <= r) out[y * w + x] = 1;
        }
    }
  }
  return out;
}

function glyph(path) {
  const polys = rings(path); if (!polys.length) return { strokes: [], iou: 1 };
  const all = polys.flat(), minU = Math.min(...all.map(p => p[0])), maxV = Math.max(...all.map(p => p[1]));
  const w = Math.ceil((Math.max(...all.map(p => p[0])) - minU) * S) + 2 * PAD, h = Math.ceil((maxV - Math.min(...all.map(p => p[1]))) * S) + 2 * PAD;
  const px = polys.map(r => r.map(([u, v]) => [(u - minU) * S + PAD, (maxV - v) * S + PAD]));
  const mask = rasterise(px, w, h), sk = thin(mask, w, h), dist = new Map();
  const r = i => { if (!dist.has(i)) dist.set(i, Math.max(0.5, distance(mask, w, h, i) - 0.5)); return dist.get(i); };
  const median = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
  const lines = trace(sk, w, h), onLine = new Set();
  // Stair-step leftovers (a few pixels hugging another line) are covered by its round caps anyway.
  const kept = [];
  for (const l of lines.sort((a, b) => b.length - a.length)) {
    const covered = l.length <= 3 && l.every(i => [i, ...N8.map(([dx, dy]) => i + dy * w + dx)].some(n => onLine.has(n)));
    if (!covered) { kept.push(l); for (const i of l) onLine.add(i); }
  }
  // One stroke per stretch of similar width: a comma's head and tail, a brush-like swell, keep their weight.
  const parts = [];
  for (const l of kept) {
    const rs = l.map(r), win = i => median(rs.slice(Math.max(0, i - 3), i + 4));
    let start = 0;
    for (let i = 1; i < l.length; i++) {
      const ref = median(rs.slice(start, i)), q = win(i) / ref;
      if ((q > 1.6 || q < 0.6) && i - start >= 2 * ref && l.length - i >= 2 * ref) { parts.push(l.slice(start, i + 1)); start = i; }
    }
    parts.push(l.slice(start));
  }
  let strokes = parts.map(l => ({ pts: simplify(smooth(smooth(l.map(i => xy(i, w)))), 0.6), width: 2 * median(l.map(r)) }));
  // A clearly thicker head (comma, quotes: 1.6× the median) gets a dot there, but only on short marks or
  // near a stroke end: a stray dot left behind mid-letter after erasing would be annoying.
  for (const l of parts) {
    const rs = l.map(r), top = rs.indexOf(Math.max(...rs));
    if ((l.length < 6 * median(rs) || top < l.length / 4 || top > l.length * 3 / 4) && rs[top] > 1.6 * median(rs)) strokes.push({ pts: [xy(l[top], w)], width: 2 * rs[top] });
  }
  // Blobs the thinning removed completely (round dots): one dot of the same area.
  const seen = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (mask[i] && !seen[i]) {
    const blob = [i]; seen[i] = 1; let hasSkeleton = false;
    for (let k = 0; k < blob.length; k++) { const p = blob[k]; if (sk[p]) hasSkeleton = true; for (const [dx, dy] of N8) { const n = p + dy * w + dx; if (n >= 0 && n < w * h && mask[n] && !seen[n] && Math.abs((n % w) - (p % w)) <= 1) { seen[n] = 1; blob.push(n); } } }
    if (hasSkeleton) continue;
    const c = blob.map(p => xy(p, w)).reduce((a, b) => [a[0] + b[0] / blob.length, a[1] + b[1] / blob.length], [0, 0]);
    strokes.push({ pts: [c], width: 2 * Math.sqrt(blob.length / Math.PI) });
  }
  // Same amount of ink as the outline: scale this glyph's widths until the covered area matches.
  const area = mask.reduce((a, b) => a + b, 0);
  for (let k = 0; k < 3 && strokes.length; k++) {
    const got = cover(strokes, w, h).reduce((a, b) => a + b, 0), f = Math.max(0.8, Math.min(1.25, area / Math.max(1, got)));
    strokes = strokes.map(s => ({ ...s, width: s.width * f }));
  }
  const drawn = cover(strokes, w, h); let both = 0, any = 0;
  for (let i = 0; i < w * h; i++) { both += mask[i] & drawn[i]; any += mask[i] | drawn[i]; }
  const toFont = ([x, y]) => [Math.round((x - PAD) / S + minU), Math.round(maxV - (y - PAD) / S)];
  return { strokes: strokes.map(s => [Math.round(s.width / S), ...s.pts.flatMap(toFont)]), iou: any ? both / any : 1 };
}

const started = Date.now(), paths = [], scores = [];
for (const [i, path] of font.paths.entries()) {
  const g = glyph(path); paths.push(g.strokes); scores.push([g.iou, i]);
}
const chars = font.chars;
writeFileSync(new URL('textpen-web/assets/font-strokes.js', root),
  `'use strict';\n// Generated by control/scripts/build-font-strokes.mjs from assets/handwriting-vectors.js (Caveat, OFL). Do not edit.\n` +
  `// paths[i] = strokes of glyph i; each stroke = [width, u0, v0, u1, v1, …] in font units (1000/em, y up).\n` +
  `const FontStrokes = ${JSON.stringify({ units: font.units, chars, paths })};\nif(typeof module!=='undefined')module.exports=FontStrokes;\n`);
scores.sort((a, b) => a[0] - b[0]);
const name = i => Object.keys(chars).filter(c => chars[c] === i).join('') || '#' + i;
const mean = scores.reduce((a, [s]) => a + s, 0) / scores.length;
console.log(`${paths.length} glyphs, ${paths.flat().length} strokes, mean IoU ${mean.toFixed(3)}, ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.log('weakest:', scores.slice(0, 12).map(([s, i]) => `${name(i)} ${s.toFixed(2)}`).join(' · '));
