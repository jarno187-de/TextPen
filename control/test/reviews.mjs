// Reviews through the real Worker and SQLite Durable Object: public API, anti-bot checks, moderation, switch.
import assert from 'node:assert/strict';
import { runtime, login, request, publicBase } from './helpers.mjs';
import { leadingZeroBits } from '../src/reviews.js';

const { mf } = await runtime();
const site = (path, { method = 'GET', data, ip = '198.51.100.40', origin = publicBase } = {}) => mf.dispatchFetch(publicBase + path, { method, headers: { 'CF-Connecting-IP': ip, ...(data ? { 'Content-Type': 'application/json', Origin: origin } : {}) }, body: data ? JSON.stringify(data) : undefined });
let count = 0;
const pass = label => { console.log('PASS ' + label); count++; };
try {
  const config = await (await site('/__site/config')).json();
  assert.equal(config.features.goodnotes, true); assert.equal(config.features.reviews, true);
  assert.equal((await (await site('/__site/reviews')).json()).count, 0);
  pass('New switches default on; empty public list');

  assert.equal((await site('/__site/reviews', { method: 'POST', data: { rating: 5 }, origin: 'https://evil.example' })).status, 403);
  assert.equal((await site('/__site/reviews', { method: 'POST', data: { rating: 5 } })).status, 400);
  assert.equal((await site('/__site/reviews/challenge', { method: 'PATCH' })).status, 405);
  pass('Foreign origin, missing proof of work and other methods rejected');

  const c = await (await site('/__site/reviews/challenge')).json();
  let nonce = 0; while (await leadingZeroBits(`${c.salt}.${nonce}`) < c.difficulty) nonce++;
  const review = { rating: 4, name: 'Test', text: 'Funktioniert gut für meine Lernzettel.', work: { ...c, nonce } };
  assert.equal((await site('/__site/reviews', { method: 'POST', data: review })).status, 429);
  await new Promise(resolve => setTimeout(resolve, 4200));
  let response = await site('/__site/reviews', { method: 'POST', data: review });
  assert.equal(response.status, 201);
  const mine = await response.json();
  assert.equal(mine.status, 'pending');
  assert.equal((await site('/__site/reviews', { method: 'POST', data: review, ip: '198.51.100.41' })).status, 409);
  assert.equal((await (await site('/__site/reviews')).json()).count, 0);
  pass('Too-fast submission refused, solved one stored for moderation, replay refused, nothing public yet');

  const auth = await login(mf);
  assert.equal(auth.state.reviews.queue.length, 1);
  const action = data => request(mf, '/api/action', { cookie: auth.cookie, csrf: auth.csrf, data });
  assert.equal((await action({ action: 'review-moderate', id: mine.id, decision: 'published' })).status, 200);
  assert.equal((await action({ action: 'review-reply', id: mine.id, text: 'Danke!' })).status, 200);
  assert.equal((await action({ action: 'review-update', id: mine.id, rating: 3, name: 'Test', text: 'Funktioniert gut für meine Lernzettel.' })).status, 200);
  assert.equal((await action({ action: 'review-update', id: mine.id, rating: 4, name: 'Test', text: 'www.example.com' })).status, 422);
  const list = await (await site('/__site/reviews')).json();
  assert.equal(list.count, 1); assert.equal(list.average, 3); assert.equal(list.reviews[0].reply.text, 'Danke!');
  pass('Owner publishes and replies in TextPen Control');

  response = await site('/__site/reviews/mine', { method: 'PUT', data: { id: mine.id, token: mine.token, rating: 5, name: 'Test', text: 'Funktioniert gut für meine Lernzettel.' } });
  assert.equal((await response.json()).status, 'published');
  assert.equal((await site('/__site/reviews/mine', { method: 'DELETE', data: { id: mine.id, token: 'a'.repeat(48) } })).status, 404);
  pass('Visitor changes own rating with its key; wrong key cannot delete');

  const settings = structuredClone(auth.state.settings); settings.features.reviews = false;
  assert.equal((await action({ action: 'settings', settings, revision: auth.state.revision })).status, 200);
  assert.equal((await site('/__site/reviews')).status, 403);
  assert.equal((await (await site('/__site/config')).json()).features.reviews, false);
  pass('Switching reviews off closes the public API');
  console.log(`All review groups: ${count} passed.`);
} finally { await mf.dispose(); }
