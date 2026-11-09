import { argon2id } from '@noble/hashes/argon2.js';
import ipaddr from 'ipaddr.js';

const encoder = new TextEncoder();
export const encode = value => encoder.encode(value);
export const hex = bytes => Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
export const unhex = value => Uint8Array.from(value.match(/.{2}/g) || [], v => parseInt(v, 16));
export const token = (size = 32) => hex(crypto.getRandomValues(new Uint8Array(size)));
export const digest = async value => hex(await crypto.subtle.digest('SHA-256', encode(value)));
export function equal(a, b) {
  const x = encode(String(a)), y = encode(String(b));
  if (x.length !== y.length) return false;
  let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i];
  return difference === 0;
}
export function passwordHash(password, salt = token(16)) {
  if (typeof password !== 'string' || password.length < 20 || password.length > 256) throw new Error('Passwort muss 20 bis 256 Zeichen lang sein.');
  return JSON.stringify({ algorithm: 'argon2id', salt, hash: hex(argon2id(password, unhex(salt), { m: 19456, t: 2, p: 1, dkLen: 32 })) });
}
export function verifyPassword(password, verifier) {
  try {
    if (typeof password !== 'string' || password.length > 256) return false;
    const saved = JSON.parse(verifier);
    if (saved.algorithm !== 'argon2id' || !/^[a-f0-9]{32}$/.test(saved.salt) || !/^[a-f0-9]{64}$/.test(saved.hash)) return false;
    return equal(hex(argon2id(password, unhex(saved.salt), { m: 19456, t: 2, p: 1, dkLen: 32 })), saved.hash);
  } catch { return false; }
}
export function normalizeIP(value) {
  if (typeof value !== 'string' || value.includes('%') || value !== value.trim()) return null;
  try {
    if (!ipaddr.isValid(value)) return null;
    const ip = ipaddr.process(value);
    if (ip.kind() === 'ipv4' && !/^\d{1,3}(\.\d{1,3}){3}$/.test(value) && !value.includes(':')) return null;
    return ip.toString();
  } catch { return null; }
}
export function ipVersion(value) { const ip = normalizeIP(value); return ip ? (ipaddr.process(ip).kind() === 'ipv4' ? 'ipv4' : 'ipv6') : null; }
export function normalizeTotpCode(value) {
  if (typeof value !== 'string') return null;
  const code = value.replace(/[\s\u200e\u200f\u202a-\u202e\u2066-\u2069-]/gu, '');
  return /^\d{6}$/.test(code) ? code : null;
}
export function parseIPs(value) {
  const list = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(list) || list.length > 30) throw new Error('Maximal 30 einzelne IP-Adressen.');
  const normalized = list.map(normalizeIP);
  if (normalized.some(ip => !ip)) throw new Error('Ungültige IP-Adresse. Bitte einzelne IPv4- oder IPv6-Adressen angeben.');
  return [...new Set(normalized)];
}
export function base32(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, value = 0, output = '';
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { output += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}
export function fromBase32(text) {
  let bits = 0, value = 0; const bytes = [];
  for (const char of text.toUpperCase().replace(/=+$/, '')) {
    const n = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char); if (n < 0) throw new Error('Invalid base32');
    value = (value << 5) | n; bits += 5; if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(bytes);
}
export async function totp(secret, counter) {
  const key = await crypto.subtle.importKey('raw', fromBase32(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const buffer = new ArrayBuffer(8); new DataView(buffer).setBigUint64(0, BigInt(counter));
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, buffer)), offset = bytes[19] & 15;
  return String((new DataView(bytes.buffer).getUint32(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
export async function matchTotp(secret, code, now = Date.now()) {
  code = normalizeTotpCode(code);
  if (!code) return null;
  const step = Math.floor(now / 30000);
  for (const counter of [step, step - 1, step + 1]) if (equal(await totp(secret, counter), code)) return counter;
  return null;
}
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
}
export const notFound = () => new Response('Nicht gefunden.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
export function fail(message, status = 400) { return Object.assign(new Error(message), { status }); }
export async function body(request, max = 12000) {
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw fail('JSON erforderlich.', 415);
  if (Number(request.headers.get('content-length')) > max) throw fail('Anfrage zu groß.', 413);
  const reader = request.body?.getReader(); if (!reader) throw fail('Anfrage fehlt.');
  const chunks = []; let length = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > max) { await reader.cancel(); throw fail('Anfrage zu groß.', 413); } chunks.push(value); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { const parsed = JSON.parse(new TextDecoder().decode(bytes)); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw Error(); return parsed; } catch { throw fail('Ungültiges JSON.'); }
}
export const escapeHTML = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
