import { digest, equal, fail, token } from './security.js';

// Public star reviews without accounts. Several independent layers keep bots and spam out:
//  1. Proof of work: the server signs a random challenge; the browser must find a nonce whose SHA-256
//     starts with DIFFICULTY zero bits (about a second on a phone, expensive for mass submissions).
//     Signed and stateless until used; every challenge works once (replay table).
//  2. Timing: a challenge younger than MIN_FILL_MS is rejected (scripts submit instantly).
//  3. Honeypot: a field people never see. When it is filled the request "succeeds" but nothing is stored.
//  4. Limits per network (keyed by a salted hash, the IP itself is never stored) and globally.
//  5. Content rules: no links, e-mail addresses or phone numbers, no duplicates, length limits.
//  6. Moderation: reviews with a name or text stay hidden until the owner approves them in TextPen Control.
//     Anonymous stars-only reviews carry no content and appear at once. Moderation never depends on the rating.
// Without accounts nobody can prove a reviewer used TextPen; the public notice must say so (UWG § 5b Abs. 3).
const DIFFICULTY = 16, MIN_FILL_MS = 4000, CHALLENGE_MS = 30 * 60000, DAY = 86400000;
const MAX_NAME = 40, MAX_TEXT = 1000, PAGE = 30;
const MODERATE_STARS_ONLY = false;
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(?:de|com|net|org|info|biz|ru|io|xyz|top|shop|app|online|site|link|ly|me|co|eu|at|ch)\b)/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i, PHONE = /(?:\+|\b0)\d(?:[\s/-]?\d){7,}/;

const encoder = new TextEncoder();
async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))), n => n.toString(16).padStart(2, '0')).join('');
}
export async function leadingZeroBits(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  let bits = 0;
  for (const b of bytes) { if (b) return bits + Math.clz32(b) - 24; bits += 8; }
  return bits;
}
function clean(value, max, field) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw fail(`${field} ist ungültig.`);
  const text = value.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[^\P{C}\n]/gu, '').replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length > max) throw fail(`${field} darf höchstens ${max} Zeichen haben.`);
  if (LINK.test(text) || EMAIL.test(text) || PHONE.test(text)) throw fail('Bitte keine Links, E-Mail-Adressen oder Telefonnummern.', 422);
  if (/(.)\1{14,}/u.test(text)) throw fail(`${field} sieht nach Spam aus.`, 422);
  return text;
}
const rating = value => { if (!Number.isInteger(value) || value < 1 || value > 5) throw fail('Bitte 1 bis 5 Sterne wählen.'); return value; };

export class ReviewBook {
  /** sql: Durable Object storage.sql (or a compatible adapter); limit(key, max, windowMs) → boolean. */
  constructor(sql, secret, limit) {
    if (typeof secret !== 'string' || secret.length < 16) throw Error('Bewertungen brauchen ein Secret.');
    this.sql = sql; this.secret = secret; this.limit = limit;
    sql.exec(`CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, rating INTEGER NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL,
        status TEXT NOT NULL, created TEXT NOT NULL, edited TEXT NOT NULL DEFAULT '', token_hash TEXT NOT NULL, text_hash TEXT NOT NULL,
        reply TEXT NOT NULL DEFAULT '', replied TEXT NOT NULL DEFAULT '');
      CREATE INDEX IF NOT EXISTS reviews_status ON reviews(status, id);
      CREATE TABLE IF NOT EXISTS review_challenges (salt TEXT PRIMARY KEY, expires INTEGER NOT NULL);`);
  }
  rows(query, ...params) { return this.sql.exec(query, ...params).toArray(); }
  async network(ip) { return (await digest('review\n' + (ip || 'unknown') + '\n' + this.secret)).slice(0, 32); }

