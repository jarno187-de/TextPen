// Builds textpen-web/assets/font-strokes.js: the pen strokes that write every glyph of the built-in font.
// GoodNotes can only erase pen strokes, but handwriting.ttf (Caveat) glyphs are filled outlines. So each glyph is
// "written again" the way a hand would: find where the pen ran (the centre of the ink), follow it straight through
// crossings, keep the corners where the pen turned, and store that path as smooth curves (textpen-web/ink-curves.js).
// Per glyph:
//   1. rasterise the outline, thin it to a 1 px skeleton (Zhang & Suen) and read it as a graph of branches
//   2. drop the stubs thinning leaves in corners and blunt ends; merge junctions that belong to one crossing;
//      find the outline's sharp corners, because that is where the pen turned
//   3. at every junction pair the branches that continue each other, and redraw the crossing without the
//      skeleton's typical dents; a branch that only touches another stroke ends on that stroke's centre
//   4. move every point to the exact middle between the two outline edges (sub-pixel) and measure the ink width there
//   5. fit curves, cut the ends back so the round pen tip stops where the ink stops, and match the amount of ink
// Every stroke has one pen width, like a ballpoint: the result is the font's letters written with a real pen.
// Run: node control/scripts/build-font-strokes.mjs   (only after handwriting-vectors.js changes; output is a static asset)
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const S = 0.5, PAD = 6;            // pixels per font unit, empty border
const SPUR = 0.5;                  // a stub that sticks out less than this share of the pen radius is no stroke
const MERGE = 1.0;                 // junctions closer than their radii × this are one crossing
const ZONE = 1.1;                  // radius × this around a junction is redrawn
const PAIR_MAX = 60, SMOOTH_MAX = 25;   // degrees: still the same stroke / still without a corner
const source = readFileSync(new URL('textpen-web/assets/handwriting-vectors.js', root), 'utf8');
const font = JSON.parse(source.slice(source.indexOf('{'), source.lastIndexOf('}') + 1));
const InkCurves = vm.runInThisContext(readFileSync(new URL('textpen-web/ink-curves.js', root), 'utf8') + '\n;InkCurves');

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const unit = (x, y) => { const l = Math.hypot(x, y); return l > 1e-9 ? [x / l, y / l] : [0, 0]; };
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]))) * 180 / Math.PI;
const median = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
const pathLength = P => { let l = 0; for (let i = 1; i < P.length; i++) l += dist(P[i - 1], P[i]); return l; };
/** Points about 1 px apart from a to b, without a and b themselves. */
const between = (a, b) => { const n = Math.ceil(dist(a, b)), out = []; for (let k = 1; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); return out; };

