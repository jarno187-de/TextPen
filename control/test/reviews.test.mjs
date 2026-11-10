// node --test control/test/reviews.test.mjs  — review rules: what reaches the public list and what bots and spammers run into.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ReviewBook, leadingZeroBits } from '../src/reviews.js';
import { memorySql } from './sqlite-adapter.mjs';

const book = () => { const { sql, limit } = memorySql(); return new ReviewBook(sql, 'test-secret-0123456789abcdef', limit); };
async function work(reviews) {
  const c = await reviews.challenge();
  for (let nonce = 0; ; nonce++) if (await leadingZeroBits(`${c.salt}.${nonce}`) >= c.difficulty) return { ...c, nonce };
}
const later = w => w.issued + 5000;
const send = async (reviews, fields, ip = '203.0.113.7') => { const w = await work(reviews); return reviews.submit({ ...fields, work: w }, ip, later(w)); };
const status = async (promise) => { try { await promise; return 'ok'; } catch (e) { return e.status; } };

test('stars-only review appears at once, review with text waits for moderation', async () => {
  const r = book();
  const a = await send(r, { rating: 5 });
  const b = await send(r, { rating: 2, name: 'Mia', text: 'Hat beim Lernzettel gut funktioniert, nur die Ränder sind zu groß.' }, '198.51.100.1');
  assert.equal(a.status, 'published'); assert.equal(b.status, 'pending');
  assert.equal(r.list().count, 1); assert.deepEqual(r.list().reviews, [], 'stars-only counts but is not listed');
  r.moderate(b.id, 'published');
  const list = r.list();
  assert.equal(list.count, 2); assert.equal(list.average, 3.5); assert.deepEqual(list.distribution, [0, 1, 0, 0, 1]);
  assert.deepEqual(list.reviews.map(x => x.name), ['Mia']);
});

test('proof of work: forged, expired, too fast, reused and unsolved challenges fail', async () => {
  const r = book(), w = await work(r);
  assert.equal(await status(r.submit({ rating: 5, work: { ...w, signature: 'f'.repeat(64) } }, '203.0.113.1', later(w))), 400);
  assert.equal(await status(r.submit({ rating: 5, work: { ...w, difficulty: 1 } }, '203.0.113.1', later(w))), 400);
  assert.equal(await status(r.submit({ rating: 5, work: w }, '203.0.113.1', w.issued + 500)), 429, 'submitted instantly');
  assert.equal(await status(r.submit({ rating: 5, work: w }, '203.0.113.1', w.issued + 31 * 60000)), 409, 'expired');
  let bad = 0; while (await leadingZeroBits(`${w.salt}.${bad}`) >= w.difficulty) bad++;
  assert.equal(await status(r.submit({ rating: 5, work: { ...w, nonce: bad } }, '203.0.113.1', later(w))), 400, 'nonce does not solve it');
  assert.equal(await status(r.submit({ rating: 5, work: w }, '203.0.113.1', later(w))), 'ok');
  assert.equal(await status(r.submit({ rating: 4, work: w }, '203.0.113.2', later(w))), 409, 'replayed');
  assert.equal(await status(r.submit({ rating: 5 }, '203.0.113.3')), 400, 'no work at all');
});

test('honeypot: looks accepted, stores nothing', async () => {
  const r = book(), res = await send(r, { rating: 5, website: 'http://spam.example' });
  assert.equal(res.status, 'pending'); assert.equal(r.list().count, 0); assert.equal(r.queue().length, 0);
});