  async challenge(now = Date.now()) {
    const salt = token(12), issued = now;
    return { salt, issued, difficulty: DIFFICULTY, signature: await hmac(this.secret, `${salt}.${issued}.${DIFFICULTY}`) };
  }
  async verifyWork(work, now = Date.now()) {
    if (!work || typeof work !== 'object') throw fail('Sicherheitsprüfung fehlt.', 400);
    const { salt, issued, difficulty, signature, nonce } = work;
    if (typeof salt !== 'string' || !/^[a-f0-9]{24}$/.test(salt) || !Number.isSafeInteger(issued) || difficulty !== DIFFICULTY || typeof signature !== 'string' || !Number.isSafeInteger(nonce) || nonce < 0) throw fail('Sicherheitsprüfung ungültig.', 400);
    if (!equal(signature, await hmac(this.secret, `${salt}.${issued}.${difficulty}`))) throw fail('Sicherheitsprüfung ungültig.', 400);
    if (now - issued > CHALLENGE_MS) throw fail('Die Sicherheitsprüfung ist abgelaufen. Bitte erneut senden.', 409);
    if (now - issued < MIN_FILL_MS) throw fail('Das ging zu schnell. Bitte kurz warten und erneut senden.', 429);
    if (await leadingZeroBits(`${salt}.${nonce}`) < difficulty) throw fail('Sicherheitsprüfung ungültig.', 400);
    this.sql.exec('DELETE FROM review_challenges WHERE expires<?', now);
    if (this.rows('SELECT salt FROM review_challenges WHERE salt=?', salt).length) throw fail('Diese Sicherheitsprüfung wurde schon verwendet.', 409);
    this.sql.exec('INSERT INTO review_challenges(salt,expires) VALUES(?,?)', salt, issued + CHALLENGE_MS);
  }

  /** New review → { id, status, token } (the token is shown once and lets this browser edit or delete it). */
  async submit(data, ip, now = Date.now()) {
    const net = await this.network(ip);
    if (!this.limit('review-try:' + net, 10, 3600000)) throw fail('Zu viele Versuche. Bitte später erneut.', 429);
    await this.verifyWork(data.work, now);
    // Bots fill every field; people never see this one. Answer like a success so the bot learns nothing.
    if (typeof data.website === 'string' && data.website.trim()) return { id: 0, status: 'pending', token: token(24) };
    const stars = rating(data.rating), name = clean(data.name, MAX_NAME, 'Name'), text = clean(data.text, MAX_TEXT, 'Text');
    const textHash = text.length >= 20 ? await digest(text.toLowerCase().replace(/\W+/gu, ' ')) : '';
    if (textHash && this.rows("SELECT id FROM reviews WHERE text_hash=? AND status<>'rejected'", textHash).length) throw fail('Diese Bewertung gibt es schon.', 409);
    if (!this.limit('review-new:' + net, 2, DAY)) throw fail('Aus diesem Netz kamen heute schon Bewertungen. Bitte morgen erneut.', 429);
    if (!this.limit('review-global', 200, DAY)) throw fail('Heute sind sehr viele Bewertungen eingegangen. Bitte morgen erneut.', 429);
    const secret = token(24), status = text || name || MODERATE_STARS_ONLY ? 'pending' : 'published';
    this.sql.exec('INSERT INTO reviews(rating,name,text,status,created,token_hash,text_hash) VALUES(?,?,?,?,?,?,?)', stars, name, text, status, new Date(now).toISOString(), await digest(secret), textHash);
    return { id: this.rows('SELECT last_insert_rowid() AS id')[0].id, status, token: secret };
  }
  async own(id, secret) {
    if (!Number.isSafeInteger(id) || typeof secret !== 'string' || !/^[a-f0-9]{48}$/.test(secret)) throw fail('Bewertung nicht gefunden.', 404);
    const row = this.rows('SELECT * FROM reviews WHERE id=?', id)[0];
    if (!row || !equal(row.token_hash, await digest(secret))) throw fail('Bewertung nicht gefunden.', 404);
    return row;
  }
  /** Changed text goes back into moderation; a changed rating alone stays visible. */
  async edit(data, ip, now = Date.now()) {
    const row = await this.own(data.id, data.token);
    if (!this.limit('review-edit:' + row.id, 10, DAY) || !this.limit('review-try:' + await this.network(ip), 10, 3600000)) throw fail('Zu viele Änderungen. Bitte später erneut.', 429);
    const stars = rating(data.rating), name = clean(data.name, MAX_NAME, 'Name'), text = clean(data.text, MAX_TEXT, 'Text');
    const changed = text !== row.text || name !== row.name;
    const status = row.status === 'rejected' ? 'rejected' : changed && (text || name || MODERATE_STARS_ONLY) ? 'pending' : changed ? 'published' : row.status;
    const textHash = text.length >= 20 ? await digest(text.toLowerCase().replace(/\W+/gu, ' ')) : '';
    this.sql.exec('UPDATE reviews SET rating=?,name=?,text=?,status=?,edited=?,text_hash=? WHERE id=?', stars, name, text, status, new Date(now).toISOString(), textHash, row.id);
    return { id: row.id, status };
  }
  async remove(data) { const row = await this.own(data.id, data.token); this.sql.exec('DELETE FROM reviews WHERE id=?', row.id); return { removed: true }; }
  async mine(data) { const row = await this.own(data.id, data.token); return { id: row.id, rating: row.rating, name: row.name, text: row.text, status: row.status }; }