/** PDF path ("x y m", "x y l", "x1 y1 x2 y2 x3 y3 c", "h") → closed rings of [u, v] font-unit points. */
function rings(path) {
  const out = []; let ring = null, nums = [];
  for (const t of path.split(/\s+/).filter(Boolean)) {
    if (!/^[mlch]$/.test(t)) { nums.push(+t); continue; }
    if (t === 'm') { ring = [[nums[0], nums[1]]]; out.push(ring); }
    else if (t === 'l') ring.push([nums[0], nums[1]]);
    else if (t === 'c') {
      const [x0, y0] = ring[ring.length - 1], [x1, y1, x2, y2, x3, y3] = nums;
      for (let k = 1; k <= 16; k++) { const a = k / 16, b = 1 - a; ring.push([b * b * b * x0 + 3 * b * b * a * x1 + 3 * b * a * a * x2 + a * a * a * x3, b * b * b * y0 + 3 * b * b * a * y1 + 3 * b * a * a * y2 + a * a * a * y3]); }
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

/** Exact distance from every ink pixel to the nearest paper pixel (Felzenszwalb & Huttenlocher), minus half a pixel: the pen radius that fits there. */
function radii(mask, w, h) {
  const n = Math.max(w, h), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1), out = new Float32Array(w * h);
  const pass = len => {
    let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < len; q++) {
      let s; do { const p = v[k]; s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p); } while (s <= z[k] && --k >= 0);
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const p = v[k]; d[q] = (q - p) * (q - p) + f[p]; }
  };
  const sq = new Float64Array(w * h);
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = mask[y * w + x] ? 1e12 : 0; pass(h); for (let y = 0; y < h; y++) sq[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = sq[y * w + x]; pass(w); for (let x = 0; x < w; x++) out[y * w + x] = Math.max(0, Math.sqrt(d[x]) - 0.5); }
  return out;
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

/** Sharp outward corners of the outline: where the pen turned (or stopped). → [{ p: tip, in: unit vector into the ink }] */
function outlineCorners(polys, inside) {
  const found = [];
  for (const ring of polys) {
    const P = []; let walked = 0, next = 0;
    for (let i = 0; i < ring.length; i++) {   // one point per pixel of outline length
      const a = ring[i], b = ring[(i + 1) % ring.length], l = dist(a, b);
      for (; next < walked + l; next++) { const t = (next - walked) / l; P.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
      walked += l;
    }
    const n = P.length; if (n < 24) continue;
    const turn = (i, arm) => { const a = P[(i - arm + n) % n], b = P[i], c = P[(i + arm) % n]; return angle(unit(b[0] - a[0], b[1] - a[1]), unit(c[0] - b[0], c[1] - b[1])); };
    // Sharp at close range and still a corner from further away: a nick in the rough edge is neither.
    const sharp = []; for (let i = 0; i < n; i++) { const t = turn(i, 3); if (t > 50 && turn(i, 8) > 40) sharp.push([t, i]); }
    sharp.sort((a, b) => b[0] - a[0]);
    const kept = [];
    for (const [, i] of sharp) {
      if (kept.some(j => Math.min(Math.abs(i - j), n - Math.abs(i - j)) < 8)) continue;
      kept.push(i);
      const a = P[(i - 6 + n) % n], b = P[i], c = P[(i + 6) % n], into = unit(a[0] + c[0] - 2 * b[0], a[1] + c[1] - 2 * b[1]);
      if (inside([b[0] + 2.5 * into[0], b[1] + 2.5 * into[1]])) found.push({ p: b, in: into });
    }
  }
  return found;
}

const N8 = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]];
/** Skeleton → junction nodes and the branches (edges) between them. edge.a / edge.b = node at its first / last point, -1 = free end. */
function graph(sk, w, h, radius) {
  const near = i => { const x = i % w, y = (i - x) / w, out = []; for (const [dx, dy] of N8) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h && sk[yy * w + xx]) out.push(yy * w + xx); } return out; };
  const xy = i => [i % w + 0.5, Math.floor(i / w) + 0.5];
  const degree = new Uint8Array(w * h), pixels = [];
  for (let i = 0; i < w * h; i++) if (sk[i]) { pixels.push(i); degree[i] = near(i).length; }
  const nodeOf = new Int32Array(w * h).fill(-1), nodes = [], edges = [], used = new Uint8Array(w * h);
  for (const i of pixels) if (degree[i] >= 3 && nodeOf[i] < 0) {
    const group = [i]; nodeOf[i] = nodes.length;
    for (let k = 0; k < group.length; k++) for (const q of near(group[k])) if (degree[q] >= 3 && nodeOf[q] < 0) { nodeOf[q] = nodes.length; group.push(q); }
    const c = group.map(xy).reduce((a, p) => [a[0] + p[0] / group.length, a[1] + p[1] / group.length], [0, 0]);
    nodes.push({ c, r: Math.max(...group.map(q => radius[q])), spurs: [] });
  }
  // A branch pixel has at most two neighbours, so walking it is unambiguous.
  function walk(from, start, a) {
    const chain = [start]; used[start] = 1; let prev = from, cur = start, b = -1, closed = false;
    for (;;) {
      const next = near(cur).find(q => q !== prev && (degree[q] >= 3 || !used[q] || (q === start && chain.length > 2)));
      if (next === undefined) break;
      if (degree[next] >= 3) { b = nodeOf[next]; break; }
      if (next === start) { closed = true; break; }
      chain.push(next); used[next] = 1; prev = cur; cur = next;
    }
    if (a >= 0 && a === b && chain.length < 4) return;   // a pixel wedged into a junction, not a loop
    edges.push({ a, b, closed, pts: chain.map(xy) });
  }
  for (const p of pixels) if (degree[p] >= 3) for (const q of near(p)) if (degree[q] < 3 && !used[q]) walk(p, q, nodeOf[p]);
  for (const p of pixels) if (degree[p] <= 1 && !used[p]) walk(-1, p, -1);
  for (const p of pixels) if (degree[p] < 3 && !used[p]) walk(-1, p, -1);
  return { nodes, edges };
}

