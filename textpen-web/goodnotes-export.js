'use strict';
// Beta: "GoodNotes-Datei" export. Same layout as the vector PDF (render({vector}) in app.js), but every
// letter becomes GoodNotes ballpoint ink that can be erased there. Paper (lines, dots, own paper photo)
// becomes a one-page background PDF that stays fixed under the writing.
//  · own handwriting: the drawn strokes themselves (constant width, round caps, like the preview)
//  · built-in font: centreline strokes from assets/font-strokes.js (control/scripts/build-font-strokes.mjs)
const GoodNotesExport = (() => {
  const PT = 72 / 96;   // layout is CSS px at 96 dpi
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).concat(1);
  // Douglas–Peucker: hand-drawn strokes carry far more points than the eye needs (tolerance in px).
  function simplify(P, tol) {
    if (P.length <= 4) return P;
    const n = P.length / 2, keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
    for (const stack = [[0, n - 1]]; stack.length;) {
      const [a, b] = stack.pop(), ax = P[2 * a], ay = P[2 * a + 1], dx = P[2 * b] - ax, dy = P[2 * b + 1] - ay, L = dx * dx + dy * dy;
      let best = 0, at = -1;
      for (let i = a + 1; i < b; i++) {
        const t = L ? Math.max(0, Math.min(1, ((P[2 * i] - ax) * dx + (P[2 * i + 1] - ay) * dy) / L)) : 0, d = Math.hypot(ax + t * dx - P[2 * i], ay + t * dy - P[2 * i + 1]);
        if (d > best) { best = d; at = i; }
      }
      if (best > tol) { keep[at] = 1; stack.push([a, at], [at, b]); }
    }
    return P.filter((_, i) => keep[i >> 1]);
  }

  // Canvas-compatible sink, used by render() exactly like VectorPdf.Context. Paper calls go to a real
  // VectorPdf.Context (the background); stroke()/fillText()/strokeText() become pen strokes.
  class Sink {
    constructor(width, height) {
      this.vector = true; this.width = width; this.height = height; this.paper = new VectorPdf.Context(width, height);
      this.ink = []; this.matrix = [1, 0, 0, 1, 0, 0]; this.stack = []; this.path = []; this.lastText = null;
      this.fillStyle = this.strokeStyle = '#000000'; this.lineWidth = 1; this.lineCap = this.lineJoin = 'round'; this.font = '';
    }
    sync() { for (const k of ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'font']) this.paper[k] = this[k]; }
    apply(x, y) { const [a, b, c, d, e, f] = this.matrix; return [a * x + c * y + e, b * x + d * y + f]; }
    get scaleFactor() { const [a, b, c, d] = this.matrix; return Math.sqrt(Math.abs(a * d - b * c)); }
    save() { this.stack.push([this.matrix, this.fillStyle, this.strokeStyle, this.lineWidth, this.lineCap, this.lineJoin, this.font]); this.paper.save(); }
    restore() { [this.matrix, this.fillStyle, this.strokeStyle, this.lineWidth, this.lineCap, this.lineJoin, this.font] = this.stack.pop(); this.paper.restore(); }
    translate(x, y) { const [a, b, c, d, e, f] = this.matrix; this.matrix = [a, b, c, d, a * x + c * y + e, b * x + d * y + f]; this.paper.translate(x, y); }
    scale(x, y) { const [a, b, c, d, e, f] = this.matrix; this.matrix = [a * x, b * x, c * y, d * y, e, f]; this.paper.scale(x, y); }
    beginPath() { this.path = []; this.paper.beginPath(); }
    moveTo(x, y) { this.path.push(this.apply(x, y)); this.paper.moveTo(x, y); }
    lineTo(x, y) { if (!this.path.length) this.path.push([]); this.path[this.path.length - 1].push(...this.apply(x, y)); this.paper.lineTo(x, y); }
    arc(...a) { this.paper.arc(...a); }
    fill() { this.sync(); this.paper.fill(); }
    fillRect(...a) { this.sync(); this.paper.fillRect(...a); }
    drawImage(...a) { this.paper.drawImage(...a); }
    stroke() {
      const width = this.lineWidth * this.scaleFactor;
      for (const points of this.path) this.ink.push({ points, width, color: this.strokeStyle });
    }
    fillText(char, x, y) {
      const font = FontStrokes, size = parseFloat(this.font), k = size / font.units, strokes = [];
      for (const [w, ...uv] of font.paths[font.chars[char] ?? 0]) {
        const points = [];
        for (let i = 0; i < uv.length; i += 2) points.push(...this.apply(x + uv[i] * k, y - uv[i + 1] * k));
        strokes.push({ points, width: w * k * this.scaleFactor, color: this.fillStyle });
      }
      this.ink.push(...strokes); this.lastText = { char, x, y, strokes };
    }
    // The thickness slider outlines the glyph with lineWidth: the centreline grows by the same amount.
    strokeText(char, x, y) {
      const t = this.lastText;
      if (t && t.char === char && t.x === x && t.y === y) for (const s of t.strokes) s.width += this.lineWidth * this.scaleFactor;
    }
  }

  async function make(pages, widthMm, heightMm, title, thumbnail) {
    const doc = GoodNotesFile.create(title);
    // TextPen paints the same paper on every page: one background PDF serves all of them.
    const paper = doc.attach(new Uint8Array(await (await VectorPdf.make([pages[0].paper], widthMm, heightMm)).arrayBuffer()));
    const w = pages[0].width * PT, h = pages[0].height * PT;
    for (const sink of pages) {
      const page = doc.addPage(paper, w, h);
      for (const s of sink.ink) {
        const points = simplify(s.points.length === 2 ? [s.points[0], s.points[1], s.points[0] + 0.01, s.points[1]] : s.points, 0.15).map(v => v * PT);
        page.stroke(points, Math.max(0.2, s.width * PT), rgb(s.color));
      }
    }
    if (thumbnail) doc.thumbnail(thumbnail);
    return new Blob([await doc.save()], { type: 'application/octet-stream' });
  }

  $('goodnotes').onclick = () => runExport($('goodnotes'), async pages => {
    const preview = render({ exportScale: 0.6 })[0];
    const jpeg = await new Promise(resolve => preview.toBlob(b => resolve(b), 'image/jpeg', 0.8));
    const [w, h] = pageSize(), title = (state.text.trim().split('\n')[0] || 'TextPen').slice(0, 60);
    download(await make(pages, w, h, title, jpeg && new Uint8Array(await jpeg.arrayBuffer())), 'textpen-text.goodnotes');
  }, { vector: Sink });
  return { Sink };
})();