  /** Public page: average and distribution over all published reviews; the list shows only written ones, newest first. */
  list(before = 0) {
    const stats = this.rows("SELECT rating, COUNT(*) AS n FROM reviews WHERE status='published' GROUP BY rating");
    const distribution = [1, 2, 3, 4, 5].map(r => stats.find(s => s.rating === r)?.n || 0), count = distribution.reduce((a, b) => a + b, 0);
    const rows = this.rows(`SELECT id,rating,name,text,created,edited,reply,replied FROM reviews WHERE status='published' AND text<>'' ${before ? 'AND id<?' : ''} ORDER BY id DESC LIMIT ${PAGE + 1}`, ...(before ? [before] : []));
    return {
      count, average: count ? Math.round(distribution.reduce((a, n, i) => a + n * (i + 1), 0) / count * 10) / 10 : 0, distribution,
      reviews: rows.slice(0, PAGE).map(r => ({ id: r.id, rating: r.rating, name: r.name || 'Anonym', text: r.text, date: r.created, edited: Boolean(r.edited), reply: r.reply ? { text: r.reply, date: r.replied } : null })),
      more: rows.length > PAGE
    };
  }

  // TextPen Control (owner only; the caller has already checked session and CSRF).
  queue() { return this.rows("SELECT id,rating,name,text,status,created,edited,reply FROM reviews WHERE status='pending' ORDER BY id LIMIT 200"); }
  recent() { return this.rows("SELECT id,rating,name,text,status,created,edited,reply FROM reviews WHERE status<>'pending' ORDER BY id DESC LIMIT 100"); }
  moderate(id, decision) {
    if (!['published', 'rejected'].includes(decision)) throw fail('Unbekannte Entscheidung.');
    if (!this.rows('SELECT id FROM reviews WHERE id=?', id).length) throw fail('Bewertung nicht gefunden.', 404);
    this.sql.exec('UPDATE reviews SET status=? WHERE id=?', decision, id);
  }
  reply(id, text, now = Date.now()) {
    if (typeof text !== 'string' || text.trim().length > MAX_TEXT) throw fail('Antwort ist ungültig oder zu lang.');
    if (!this.rows('SELECT id FROM reviews WHERE id=?', id).length) throw fail('Bewertung nicht gefunden.', 404);
    this.sql.exec('UPDATE reviews SET reply=?,replied=? WHERE id=?', text.trim(), text.trim() ? new Date(now).toISOString() : '', id);
  }
  /** Owner correction (typo, wrong star count). Same content rules as visitors; status and the visitor's "edited" mark stay. */
  async update(id, data) {
    if (!this.rows('SELECT id FROM reviews WHERE id=?', id).length) throw fail('Bewertung nicht gefunden.', 404);
    const stars = rating(data.rating), name = clean(data.name, MAX_NAME, 'Name'), text = clean(data.text, MAX_TEXT, 'Text');
    const textHash = text.length >= 20 ? await digest(text.toLowerCase().replace(/\W+/gu, ' ')) : '';
    this.sql.exec('UPDATE reviews SET rating=?,name=?,text=?,text_hash=? WHERE id=?', stars, name, text, textHash, id);
  }
  purge(id) { this.sql.exec('DELETE FROM reviews WHERE id=?', id); }

  /** HTTP-shaped entry for /__site/reviews… → [status, body]. The worker has checked host, Origin and policy. */
  async api(method, path, data, ip) {
    try {
      if (method === 'GET' && path === '/__site/reviews') return [200, this.list(Number(data?.before) || 0)];
      if (method === 'GET' && path === '/__site/reviews/challenge') {
        if (!this.limit('review-challenge:' + await this.network(ip), 60, 3600000)) throw fail('Zu viele Anfragen. Bitte später erneut.', 429);
        return [200, await this.challenge()];
      }
      if (method === 'POST' && path === '/__site/reviews') return [201, await this.submit(data, ip)];
      if (method === 'POST' && path === '/__site/reviews/mine') return [200, await this.mine(data)];
      if (method === 'PUT' && path === '/__site/reviews/mine') return [200, await this.edit(data, ip)];
      if (method === 'DELETE' && path === '/__site/reviews/mine') return [200, await this.remove(data)];
      return [404, { error: 'Nicht gefunden.' }];
    } catch (error) { return [error.status || 503, { error: error.status ? error.message : 'Bewertungen sind gerade nicht verfügbar.' }]; }
  }
}