function glyph(path) {
  const polys = rings(path); if (!polys.length) return { strokes: [], iou: 1 };
  const all = polys.flat(), minU = Math.min(...all.map(p => p[0])), maxV = Math.max(...all.map(p => p[1]));
  const w = Math.ceil((Math.max(...all.map(p => p[0])) - minU) * S) + 2 * PAD, h = Math.ceil((maxV - Math.min(...all.map(p => p[1]))) * S) + 2 * PAD;
  const px = polys.map(r => r.map(([u, v]) => [(u - minU) * S + PAD, (maxV - v) * S + PAD]));
  const mask = rasterise(px, w, h), radius = radii(mask, w, h), sk = thin(mask, w, h);
  /** Pen radius that fits at a point (bilinear between pixel centres). */
  const fits = ([x, y]) => {
    const fx = Math.max(0, Math.min(w - 1.001, x - 0.5)), fy = Math.max(0, Math.min(h - 1.001, y - 0.5)), x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, i = y0 * w + x0;
    return (radius[i] * (1 - tx) + radius[i + 1] * tx) * (1 - ty) + (radius[i + w] * (1 - tx) + radius[i + w + 1] * tx) * ty;
  };
  // Outline edges for exact measuring: [ax, ay, bx - ax, by - ay].
  const segments = px.flatMap(r => r.map((p, i) => { const q = r[(i + 1) % r.length]; return [p[0], p[1], q[0] - p[0], q[1] - p[1]]; }));
  /** Outline hits of the line through p along n: [nearest in front, nearest behind] as signed distances. */
  const across = (p, n) => {
    let front = Infinity, back = -Infinity;
    for (const [ax, ay, ex, ey] of segments) {
      const den = n[0] * ey - n[1] * ex; if (Math.abs(den) < 1e-9) continue;
      const qx = ax - p[0], qy = ay - p[1], t = (qx * ey - qy * ex) / den, u = (qx * n[1] - qy * n[0]) / den;
      if (u < 0 || u > 1) continue;
      if (t > 0) front = Math.min(front, t); else back = Math.max(back, t);
    }
    return [front, back];
  };

  const { nodes, edges } = graph(sk, w, h, radius);
  const dots = [];   // [point, width]
  for (const e of edges) e.alive = true;
  const ends = n => edges.filter(e => e.alive).flatMap(e => [...(e.a === n ? [[e, 0]] : []), ...(e.b === n ? [[e, 1]] : [])]);

  // 2a. Stubs: thinning runs a short branch into every outline corner and into both corners of a blunt end.
  for (let changed = true; changed;) {
    changed = false;
    for (const e of edges) {
      if (!e.alive || e.closed || (e.a < 0) === (e.b < 0)) continue;
      const atStart = e.a >= 0, node = nodes[atStart ? e.a : e.b], tip = e.pts[atStart ? e.pts.length - 1 : 0];
      const reach = pathLength(e.pts) + dist(e.pts[atStart ? 0 : e.pts.length - 1], node.c) + fits(tip) - node.r;
      if (reach < SPUR * node.r) { e.alive = false; changed = true; node.spurs.push({ dir: unit(tip[0] - node.c[0], tip[1] - node.c[1]), reach: Math.max(0, reach) }); }
    }
    nodes.forEach((node, n) => {
      if (node.gone) return;
      const at = ends(n);
      if (at.length > 1) return;
      node.gone = true; changed = changed || at.length > 0;
      if (!at.length) { dots.push([node.c, 2 * node.r]); return; }
      // One branch left: the stroke simply ends here.
      const [e, side] = at[0];
      if (side) { e.pts.push(node.c); e.b = -1; } else { e.pts.unshift(node.c); e.a = -1; }
    });
  }
  // 2b. One crossing often thins to two junctions with a short bridge (an "x", the arm and leg of "k").
  const group = nodes.map((_, i) => i), find = i => group[i] === i ? i : (group[i] = find(group[i]));
  for (const e of edges) if (e.alive && e.a >= 0 && e.b >= 0 && e.a !== e.b) {
    const A = nodes[e.a], B = nodes[e.b];
    if (pathLength(e.pts) + dist(e.pts[0], A.c) + dist(e.pts[e.pts.length - 1], B.c) < MERGE * (A.r + B.r)) group[find(e.a)] = find(e.b);
  }
  const zones = new Map();
  nodes.forEach((node, i) => { if (node.gone) return; const g = find(i); if (!zones.has(g)) zones.set(g, []); zones.get(g).push(node); });
  for (const [g, members] of zones) {
    const c = members.reduce((a, m) => [a[0] + m.c[0] / members.length, a[1] + m.c[1] / members.length], [0, 0]);
    zones.set(g, { c, r: Math.max(...members.map(m => m.r)), R: ZONE * Math.max(...members.map(m => dist(c, m.c) + m.r)), spurs: members.flatMap(m => m.spurs), apexes: [], ends: [] });
  }
  for (const e of edges) {
    if (!e.alive) continue;
    e.za = e.a >= 0 ? zones.get(find(e.a)) : null; e.zb = e.b >= 0 ? zones.get(find(e.b)) : null;
    if (e.za && e.za === e.zb && e.pts.every(p => dist(p, e.za.c) <= e.za.R)) e.alive = false;   // lies inside its own crossing
  }

  // 2c. Outline corners. Near a junction they tell where exactly the pen turned. Elsewhere thinning has rounded
  // the turn off: make it a junction of its own (two branches), so it gets its corner back below.
  const inside = ([x, y]) => x >= 0 && y >= 0 && x < w && y < h && mask[Math.floor(y) * w + Math.floor(x)] === 1;
  for (const apex of outlineCorners(px, inside)) {
    let zone = null, best = Infinity;
    for (const z of zones.values()) { const d = dist(apex.p, z.c); if (d <= 1.8 * z.R && d < best) { best = d; zone = z; } }
    if (zone) { zone.apexes.push(apex); continue; }
    let at = null; best = Infinity;
    for (const e of edges) if (e.alive) e.pts.forEach((p, i) => { const d = dist(apex.p, p); if (d < best) { best = d; at = [e, i]; } });
    if (!at) continue;
    const [e, i] = at, p = e.pts[i], r = fits(p);
    if (best > 2.2 * r + 2) continue;
    // Not at a stroke's end (its tip is cut to fit anyway) and not inside the next junction.
    const before = pathLength(e.pts.slice(0, i + 1)), after = pathLength(e.pts.slice(i));
    if (!e.closed && (before < 1.5 * r + (e.za ? e.za.R : 0) || after < 1.5 * r + (e.zb ? e.zb.R : 0))) continue;
    zone = { c: p, r, R: ZONE * r, spurs: [], apexes: [apex], ends: [] };
    zones.set(zone, zone);
    if (e.closed) { e.pts = [...e.pts.slice(i), ...e.pts.slice(0, i), p]; e.closed = false; e.za = e.zb = zone; }
    else { edges.push({ alive: true, closed: false, pts: e.pts.slice(i), za: zone, zb: e.zb }); e.pts = e.pts.slice(0, i + 1); e.zb = zone; }
  }

  // 4 (before 3, because directions are taken from the centred points). Exact centre line and ink width.
  for (const e of edges) {
    if (!e.alive) continue;
    e.wide = e.pts.map(p => 2 * fits(p));
    for (let round = 0; round < 2 && e.pts.length > 4; round++) {
      const P = e.pts, n = P.length;
      e.pts = P.map((p, i) => {
        const a = P[e.closed ? (i - 3 + n) % n : Math.max(0, i - 3)], b = P[e.closed ? (i + 3) % n : Math.min(n - 1, i + 3)], t = unit(b[0] - a[0], b[1] - a[1]);
        const [front, back] = across(p, [-t[1], t[0]]), shift = (front + back) / 2;
        // Only where the ink really is a band with two edges; near crossings and tips the pixel skeleton stays.
        if (!Number.isFinite(shift) || Math.abs(shift) > 1.5 || front - back > 2.6 * fits(p) + 2) return p;
        e.wide[i] = front - back;
        return [p[0] - t[1] * shift, p[1] + t[0] * shift];
      });
    }
  }

  // 3. Junctions: cut every branch where it enters the zone, then decide how the pen went through.
  for (const e of edges) {
    if (!e.alive) continue;
    const n = e.pts.length; let from = 0, to = n - 1;
    if (e.za) while (from < n - 1 && dist(e.pts[from], e.za.c) <= e.za.R) from++;
    if (e.zb) while (to > 0 && dist(e.pts[to], e.zb.c) <= e.zb.R) to--;
    if (from > to) from = to = e.za && e.zb ? (n - 1) >> 1 : e.za ? n - 1 : 0;
    e.from = from; e.to = to; e.link = [null, null];
    for (const [zone, side] of [[e.za, 0], [e.zb, 1]]) {
      if (!zone) continue;
      const q = e.pts[side ? to : from], step = side ? -1 : 1, want = Math.max(1.2 * zone.r, 5);
      let k = side ? to : from, far = q;
      for (let run = 0; k + step >= from && k + step <= to && run < want; k += step) { run += dist(e.pts[k], e.pts[k + step]); far = e.pts[k + step]; }
      let d = unit(far[0] - q[0], far[1] - q[1]);
      if (dist(far, q) < 2) d = unit(q[0] - zone.c[0], q[1] - zone.c[1]);
      zone.ends.push({ e, side, q, d });
    }
  }
  for (const zone of zones.values()) {
    const open = zone.ends.slice(), pairs = [];
    // How far two branch ends are from being one straight pass: both must agree with the line that joins them.
    const bend = (a, b) => { const chord = unit(b.q[0] - a.q[0], b.q[1] - a.q[1]), into = [-a.d[0], -a.d[1]]; return Math.max(angle(into, b.d), angle(into, chord), angle(b.d, chord)); };
    while (open.length > 1) {
      let best = null;
      for (let i = 0; i < open.length; i++) for (let j = i + 1; j < open.length; j++) { const v = bend(open[i], open[j]); if (!best || v < best[0]) best = [v, i, j]; }
      if (best[0] > PAIR_MAX && zone.ends.length > 2) break;
      pairs.push([open[best[1]], open[best[2]], best[0]]); open.splice(best[2], 1); open.splice(best[1], 1);
    }
    const passes = [];
    for (const [a, b, turn] of pairs) {
      let mid, corner = -1;
      if (turn < SMOOTH_MAX) {
        // Straight on: an even curve from one branch into the other.
        const l = dist(a.q, b.q) / 3, c1 = [a.q[0] - a.d[0] * l, a.q[1] - a.d[1] * l], c2 = [b.q[0] - b.d[0] * l, b.q[1] - b.d[1] * l], n = Math.ceil(dist(a.q, b.q));
        mid = [];
        for (let k = 1; k < n; k++) { const t = k / n, u = 1 - t; mid.push([u * u * u * a.q[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b.q[0], u * u * u * a.q[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b.q[1]]); }
      } else {
        // The pen turned. Where: at the tip of the outline's corner if thinning found one, else where both branches meet.
        let x = zone.c;
        const out = unit(-a.d[0] - b.d[0], -a.d[1] - b.d[1]), spur = zone.spurs.length === 1 && zone.spurs[0];
        const den = a.d[0] * b.d[1] - a.d[1] * b.d[0], pen = (fits(a.q) + fits(b.q)) / 2;
        // An outline corner on the outer side of the turn: the pen tip sat right in it.
        const outer = zone.apexes.map(A => [(A.p[0] - zone.c[0]) * out[0] + (A.p[1] - zone.c[1]) * out[1], A]).filter(v => v[0] > 0).sort((u, v) => v[0] - u[0])[0];
        if (outer) x = [outer[1].p[0] + outer[1].in[0] * pen, outer[1].p[1] + outer[1].in[1] * pen];
        else if (spur && spur.dir[0] * out[0] + spur.dir[1] * out[1] > 0) x = [zone.c[0] + spur.dir[0] * spur.reach, zone.c[1] + spur.dir[1] * spur.reach];
        else if (Math.abs(den) > 0.05) {
          const s = ((b.q[0] - a.q[0]) * b.d[1] - (b.q[1] - a.q[1]) * b.d[0]) / den, meet = [a.q[0] + s * a.d[0], a.q[1] + s * a.d[1]];
          if (s < 0 && dist(meet, zone.c) < 1.5 * zone.R) x = meet;
        }
        const first = between(a.q, x);
        mid = [...first, x, ...between(x, b.q)]; corner = first.length;
      }
      a.e.link[a.side] = { pair: b, pts: mid, corner };
      b.e.link[b.side] = { pair: a, pts: mid.slice().reverse(), corner: corner < 0 ? -1 : mid.length - 1 - corner };
      passes.push([a.q, ...mid, b.q]);
    }
    // A branch that only touches (the arch of "n", the bar of "e") runs on until it reaches the stroke it leaves.
    for (const end of open) {
      let hit = Infinity;
      for (const line of passes) for (let i = 1; i < line.length; i++) {
        const [ax, ay] = line[i - 1], ex = line[i][0] - ax, ey = line[i][1] - ay, det = end.d[0] * ey - end.d[1] * ex;
        if (Math.abs(det) < 1e-9) continue;
        const qx = ax - end.q[0], qy = ay - end.q[1], t = (qy * ex - qx * ey) / det, u = (qx * end.d[1] - qy * end.d[0]) / det;
        if (u >= 0 && u <= 1 && t > 0 && t < hit) hit = t;
      }
      const target = hit < 2.5 * zone.R ? [end.q[0] - end.d[0] * hit, end.q[1] - end.d[1] * hit] : zone.c;
      end.e.link[end.side] = { pts: [...between(end.q, target), target] };
    }
  }

  // Chain the branches into strokes.
  const lines = [];
  const follow = (e, side, startLink) => {
    const line = { pts: [], zone: [], corners: [], free: [startLink === null, false], closed: false, wide: [] }, first = e, firstSide = side;
    const add = (p, zone, wide = 0) => { line.pts.push(p); line.zone.push(zone); line.wide.push(wide); };
    if (startLink) for (const p of startLink.pts.slice().reverse()) add(p, true);
    for (;;) {
      e.done = true;
      for (let k = e.from; k <= e.to; k++) { const i = side ? e.to + e.from - k : k; add(e.pts[i], false, e.wide[i]); }
      const link = e.link[1 - side];
      if (!link) { line.free[1] = true; break; }
      if (link.corner >= 0) line.corners.push(line.pts.length + link.corner);
      for (const p of link.pts) add(p, true);
      if (!link.pair) break;
      if (link.pair.e === first && link.pair.side === firstSide) { line.closed = true; break; }
      if (link.pair.e.done) break;
      e = link.pair.e; side = link.pair.side;
    }
    lines.push(line);
  };
  const live = edges.filter(e => e.alive);
  for (const e of live) if (e.closed) { e.done = true; lines.push({ pts: e.pts, zone: e.pts.map(() => false), wide: e.wide, corners: [], free: [false, false], closed: true }); }
  for (const e of live) for (const side of [0, 1]) if (!e.done && !e.link[side]?.pair) follow(e, side, e.link[side] || null);
  for (const e of live) if (!e.done) follow(e, 0, undefined);

  // 5. Pen width per stroke, tips, curves.
  let strokes = [];
  for (const line of lines) {
    const clear = line.wide.filter((v, i) => !line.zone[i] && v > 0);
    let P = line.pts, corners = line.corners, width = clear.length ? median(clear) : 2 * median(P.map(fits)), head = null;
    // A short drop (comma, quotes): heavy head, thin tail. One pen width cannot be both, so the tail is the
    // stroke and the head a dot on it, like a pen that is set down first and then flicked away.
    if (!line.closed && line.free[0] && line.free[1] && clear.length > 4) {
      const room = P.map(fits), big = Math.max(...room), thin = clear.slice().sort((a, b) => a - b)[Math.floor(clear.length * 0.3)];
      if (pathLength(P) < 8 * big && 2 * big > 1.5 * thin) { width = thin; head = [P[room.indexOf(big)], 2 * big]; }
    }
    if (!line.closed) {
      // A round pen tip reaches half the pen width past the end of its path: stop the path that much before the ink ends.
      const cut = [0, 1].map(side => line.free[side] ? Math.max(0, width / 2 - fits(P[side ? P.length - 1 : 0])) : 0), total = pathLength(P);
      if (total - cut[0] - cut[1] < 0.5) {
        const big = Math.max(...P.map(fits)); let run = 0, i = 1;
        while (i < P.length - 1 && run + dist(P[i - 1], P[i]) < total / 2) { run += dist(P[i - 1], P[i]); i++; }
        dots.push([P[Math.min(i, P.length - 1)], 2 * big]); continue;
      }
      const trimmed = [], kept = []; let run = 0;
      for (let i = 0; i < P.length; i++) {
        if (i) run += dist(P[i - 1], P[i]);
        if (run < cut[0] || run > total - cut[1]) continue;
        if (corners.includes(i)) kept.push(trimmed.length);
        trimmed.push(P[i]);
      }
      if (trimmed.length < 2) { dots.push([P[P.length >> 1], width]); continue; }
      P = trimmed; corners = kept;
    }
    // A hand does not wobble within a fraction of the pen width: that is the outline's rough edge, not pen movement.
    const curve = InkCurves.fit(P.flat(), { tolerance: 0.8, smooth: Math.max(2, 0.25 * width), cornerSpan: Math.max(3, 0.12 * width), corners, closed: line.closed });
    if (curve.length >= 6) strokes.push({ curve, width });
    if (head) dots.push(head);
  }
  // Round dots (i, full stop, umlaut) that thinning removed completely: one dot of the same area.
  const seen = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (mask[i] && !seen[i]) {
    const blob = [i]; seen[i] = 1; let hasSkeleton = false;
    for (let k = 0; k < blob.length; k++) { const p = blob[k]; if (sk[p]) hasSkeleton = true; for (const [dx, dy] of N8) { const n = p + dy * w + dx; if (n >= 0 && n < w * h && mask[n] && !seen[n] && Math.abs((n % w) - (p % w)) <= 1) { seen[n] = 1; blob.push(n); } } }
    if (hasSkeleton) continue;
    const c = blob.map(p => [p % w + 0.5, Math.floor(p / w) + 0.5]).reduce((a, b) => [a[0] + b[0] / blob.length, a[1] + b[1] / blob.length], [0, 0]);
    dots.push([c, 2 * Math.sqrt(blob.length / Math.PI)]);
  }
  for (const [p, width] of dots) strokes.push({ curve: [p[0], p[1]], width });

  // Same amount of ink as the outline: scale this glyph's pen widths until the covered area matches.
  const area = mask.reduce((a, b) => a + b, 0);
  for (let k = 0; k < 3 && strokes.length; k++) {
    const got = cover(strokes, w, h).reduce((a, b) => a + b, 0), f = Math.max(0.94, Math.min(1.12, area / Math.max(1, got)));
    strokes = strokes.map(s => ({ ...s, width: s.width * f }));
  }
  const drawn = cover(strokes, w, h); let both = 0, any = 0;
  for (let i = 0; i < w * h; i++) { both += mask[i] & drawn[i]; any += mask[i] | drawn[i]; }

  // Write like a hand: every stroke from its top (flat ones from the left), the letter from left to right, dots last.
  for (const s of strokes) {
    const c = s.curve, n = c.length, dx = c[n - 2] - c[0], dy = c[n - 1] - c[1];
    if (n > 2 && (Math.abs(dy) > Math.abs(dx) ? dy < 0 : dx < 0)) { const r = []; for (let i = n - 2; i >= 0; i -= 2) r.push(c[i], c[i + 1]); s.curve = r; }
  }
  strokes.sort((a, b) => (a.curve.length < 6) - (b.curve.length < 6) || Math.min(...a.curve.filter((_, i) => i % 2 === 0)) - Math.min(...b.curve.filter((_, i) => i % 2 === 0)));
  const toFont = (v, i) => Math.round(i % 2 ? maxV - (v - PAD) / S : (v - PAD) / S + minU);
  return { strokes: strokes.map(s => [Math.round(s.width / S), ...s.curve.map(toFont)]), iou: any ? both / any : 1 };
}

/** Pixels covered by round-capped strokes (for the ink amount and the coverage report). */
function cover(strokes, w, h) {
  const out = new Uint8Array(w * h);
  for (const { curve, width } of strokes) {
    const pts = InkCurves.flatten(curve, 0.75), r = width / 2;
    for (let k = 0; k < Math.max(1, pts.length / 2 - 1); k++) {
      const x0 = pts[2 * k], y0 = pts[2 * k + 1], x1 = pts[2 * k + 2] ?? x0, y1 = pts[2 * k + 3] ?? y0, dx = x1 - x0, dy = y1 - y0, L = dx * dx + dy * dy;
      for (let y = Math.max(0, Math.floor(Math.min(y0, y1) - r)); y < Math.min(h, Math.ceil(Math.max(y0, y1) + r)); y++)
        for (let x = Math.max(0, Math.floor(Math.min(x0, x1) - r)); x < Math.min(w, Math.ceil(Math.max(x0, x1) + r)); x++) {
          const cx = x + 0.5, cy = y + 0.5, t = L ? Math.max(0, Math.min(1, ((cx - x0) * dx + (cy - y0) * dy) / L)) : 0;
          if (Math.hypot(x0 + t * dx - cx, y0 + t * dy - cy) <= r) out[y * w + x] = 1;
        }
    }
  }
  return out;
}

const started = Date.now(), paths = [], scores = [];
for (const [i, path] of font.paths.entries()) {
  const g = glyph(path); paths.push(g.strokes); scores.push([g.iou, i]);
}
const chars = font.chars;
writeFileSync(new URL('textpen-web/assets/font-strokes.js', root),
  `'use strict';\n// Generated by control/scripts/build-font-strokes.mjs from assets/handwriting-vectors.js (Caveat, OFL). Do not edit.\n` +
  `// paths[i] = pen strokes of glyph i. A stroke = [pen width, x0, y0, then per curve piece: cx, cy, x, y] in font units\n` +
  `// (1000/em, y up): it starts at x0,y0, every piece is a quadratic Bézier with control point cx,cy. A lone x0,y0 is a dot.\n` +
  `const FontStrokes = ${JSON.stringify({ units: font.units, chars, paths })};\nif(typeof module!=='undefined')module.exports=FontStrokes;\n`);
scores.sort((a, b) => a[0] - b[0]);
const name = i => Object.keys(chars).filter(c => chars[c] === i).join('') || '#' + i;
const mean = scores.reduce((a, [s]) => a + s, 0) / scores.length, pieces = paths.flat().reduce((a, s) => a + (s.length - 3) / 4, 0);
console.log(`${paths.length} glyphs, ${paths.flat().length} strokes, ${pieces} curve pieces, mean coverage (IoU) ${mean.toFixed(3)}, ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.log('weakest:', scores.slice(0, 12).map(([s, i]) => `${name(i)} ${s.toFixed(2)}`).join(' · '));
