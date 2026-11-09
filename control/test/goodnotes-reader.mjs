// Test-only reader for .goodnotes files: ZIP → length-delimited protobuf → stroke geometry.
// Used to compare files written by goodnotes/goodnotes-writer.js with a real GoodNotes export.
import { inflateRawSync } from 'node:zlib';

export function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), files = new Map();
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw Error('no ZIP end record');
  let at = view.getUint32(end + 16, true);
  for (let i = 0, n = view.getUint16(end + 10, true); i < n; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw Error('bad central directory');
    const method = view.getUint16(at + 10, true), size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true), extra = view.getUint16(at + 30, true), comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true), name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    files.set(name, method === 8 ? new Uint8Array(inflateRawSync(raw)) : method === 0 ? raw : (() => { throw Error('ZIP method ' + method); })());
    at += 46 + nameLength + extra + comment;
  }
  return files;
}

function varint(b, o) { let n = 0, s = 1; for (;;) { const x = b[o++]; n += (x & 127) * s; if (x < 128) return [n, o]; s *= 128; } }

/** Message → Map(field → [values]); LEN values stay Uint8Array, I32 as float, I64 as double. */
export function message(b) {
  const out = new Map(); let o = 0;
  while (o < b.length) {
    let key; [key, o] = varint(b, o);
    const field = Math.floor(key / 8), type = key & 7; let value;
    if (type === 0) [value, o] = varint(b, o);
    else if (type === 1) { value = new DataView(b.buffer, b.byteOffset + o, 8).getFloat64(0, true); o += 8; }
    else if (type === 5) { value = new DataView(b.buffer, b.byteOffset + o, 4).getFloat32(0, true); o += 4; }
    else if (type === 2) { let n; [n, o] = varint(b, o); value = b.subarray(o, o + n); o += n; }
    else throw Error('wire type ' + type);
    if (!out.has(field)) out.set(field, []);
    out.get(field).push(value);
  }
  return out;
}
export const delimited = b => { const out = []; let o = 0, n; while (o < b.length) { [n, o] = varint(b, o); out.push(b.subarray(o, o + n)); o += n; } return out; };
export const text = b => new TextDecoder().decode(b);
export const one = (m, f) => m.get(f)?.[0];

function lz4(src, size) {
  const out = new Uint8Array(size); let i = 0, o = 0;
  while (i < src.length) {
    const token = src[i++]; let n = token >> 4;
    if (n === 15) { let x; do { x = src[i++]; n += x; } while (x === 255); }
    out.set(src.subarray(i, i + n), o); i += n; o += n;
    if (i >= src.length) break;
    const back = src[i] | (src[i + 1] << 8); i += 2;
    let m = token & 15; if (m === 15) { let x; do { x = src[i++]; m += x; } while (x === 255); }
    for (let k = 0; k < m + 4; k++, o++) out[o] = out[o - back];
  }
  return out;
}
export function bv41(b) {
  const parts = []; let o = 0; const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  while (text(b.subarray(o, o + 4)) === 'bv41') { const raw = v.getUint32(o + 4, true), size = v.getUint32(o + 8, true); parts.push(lz4(b.subarray(o + 12, o + 12 + size), raw)); o += 12 + size; }
  if (text(b.subarray(o, o + 4)) !== 'bv4$' || !parts.length) throw Error('bad bv41 blob');
  return Uint8Array.from(parts.flatMap(p => [...p]));
}
/** Ballpoint geometry ('vuA(v)A(S(uu))A(S(uuuu))vA(f)') → { schema, version, width, kinds, moves, quads }. */
export function ballpoint(body) {
  const v = new DataView(body.buffer, body.byteOffset, body.byteLength);
  if (text(body.subarray(0, 4)) !== 'tpl\0' || v.getUint32(4, true) !== body.length) throw Error('bad template');
  const zero = body.indexOf(0, 8), schema = text(body.subarray(8, zero)); let o = zero + 1;
  const u16 = () => { const x = v.getUint16(o, true); o += 2; return x; }, f32 = () => { const x = v.getFloat32(o, true); o += 4; return x; }, u32 = () => { const x = v.getUint32(o, true); o += 4; return x; };
  if (schema !== 'vuA(v)A(S(uu))A(S(uuuu))vA(f)') return { schema };
  const version = u16(), width = f32(), kinds = Array.from({ length: u32() }, u16);
  const moves = Array.from({ length: u32() }, () => [f32(), f32()]), quads = Array.from({ length: u32() }, () => [f32(), f32(), f32(), f32()]);
  const one = u16(), widths = Array.from({ length: u32() }, f32);
  return { schema, version, width, kinds, moves, quads, one, widths, rest: body.length - o };
}

/** Whole document summary: event kinds, pages (in order) with their strokes and paper attachment. */
export function read(bytes) {
  const files = unzip(bytes), events = delimited(files.get('index.events.pb') || new Uint8Array()).map(message);
  const kinds = events.map(e => [...e.keys()].find(k => k !== 1));
  const pages = [], layers = new Map();
  for (const e of events) if (e.has(2) && message(one(e, 2)).has(8)) { const l = message(one(e, 2)); layers.set(text(one(l, 2)), l); }
  for (const e of events) if (e.has(54)) {
    const p = message(one(e, 54)), id = text(one(p, 2)), layer = layers.get(text(one(message(one(p, 3)), 1)));
    const notes = [...(BigInt('0x' + id.replace(/-/g, '')) + 1n).toString(16).padStart(32, '0').toUpperCase()].join('').replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-');
    const records = delimited(files.get('notes/' + notes) || new Uint8Array()).map(message);
    const strokes = records.filter(r => r.has(7)).map(r => { const s = message(one(r, 7)); return { color: message(one(s, 4) || new Uint8Array()), highlighter: one(s, 5) === 1, pen: one(s, 3) || 0, geometry: ballpoint(bv41(one(s, 2))) }; });
    const size = layer && message(one(layer, 8));
    pages.push({ id, key: text(one(message(one(p, 4)), 1)), notes, strokes, records: records.length, background: layer && text(one(layer, 4)), size: size && [one(size, 1), one(size, 2)] });
  }
  pages.sort((a, b) => a.key < b.key ? -1 : 1);
  return { files, events, kinds, pages, title: events.filter(e => e.has(30)).map(e => text(one(message(one(message(one(e, 30)), 2)), 1)))[0] };
}
