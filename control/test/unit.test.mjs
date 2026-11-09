import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIP, parseIPs, passwordHash, verifyPassword, totp, matchTotp, normalizeTotpCode, base32, fromBase32, escapeHTML } from '../src/security.js';
import { referenceClock } from '../scripts/clock.mjs';
import { DEFAULT_SETTINGS, validateSettings, active, canonicalPath } from '../src/model.js';

test('IPv4 and IPv6 normalization cannot accept forwarded lists, invalid values or broad networks', () => {
  assert.equal(normalizeIP('104.28.62.43'), '104.28.62.43');
  assert.equal(normalizeIP('::ffff:104.28.62.43'), '104.28.62.43');
  assert.equal(normalizeIP('2001:0db8:0:0:0:0:0:1'), '2001:db8::1');
  for (const value of ['', ' 104.28.62.43', '104.28.62.43, 1.1.1.1', '999.1.1.1', '127.1', '0x7f000001', '2001:db8::1%eth0', '0.0.0.0/0']) assert.equal(normalizeIP(value), null, value);
  assert.deepEqual(parseIPs(['::ffff:104.28.62.43', '104.28.62.43']), ['104.28.62.43']);
  assert.throws(() => parseIPs(['bad']));
});
test('Argon2id verifies without truncating long passwords or storing plaintext', () => {
  const password = 'A!b#9-'.repeat(20), verifier = passwordHash(password);
  assert.ok(!verifier.includes(password)); assert.ok(verifyPassword(password, verifier));
  assert.equal(verifyPassword(password.slice(0, -1) + 'X', verifier), false);
  assert.equal(verifyPassword(password, '{invalid'), false);
});
test('Google Authenticator TOTP follows RFC 6238 test vector', async () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(await totp(secret, 1), '287082');
  assert.equal(await matchTotp(secret, '287082', 59000), 1);
  assert.equal(await matchTotp(secret, '287082', 180000), null);
  assert.equal(await matchTotp(secret, 'bad', 59000), null);
  const bytes = new Uint8Array([1, 2, 3, 254, 255]); assert.deepEqual(fromBase32(base32(bytes)), bytes);
});
test('Settings validate schedules, feature types, advertising readiness and redirect cycles', () => {
  assert.deepEqual(validateSettings(structuredClone(DEFAULT_SETTINGS)), DEFAULT_SETTINGS);
  const s = structuredClone(DEFAULT_SETTINGS); s.pages = { '/': { mode: 'redirect', target: '/anleitung.html' }, '/anleitung.html': { mode: 'redirect', target: '/' } }; assert.throws(() => validateSettings(s));
  s.pages = {}; s.ads.enabled = true; assert.throws(() => validateSettings(s));
  s.ads.enabled = false; s.maintenance.startsAt = '2026-10-20T00:00:00Z'; s.maintenance.endsAt = '2026-10-19T00:00:00Z'; assert.throws(() => validateSettings(s));
  assert.equal(active({ enabled: true, startsAt: '2030-01-01T00:00:00Z', endsAt: '' }, 0), false);
  assert.equal(canonicalPath('/index.html'), '/'); assert.equal(canonicalPath('/anleitung'), '/anleitung.html');
  assert.equal(escapeHTML('<img onerror="bad">'), '&lt;img onerror=&quot;bad&quot;&gt;');
});
test('Authenticator accepts grouped codes, preserves leading zeros and rejects non-codes', async () => {
  assert.equal(normalizeTotpCode(' 012 345 '), '012345');
  assert.equal(normalizeTotpCode('287\u00a0082'), '287082');
  assert.equal(normalizeTotpCode('12ab34'), null); assert.equal(normalizeTotpCode('12345'), null);
  assert.equal(await matchTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', '287 082', 59000), 1);
});
test('Clock diagnosis finds consensus and corrects local 69-second drift without widening TOTP validity', async () => {
  const local = 1000000, server = local + 69000;
  const reading = async () => new Response(null, { headers: { Date: new Date(server).toUTCString() } });
  const result = await referenceClock(reading, () => local); assert.equal(result.trusted, true); assert.ok(Math.abs(result.offset - 69000) <= 1000);
  let n = 0;
  const disagreeing = async () => new Response(null, { headers: { Date: new Date(server + (++n * 20000)).toUTCString() } });
  assert.equal((await referenceClock(disagreeing, () => local)).trusted, false);
  const unavailable = async () => { throw Error('Offline'); }; assert.equal((await referenceClock(unavailable, () => local)).trusted, false);
});
