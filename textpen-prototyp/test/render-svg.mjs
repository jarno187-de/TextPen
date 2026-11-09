// Draws the ink of a .goodnotes file as SVG, straight from the stored geometry (what GoodNotes will draw).
//   node test/render-svg.mjs dev/last-export.goodnotes > dev/last-export.svg
import { readFileSync } from 'node:fs';
import { read } from './goodnotes-reader.mjs';

const doc = read(new Uint8Array(readFileSync(process.argv[2])));
const [w, h] = doc.pages[0].size, gap = 40;
const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${(h + gap) * doc.pages.length}" style="background:#ddd">`];
doc.pages.forEach((p, n) => {
  out.push(`<g transform="translate(0 ${n * (h + gap)})"><rect width="${w}" height="${h}" fill="#fff"/>`);
  for (const s of p.strokes) {
    const g = s.geometry, c = [1, 2, 3].map(i => Math.round((s.color.get(i)?.[0] || 0) * 255)), a = s.color.get(4)?.[0] || 0;
    let d = `M${g.moves[0][0].toFixed(2)} ${g.moves[0][1].toFixed(2)}`;
    for (const q of g.quads) d += `Q${q.map(v => v.toFixed(2)).join(' ')}`;
    out.push(`<path d="${d}" fill="none" stroke="rgb(${c})" stroke-opacity="${a}" stroke-width="${g.width}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  out.push('</g>');
});
console.log(out.join('\n') + '</svg>');
