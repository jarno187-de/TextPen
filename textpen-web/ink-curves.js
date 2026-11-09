'use strict';
// Turns sampled pen movement (the pointer samples of a drawn letter, or a traced centreline) into the line a
// real pen leaves: a chain of quadratic Béziers that share their tangent at every joint. The ink then has no
// kinks or straight pieces at any zoom, while true corners (the pen turning back in "k" or "M") stay sharp.
// GoodNotes stores pen strokes as exactly such curves.
//   InkCurves.fit([x0,y0,x1,y1,…], {tolerance, smooth, cornerSpan, corners, closed}) → [x0,y0, cx,cy,x,y, cx,cy,x,y, …]
//     tolerance: how far the curve may leave the (smoothed) samples · smooth: jitter below this size is not pen movement
//     cornerSpan: a turn of more than cornerAngle within this length is a corner · corners: sample indices that are corners anyway
//   InkCurves.flatten(path, step) → [x0,y0,x1,y1,…]   (polyline on the curve, for measuring and tests)
const InkCurves = (() => {
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const SLACK = 4 * Math.PI / 180;   // turning back by less than this is jitter, not an S-bend
  const unit = (x, y) => { const l = Math.hypot(x, y); return l > 1e-12 ? [x / l, y / l] : null; };

  /** Points at equal distances along the polyline; an open line keeps both ends exactly. */
  function resample(P, step, cyclic) {
    const src = cyclic ? [...P, P[0]] : P; let total = 0;
    for (let i = 1; i < src.length; i++) total += dist(src[i - 1], src[i]);
    const count = Math.max(cyclic ? 3 : 1, Math.round(total / step)), h = total / count, out = [src[0].slice()];
    let walked = 0, next = h;
    for (let i = 1; i < src.length && out.length < count; i++) {
      const a = src[i - 1], b = src[i], l = dist(a, b);
      while (next <= walked + l && out.length < count) { const t = l ? (next - walked) / l : 0; out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]); next += h; }
      walked += l;
    }
    if (!cyclic) out.push(src[src.length - 1].slice());
    return out;
  }

  /** Binomial smoothing: removes pixel steps and pointer jitter. Open lines keep their ends in place. */
  function relax(P, passes, cyclic) {
    const n = P.length; let cur = P;
    for (let k = 0; k < passes; k++) {
      const out = new Array(n);
      for (let i = 0; i < n; i++) {
        if (!cyclic && (i === 0 || i === n - 1)) { out[i] = cur[i]; continue; }
        const a = cur[(i + n - 1) % n], b = cur[i], c = cur[(i + 1) % n];
        out[i] = [(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4];
      }
      cur = out;
    }
    return cur;
  }

  /** Indices where the line turns by more than `limit` within a short stretch: real corners. */
  function findCorners(P, arm, limit, cyclic) {
    const n = P.length, found = [];
    for (let i = cyclic ? 0 : 2; i < (cyclic ? n : n - 2); i++) {
      const k = cyclic ? arm : Math.min(arm, i, n - 1 - i), a = P[(i - k + n) % n], b = P[i], c = P[(i + k) % n];
      const u = unit(b[0] - a[0], b[1] - a[1]), v = unit(c[0] - b[0], c[1] - b[1]);
      if (!u || !v) continue;
      const angle = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1])));
      if (angle > limit) found.push([angle, i]);
    }
    found.sort((a, b) => b[0] - a[0]);
    const kept = [];
    for (const [, i] of found) if (kept.every(j => Math.min(Math.abs(i - j), cyclic ? n - Math.abs(i - j) : Infinity) > arm)) kept.push(i);
    return kept.sort((a, b) => a - b);
  }

  /** Travel direction at every sample of a smooth stretch (three-point formula at open ends). */
  function tangents(P, arm, cyclic) {
    const n = P.length, out = new Array(n);
    for (let i = 0; i < n; i++) {
      let t = null;
      if (cyclic) { const a = P[(i - arm + n) % n], b = P[(i + arm) % n]; t = unit(b[0] - a[0], b[1] - a[1]); }
      else {
        const k = Math.min(arm, i, n - 1 - i);
        if (k > 0) t = unit(P[i + k][0] - P[i - k][0], P[i + k][1] - P[i - k][1]);
        else {
          const s = i === 0 ? 1 : -1, m = Math.min(arm, Math.floor((n - 1) / 2));
          if (m > 0) { const a = P[i], b = P[i + s * m], c = P[i + 2 * s * m]; t = unit(s * (-3 * a[0] + 4 * b[0] - c[0]), s * (-3 * a[1] + 4 * b[1] - c[1])); }
          if (!t) t = unit(s * (P[i + s][0] - P[i][0]), s * (P[i + s][1] - P[i][1]));
        }
      }
      out[i] = t || out[i - 1] || [1, 0];
    }
    return out;
  }

  /** Control point of the quad from a to b that leaves along ta and arrives along tb, or null if none bends that way. */
  function control(a, b, ta, tb) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), cross = ta[0] * tb[1] - ta[1] * tb[0];
    const straight = L && Math.abs(ta[0] * dy - ta[1] * dx) < 0.05 * L && Math.abs(tb[0] * dy - tb[1] * dx) < 0.05 * L && ta[0] * dx + ta[1] * dy > 0 && tb[0] * dx + tb[1] * dy > 0;
    if (Math.abs(cross) > 1e-3) {
      const s = (dx * tb[1] - dy * tb[0]) / cross, t = (ta[0] * dy - ta[1] * dx) / cross;
      if (s > 0 && t > 0 && s < 2 * L && t < 2 * L) return [a[0] + s * ta[0], a[1] + s * ta[1]];
    }
    return straight ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : null;
  }

  function quadPoints(a, c, b, parts) {
    const out = [];
    for (let k = 0; k <= parts; k++) { const t = k / parts, u = 1 - t; out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]); }
    return out;
  }
  function toPolyline(p, line) {
    let best = Infinity;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i], dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
      const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
      best = Math.min(best, Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]));
    }
    return best;
  }

  /** Samples where the line starts bending the other way. A quad cannot bend both ways, so these become joints. */
  function inflections(T, slack) {
    const n = T.length, knots = [0];
    let angle = 0, high = 0, low = 0, highAt = 0, lowAt = 0, rising = 0;
    for (let i = 1; i < n; i++) {
      angle += Math.atan2(T[i - 1][0] * T[i][1] - T[i - 1][1] * T[i][0], T[i - 1][0] * T[i][0] + T[i - 1][1] * T[i][1]);
      if (angle > high) { high = angle; highAt = i; }
      if (angle < low) { low = angle; lowAt = i; }
      // Turned back by more than the slack: the extreme behind us was a real change of direction, not jitter.
      if (rising >= 0 && high - angle > slack) { if (highAt > knots[knots.length - 1]) knots.push(highAt); rising = -1; low = angle; lowAt = i; }
      else if (rising <= 0 && angle - low > slack) { if (lowAt > knots[knots.length - 1]) knots.push(lowAt); rising = 1; high = angle; highAt = i; }
    }
    knots.push(n - 1);
    return knots;
  }

  /** Fewest quads through the samples from..to that stay within the tolerance; joints reuse the sample's tangent. */
  function span(P, T, from, to, tolerance, out) {
    const a = P[from], b = P[to], c = control(a, b, T[from], T[to]);
    let worst = 0, at = (from + to) >> 1;
    if (c) {
      const line = quadPoints(a, c, b, Math.max(4, Math.min(24, to - from)));
      for (let i = from + 1; i < to; i++) { const d = toPolyline(P[i], line); if (d > worst) { worst = d; at = i; } }
      if (worst <= tolerance) { out.push(c[0], c[1], b[0], b[1]); return; }
    }
    if (to - from < 2) { out.push((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, b[0], b[1]); return; }
    span(P, T, from, at, tolerance, out); span(P, T, at, to, tolerance, out);
  }

  function fit(flat, { tolerance = 0.5, smooth = tolerance, corners = [], closed = false, cornerAngle = 60, cornerSpan = 3 * smooth } = {}) {
    const forced = new Set(corners), pts = [], hard = [];
    for (let i = 0; i < flat.length; i += 2) {
      const p = [flat[i], flat[i + 1]], last = pts[pts.length - 1];
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      if (last && dist(last, p) < tolerance / 50) { if (forced.has(i / 2)) hard[pts.length - 1] = true; continue; }
      pts.push(p); hard.push(forced.has(i / 2));
    }
    if (closed && pts.length > 2 && dist(pts[0], pts[pts.length - 1]) < tolerance / 50) { hard[0] = hard[0] || hard.pop(); pts.pop(); }
    if (!pts.length) return [];
    if (pts.length === 1) return pts[0];
    if (pts.length === 2) return [...pts[0], (pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2, ...pts[1]];

    const step = Math.max(tolerance / 2, smooth / 4, 1e-6), passes = Math.min(60, Math.round(2 * (smooth / step) ** 2));
    const arm = Math.max(2, Math.round(1.5 * smooth / step)), wide = Math.max(2, Math.round(cornerSpan / step)), limit = cornerAngle * Math.PI / 180;
    // Corners are looked for on a lightly smoothed line: the full smoothing would round them away first.
    const light = Math.min(passes, Math.round(2 * (cornerSpan / 3 / step) ** 2));
    const out = [];
    // A stretch without corners: smooth it, then cover it with as few quads as the tolerance allows.
    const smoothStretch = R => {
      if (R.length < 3) { out.push((R[0][0] + R[R.length - 1][0]) / 2, (R[0][1] + R[R.length - 1][1]) / 2, ...R[R.length - 1]); return; }
      const S = relax(R, passes, false), T = tangents(S, arm, false), knots = inflections(T, SLACK);
      for (let k = 1; k < knots.length; k++) span(S, T, knots[k - 1], knots[k], tolerance, out);
    };
    const open = (P, marks) => {
      out.push(P[0][0], P[0][1]);
      let start = 0;
      for (let i = 1; i < P.length; i++) {
        if (i < P.length - 1 && !marks[i]) continue;
        const R = resample(P.slice(start, i + 1), step, false), found = findCorners(relax(R, light, false), wide, limit, false);
        let from = 0;
        for (const k of [...found, R.length - 1]) { if (k > from) smoothStretch(R.slice(from, k + 1)); from = k; }
        start = i;
      }
    };
    if (!closed) { open(pts, hard); return out; }

    const turn = (P, marks, k) => [[...P.slice(k), ...P.slice(0, k), P[k]], [...marks.slice(k), ...marks.slice(0, k), false]];
    if (hard.includes(true)) { open(...turn(pts, hard, hard.indexOf(true))); return out; }
    const R = resample(pts, step, true), S = relax(R, passes, true), found = findCorners(relax(R, light, true), wide, limit, true);
    if (found.length) { const marks = R.map((_, i) => found.includes(i)); open(...turn(R, marks, found[0])); return out; }
    // A loop without corners ("o"): the same tangent closes it, so the start is as smooth as the rest.
    const T = tangents(S, arm, true), ring = [...S, S[0]], n = S.length, third = Math.max(1, Math.floor(n / 3));
    T.push(T[0]);
    out.push(S[0][0], S[0][1]);
    const knots = [...new Set([...inflections(T, SLACK), third, 2 * third])].sort((a, b) => a - b);
    for (let k = 1; k < knots.length; k++) span(ring, T, knots[k - 1], knots[k], tolerance, out);
    return out;
  }

  /** Points on the curve, at most `step` apart. */
  function flatten(path, step = 1) {
    const out = [path[0], path[1]];
    for (let i = 2; i + 3 < path.length; i += 4) {
      const a = [path[i - 2], path[i - 1]], c = [path[i], path[i + 1]], b = [path[i + 2], path[i + 3]];
      const parts = Math.max(1, Math.min(200, Math.ceil((dist(a, c) + dist(c, b)) / step)));
      for (const p of quadPoints(a, c, b, parts).slice(1)) out.push(p[0], p[1]);
    }
    return out;
  }

  return { fit, flatten };
})();
if (typeof module !== 'undefined') module.exports = InkCurves;