test('content rules: links, e-mail, phone numbers, floods and duplicates', async () => {
  const r = book();
  for (const [text, ip] of [['Super, mehr auf www.example.com', '1.1.1.1'], ['Schreib mir an a@b.de', '1.1.1.2'], ['Ruf an 0176 1234 5678', '1.1.1.3'], ['!!!!!!!!!!!!!!!!!!!!', '1.1.1.4'], ['x'.repeat(1001), '1.1.1.5']])
    assert.ok([400, 422].includes(await status(send(r, { rating: 1, text }, ip))), text.slice(0, 20));
  assert.equal(await status(send(r, { rating: 4, text: 'Am 01.11.2026 für meine Mathe-Zusammenfassung benutzt, 10/10.' }, '1.1.1.6')), 'ok', 'dates are not phone numbers');
  assert.equal(await status(send(r, { rating: 4, text: 'Am 01.11.2026 für meine Mathe-Zusammenfassung benutzt, 10/10!' }, '1.1.1.7')), 409, 'duplicate text');
  assert.equal(await status(send(r, { rating: 0 }, '1.1.1.8')), 400);
  assert.equal(await status(send(r, { rating: 3.5 }, '1.1.1.9')), 400);
});

test('one network: two new reviews per day, then blocked', async () => {
  const r = book();
  assert.equal(await status(send(r, { rating: 5 })), 'ok');
  assert.equal(await status(send(r, { rating: 4 })), 'ok');
  assert.equal(await status(send(r, { rating: 3 })), 429);
  assert.equal(await status(send(r, { rating: 3 }, '2001:db8::1')), 'ok', 'other network unaffected');
});

test('own review: edit and delete only with its token; edited text goes back to moderation', async () => {
  const r = book(), mine = await send(r, { rating: 5 });
  assert.equal(await status(r.edit({ id: mine.id, token: 'a'.repeat(48), rating: 1 }, '203.0.113.7')), 404);
  assert.equal((await r.edit({ id: mine.id, token: mine.token, rating: 4 }, '203.0.113.7')).status, 'published');
  assert.equal((await r.edit({ id: mine.id, token: mine.token, rating: 4, text: 'Jetzt mit Text dazu, bitte prüfen.' }, '203.0.113.7')).status, 'pending');
  assert.equal(r.list().count, 0);
  r.moderate(mine.id, 'rejected');
  assert.equal((await r.edit({ id: mine.id, token: mine.token, rating: 5, text: '' }, '203.0.113.7')).status, 'rejected', 'a rejected review cannot republish itself');
  assert.equal(await status(r.remove({ id: mine.id, token: mine.token })), 'ok');
  assert.equal(await status(r.mine({ id: mine.id, token: mine.token })), 404);
});

test('owner reply is shown under the review; HTTP entry maps errors', async () => {
  const r = book(), a = await send(r, { rating: 3, text: 'Gut, aber die Ränder sind mir zu breit.' }); r.moderate(a.id, 'published');
  r.reply(a.id, 'Danke! Die Ränder lassen sich in den Einstellungen ändern.');
  assert.equal(r.list().reviews[0].reply.text, 'Danke! Die Ränder lassen sich in den Einstellungen ändern.');
  assert.deepEqual((await r.api('GET', '/__site/reviews/nope', {}, '1.2.3.4'))[0], 404);
  const [code, body] = await r.api('POST', '/__site/reviews', { rating: 5 }, '1.2.3.4');
  assert.equal(code, 400); assert.match(body.error, /Sicherheitsprüfung/);
  assert.equal((await r.api('GET', '/__site/reviews/challenge', {}, '1.2.3.4'))[0], 200);
});

test('owner edit: fixes rating, name and text, keeps status and content rules', async () => {
  const r = book(), a = await send(r, { rating: 2, name: 'Mia', text: 'Tolle Ap, nutze sie jeden Tag.' });
  r.moderate(a.id, 'published');
  await r.update(a.id, { rating: 5, name: 'Mia', text: 'Tolle App, nutze sie jeden Tag.' });
  const [row] = r.list().reviews;
  assert.equal(row.rating, 5); assert.equal(row.text, 'Tolle App, nutze sie jeden Tag.'); assert.equal(row.edited, false);
  assert.equal(r.recent()[0].status, 'published');
  assert.equal(await status(r.update(a.id, { rating: 5, text: 'mehr auf www.example.com' })), 422);
  assert.equal(await status(r.update(a.id, { rating: 9 })), 400);
  assert.equal(await status(r.update(999, { rating: 5 })), 404);
});
