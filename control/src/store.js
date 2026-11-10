import { DurableObject } from 'cloudflare:workers';
import { active, canonicalPath, DEFAULT_SETTINGS, LEGAL, PAGE_PATHS, validateBlock, validateSettings } from './model.js';
import { body, digest, equal, fail, json, matchTotp, normalizeIP, notFound, token, verifyPassword } from './security.js';
import { ReviewBook } from './reviews.js';
import loginHTML from '../ui/login.html';
import panelHTML from '../ui/panel.html';
import stylesheet from '../ui/control.css';
import loginJS from '../ui/login.client.js';
import panelJS from '../ui/panel.client.js';

const COOKIE = '__Host-textpen_admin';
const minute = 60000;
const iso = () => new Date().toISOString();
const day = () => iso().slice(0, 10);
const cookie = value => `${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${value ? 1800 : 0}`;

export class ControlStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env); this.env = env; this.sql = ctx.storage.sql;
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.sql.exec(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, csrf TEXT NOT NULL, ip TEXT NOT NULL, fingerprint TEXT NOT NULL, created INTEGER NOT NULL, seen INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS throttle (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, revision INTEGER NOT NULL, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS blocks (ip TEXT PRIMARY KEY, reason TEXT NOT NULL, expires TEXT NOT NULL, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metrics (day TEXT NOT NULL, kind TEXT NOT NULL, path TEXT NOT NULL, value INTEGER NOT NULL, PRIMARY KEY(day,kind,path));
      CREATE TABLE IF NOT EXISTS checks (at INTEGER PRIMARY KEY, ok INTEGER NOT NULL, status INTEGER NOT NULL, ms INTEGER NOT NULL);`);
    if (!this.get('settings')) { this.set('settings', DEFAULT_SETTINGS); this.set('revision', 1); this.set('createdAt', iso()); }
    // Switches added after the settings were first saved start with their default.
    const settings = this.get('settings');
    if (Object.keys(DEFAULT_SETTINGS.features).some(key => typeof settings.features[key] !== 'boolean')) this.set('settings', { ...settings, features: { ...DEFAULT_SETTINGS.features, ...settings.features } });
  }
  async reviewBook() {
    const secret = this.env.REVIEW_SECRET || this.env.TOTP_SECRET;
    if (!secret) throw fail('Bewertungen sind noch nicht eingerichtet.', 503);
    // A key of its own, derived one-way, so review signatures never reveal the authenticator secret.
    this.reviews ??= new ReviewBook(this.sql, await digest('textpen-reviews-v1\n' + secret), (key, max, windowMs) => this.consumeLimit(key, max, windowMs));
    return this.reviews;
  }
  async reviewApi(method, path, data, ip) {
    if (!this.get('settings').features.reviews) return [403, { error: 'Bewertungen sind gerade ausgeschaltet.' }];
    try { return await (await this.reviewBook()).api(method, path, data, ip); } catch (error) { return [error.status || 503, { error: error.status ? error.message : 'Bewertungen sind gerade nicht verfügbar.' }]; }
  }
  rows(query, ...params) { return this.sql.exec(query, ...params).toArray(); }
  get(key) { const row = this.rows('SELECT value FROM kv WHERE key=?', key)[0]; return row ? JSON.parse(row.value) : null; }
  set(key, value) { this.sql.exec('INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value)); }
  audit(action, detail = '') { this.sql.exec('INSERT INTO audit(at,action,detail) VALUES(?,?,?)', iso(), action, String(detail).slice(0, 500)); }
  metric(kind, path = '', amount = 1) { this.sql.exec('INSERT INTO metrics(day,kind,path,value) VALUES(?,?,?,?) ON CONFLICT(day,kind,path) DO UPDATE SET value=value+excluded.value', day(), kind, path, amount); }
  cleanup() {
    const now = Date.now();
    this.sql.exec('DELETE FROM sessions WHERE expires<? OR seen<?', now, now - 10 * minute);
    this.sql.exec('DELETE FROM throttle WHERE until_at<?', now);
    this.sql.exec('DELETE FROM blocks WHERE expires<>? AND expires<?', '', iso());
    this.sql.exec('DELETE FROM checks WHERE at<?', now - 30 * 86400000);
    this.sql.exec('DELETE FROM audit WHERE at<?', new Date(now - 90 * 86400000).toISOString());
    this.sql.exec('DELETE FROM metrics WHERE day<?', new Date(now - 90 * 86400000).toISOString().slice(0, 10));
    this.sql.exec('DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY id DESC LIMIT 50)');
  }
  consumeLimit(key, max, windowMs) {
    const now = Date.now(), row = this.rows('SELECT count,until_at FROM throttle WHERE key=?', key)[0];
    if (!row || row.until_at <= now) { this.sql.exec('INSERT INTO throttle(key,count,until_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=1,until_at=excluded.until_at', key, now + windowMs); return true; }
    if (row.count >= max) return false;
    this.sql.exec('UPDATE throttle SET count=count+1 WHERE key=?', key); return true;
  }
  async identity() {
    if (!this.env.ADMIN_PATH || !this.env.PASSWORD_HASH || !this.env.TOTP_SECRET) return null;
    // Retire the previous allowlist, including persisted entries from older deployments.
    this.sql.exec("DELETE FROM kv WHERE key IN ('adminEntries','adminIPs','ipSeed')");
    const fingerprint = await digest(this.env.PASSWORD_HASH + '\n' + this.env.TOTP_SECRET + '\n' + this.env.ADMIN_PATH + '\n' + (this.env.RECOVERY_NONCE || ''));
    if (this.get('authFingerprint') !== fingerprint) {
      this.ctx.storage.transactionSync(() => {
        this.sql.exec('DELETE FROM sessions'); this.set('authFingerprint', fingerprint);
      });
    }
    return fingerprint;
  }
  async session(request, fingerprint) {
    const cookies = (request.headers.get('cookie') || '').split(';').map(s => s.trim());
    const raw = cookies.find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
    if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return null;
    const id = await digest(raw), row = this.rows('SELECT * FROM sessions WHERE id=?', id)[0], now = Date.now();
    if (!row || row.fingerprint !== fingerprint || row.expires <= now || row.seen < now - 10 * minute) return null;
    this.sql.exec('UPDATE sessions SET seen=? WHERE id=?', now, id); return row;
  }
  async verifyCredentials(data, ip) {
    if (!this.consumeLimit('auth:' + ip, 5, 15 * minute) || !this.consumeLimit('auth:global', 15, 15 * minute)) throw fail('Zu viele Versuche. Bitte 15 Minuten warten.', 429);
    const counter = await matchTotp(this.env.TOTP_SECRET, data.code);
    const passwordOK = counter !== null && verifyPassword(data.password, this.env.PASSWORD_HASH);
    if (!passwordOK) { this.audit('login-failed', 'Anmeldedaten nicht bestätigt.'); this.metric('login-failed'); throw fail('Anmeldung nicht möglich. Zugangsdaten und aktuellen Code prüfen.', 401); }
    // Synchronous transaction: a concurrent request cannot reuse an accepted TOTP step.
    this.ctx.storage.transactionSync(() => {
      if (counter <= (this.get('lastTotp') ?? -1)) throw fail('Bitte den nächsten Authenticator-Code verwenden.', 401);
      this.set('lastTotp', counter);
    });
    this.sql.exec('DELETE FROM throttle WHERE key=?', 'auth:' + ip);
  }
  async fetch(request) {
    try {
      const url = new URL(request.url), path = url.pathname, ip = normalizeIP(request.headers.get('X-Control-IP'));
      if (path === '/live' && request.method === 'GET') {
        const page = canonicalPath(url.searchParams.get('path') || '/');
        if (!ip || !PAGE_PATHS.includes(page) || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return notFound();
        const [client, server] = Object.values(new WebSocketPair());
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment({ path: page, ip });
        server.send(JSON.stringify({ type: 'policy', policy: this.policy(page, ip, false) }));
        await this.schedulePolicyChange();
        return new Response(null, { status: 101, webSocket: client });
      }
      const fingerprint = await this.identity();
      if (!fingerprint) return notFound();
      const isWrite = !['GET', 'HEAD'].includes(request.method);
      if (isWrite && (request.method !== 'POST' || request.headers.get('origin') !== 'https://' + this.env.ADMIN_HOST)) throw fail('Anfrage nicht erlaubt.', 403);
      const session = await this.session(request, fingerprint);
      if (request.method === 'GET' && path === '/') return new Response((session ? panelHTML : loginHTML).replaceAll('__BASE__', '/' + this.env.ADMIN_PATH + '/'), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      if (request.method === 'GET' && path === '/control.css') return new Response(stylesheet, { headers: { 'Content-Type': 'text/css; charset=utf-8' } });
      if (request.method === 'GET' && path === '/login.js') return new Response(loginJS, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
      if (path === '/api/login' && request.method === 'POST') {
        const data = await body(request); await this.verifyCredentials(data, ip);
        const raw = token(), id = await digest(raw), now = Date.now();
        this.sql.exec('INSERT INTO sessions(id,csrf,ip,fingerprint,created,seen,expires) VALUES(?,?,?,?,?,?,?)', id, token(), ip, fingerprint, now, now, now + 30 * minute);
        this.audit('login', 'Anmeldung mit Passwort und Authenticator erfolgreich.');
        return json({ ok: true }, 200, { 'Set-Cookie': cookie(raw) });
      }
      if (!session) return json({ error: 'Bitte erneut anmelden.' }, 401);
      if (request.method === 'GET' && path === '/panel.js') return new Response(panelJS, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
      if (isWrite && !equal(request.headers.get('X-CSRF-Token') || '', session.csrf)) throw fail('Sicherheitsprüfung fehlgeschlagen.', 403);
      if (path === '/api/state' && request.method === 'GET') return json(await this.state(session));
      if (path === '/api/export' && request.method === 'GET') return json({ format: 'textpen-settings-v1', exportedAt: iso(), settings: this.get('settings'), blocks: this.rows('SELECT * FROM blocks') }, 200, { 'Content-Disposition': 'attachment; filename="textpen-einstellungen.json"' });
      if (path === '/api/logout' && request.method === 'POST') { this.sql.exec('DELETE FROM sessions WHERE id=?', session.id); return json({ ok: true }, 200, { 'Set-Cookie': cookie('') }); }
      if (path === '/api/action' && request.method === 'POST') {
        const data = await body(request, 1048576);
        const privileged = ['revoke-all', 'restore', 'import', 'release'];
        if (privileged.includes(data.action)) await this.verifyCredentials(data, ip);
        return await this.action(data, session);
      }
      return notFound();
    } catch (error) { return json({ error: error.status ? error.message : 'Dienst vorübergehend nicht verfügbar. Es wurde kein Zugang freigegeben.' }, error.status || 503); }
  }
  async state(session) {
    this.cleanup();
    let manifest = this.get('manifest');
    if (!manifest) { try { manifest = await (await this.env.SITE.fetch('https://content.internal/.internal/manifest')).json(); this.set('manifest', manifest); } catch { /* show unavailable */ } }
    const checks = this.rows('SELECT * FROM checks ORDER BY at DESC LIMIT 288');
    const reviews = await this.reviewBook().then(book => ({ queue: book.queue(), recent: book.recent() }), () => ({ queue: [], recent: [], unavailable: true }));
    const summary = this.rows('SELECT COUNT(*) AS total,SUM(ok) AS passed FROM checks')[0];
    return {
      now: iso(), csrf: session.csrf, revision: this.get('revision'), createdAt: this.get('createdAt'),
      settings: this.get('settings'), maintenanceActive: active(this.get('settings').maintenance),
      manifest, blocks: this.rows('SELECT * FROM blocks ORDER BY created DESC'),
      sessions: this.rows('SELECT id,ip,created,seen,expires FROM sessions ORDER BY created DESC').map(s => ({ ...s, current: s.id === session.id })),
      audit: this.rows('SELECT * FROM audit ORDER BY id DESC LIMIT 100'), snapshots: this.rows('SELECT id,at,revision FROM snapshots ORDER BY id DESC LIMIT 50'),
      metrics: this.rows('SELECT * FROM metrics WHERE day>=? ORDER BY day', new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)),
      health: { latest: checks[0] || null, checks: checks.reverse(), total: summary.total, passed: summary.passed, expectedMaintenance: this.get('healthMaintenance') || false },
      capabilities: { adsReady: false, releases: Boolean(this.env.CF_API_TOKEN && this.env.CF_ACCOUNT_ID), usage: false },
      limits: { workerRequestsPerDay: 100000, metricRetentionDays: 90, auditRetentionDays: 90, idleMinutes: 10, sessionMinutes: 30 },
      releases: this.get('releases') || [], lastReleaseResult: this.get('lastReleaseResult'), reviews
    };
  }
  saveSettings(settings, expectedRevision, action) {
    this.ctx.storage.transactionSync(() => {
      if (expectedRevision !== this.get('revision')) throw fail('Die Einstellungen wurden inzwischen geändert. Bitte aktualisieren.', 409);
      const previous = this.get('settings');
      this.sql.exec('INSERT INTO snapshots(at,revision,value) VALUES(?,?,?)', iso(), expectedRevision, JSON.stringify(previous));
      this.set('settings', settings); this.set('revision', expectedRevision + 1); this.audit(action, 'Revision ' + (expectedRevision + 1));
    });
  }
  async action(data, session) {
    switch (data.action) {
      case 'settings': this.saveSettings(validateSettings(data.settings), data.revision, 'settings'); break;
      case 'block': {
        const block = validateBlock(data.block);
        if (this.rows('SELECT COUNT(*) AS n FROM blocks')[0].n >= 500 && !this.rows('SELECT ip FROM blocks WHERE ip=?', block.ip).length) throw fail('Maximal 500 IP-Sperren.');
        this.sql.exec('INSERT INTO blocks(ip,reason,expires,created) VALUES(?,?,?,?) ON CONFLICT(ip) DO UPDATE SET reason=excluded.reason,expires=excluded.expires', block.ip, block.reason, block.expiresAt, iso());
        this.audit('ip-blocked', 'Besuchersperre hinzugefügt oder aktualisiert.'); break;
      }
      case 'unblock': this.sql.exec('DELETE FROM blocks WHERE ip=?', normalizeIP(data.ip) || ''); this.audit('ip-unblocked', 'Besuchersperre aufgehoben.'); break;
      case 'revoke': if (typeof data.id !== 'string') throw fail('Sitzung fehlt.'); this.sql.exec('DELETE FROM sessions WHERE id=?', data.id); this.audit('session-revoked'); break;
      case 'revoke-all': this.sql.exec('DELETE FROM sessions'); this.audit('sessions-revoked'); return json({ ok: true, loggedOut: true }, 200, { 'Set-Cookie': cookie('') });
      case 'restore': {
        const snapshot = this.rows('SELECT value FROM snapshots WHERE id=?', Number(data.id))[0]; if (!snapshot) throw fail('Sicherung nicht gefunden.', 404);
        this.saveSettings(validateSettings(JSON.parse(snapshot.value)), data.revision, 'settings-restored'); break;
      }
      case 'import': {
        if (data.backup?.format !== 'textpen-settings-v1') throw fail('Ungültige Sicherung.');
        const settings = validateSettings(data.backup.settings);
        const blocks = data.backup.blocks; if (!Array.isArray(blocks) || blocks.length > 500) throw fail('Ungültige Sperrliste.');
        const validated = blocks.filter(b => !b.expires || Date.parse(b.expires) > Date.now()).map(b => validateBlock({ ...b, expiresAt: b.expires }));
        this.ctx.storage.transactionSync(() => { this.saveSettings(settings, data.revision, 'backup-imported'); this.sql.exec('DELETE FROM blocks'); for (const b of validated) this.sql.exec('INSERT INTO blocks VALUES(?,?,?,?)', b.ip, b.reason, b.expiresAt, iso()); }); break;
      }
      case 'diagnostics': if (!this.consumeLimit('diagnostics', 5, minute)) throw fail('Bitte vor der nächsten Prüfung kurz warten.', 429); await this.checkHealth(); break;
      case 'refresh-releases': await this.refreshReleases(); break;
      case 'review-moderate': (await this.reviewBook()).moderate(Number(data.id), data.decision); this.audit(data.decision === 'published' ? 'review-published' : 'review-rejected', 'Bewertung #' + Number(data.id)); break;
      case 'review-reply': (await this.reviewBook()).reply(Number(data.id), data.text); this.audit('review-replied', 'Bewertung #' + Number(data.id)); break;
      case 'review-update': await (await this.reviewBook()).update(Number(data.id), data); this.audit('review-edited', 'Bewertung #' + Number(data.id)); break;
      case 'review-delete': (await this.reviewBook()).purge(Number(data.id)); this.audit('review-deleted', 'Bewertung #' + Number(data.id)); break;
      case 'release': await this.deployRelease(data.id); break;
      default: throw fail('Unbekannte Aktion.');
    }
    if (['settings', 'block', 'unblock', 'restore', 'import'].includes(data.action)) {
      await this.schedulePolicyChange();
      await this.ctx.storage.sync();
      this.broadcastPolicy();
    }
    return json({ ok: true, revision: this.get('revision') });
  }
  async publicPolicy(rawPath, rawIP) {
    return this.policy(rawPath, rawIP);
  }
  policy(rawPath, rawIP, record = true) {
    const path = canonicalPath(rawPath), ip = normalizeIP(rawIP), settings = this.get('settings');
    const config = { features: settings.features, ads: { enabled: false, ready: false }, analytics: settings.analytics, banner: active(settings.banner) ? { text: settings.banner.text, tone: settings.banner.tone } : null };
    const base = { path, config };
    if (ip) {
      const block = this.rows('SELECT expires FROM blocks WHERE ip=?', ip)[0];
      if (block && (!block.expires || Date.parse(block.expires) > Date.now())) { if (record) this.metric('blocked'); return { ...base, mode: 'blocked' }; }
    }
    if (active(settings.maintenance) && (settings.maintenance.includeLegal || ![...LEGAL, '/public.css', '/style.css', '/textpen.css', '/assets/textpen-icon.png', '/assets/icon-192.png', '/assets/apple-touch-icon.png', '/favicon.ico', '/manifest.webmanifest'].includes(path))) {
      if (record && PAGE_PATHS.includes(path)) this.metric('maintenance', path);
      return { ...base, mode: 'maintenance', message: settings.maintenance.message, showLegalLinks: !settings.maintenance.includeLegal, retryAfter: settings.maintenance.endsAt ? Math.max(60, Math.ceil((Date.parse(settings.maintenance.endsAt) - Date.now()) / 1000)) : 300 };
    }
    const rule = settings.pages[path];
    if (rule?.mode === 'blocked') { if (record) this.metric('page-blocked', path); return { ...base, mode: 'blocked' }; }
    if (rule?.mode === 'redirect') return { ...base, mode: 'redirect', target: rule.target };
    return { ...base, mode: 'open' };
  }
  broadcastPolicy() {
    for (const socket of this.ctx.getWebSockets()) {
      try {
        const { path, ip } = socket.deserializeAttachment();
        socket.send(JSON.stringify({ type: 'policy', policy: this.policy(path, ip, false) }));
      } catch { try { socket.close(1011, 'Reconnect'); } catch { /* disconnected */ } }
    }
  }
  async schedulePolicyChange() {
    const settings = this.get('settings'), now = Date.now();
    const dates = [settings.banner, settings.maintenance].filter(value => value.enabled).flatMap(value => [value.startsAt, value.endsAt]);
    dates.push(...this.rows("SELECT expires FROM blocks WHERE expires<>''").map(row => row.expires));
    const next = dates.map(Date.parse).filter(at => at > now);
    if (next.length) await this.ctx.storage.setAlarm(Math.min(...next));
    else await this.ctx.storage.deleteAlarm();
  }
  async alarm() {
    this.broadcastPolicy();
    await this.schedulePolicyChange();
  }
  webSocketMessage(socket) { socket.close(1008, 'Read-only connection'); }
  webSocketClose(socket, code) { socket.close(code); }
  webSocketError(socket) { socket.close(1011, 'Reconnect'); }
  async recordPage(path, status) { if (PAGE_PATHS.includes(path)) this.metric(status >= 400 ? 'errors' : 'pageviews', path); }
  async collectEvent(ip, input) {
    if (!this.get('settings').analytics.enabled) return false;
    if (!['pdf', 'image', 'print', 'fontImport', 'fontExport'].includes(input.event) || input.consent !== true || Object.keys(input).some(k => !['event', 'consent'].includes(k))) return false;
    const key = 'events:' + await digest((ip || 'unknown') + this.env.TOTP_SECRET);
    if (!this.consumeLimit(key, 20, minute) || !this.consumeLimit('events-global', 300, minute)) return false;
    this.metric('event', input.event); return true;
  }
  async checkHealth() {
    this.cleanup(); const start = Date.now(); let status = 0, ok = false;
    try {
      const response = await fetch('https://' + this.env.PUBLIC_HOST + '/', { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10000) });
      status = response.status; ok = status >= 200 && status < 400; await response.body?.cancel();
      // Manifest only through the private content binding.
      const manifest = await (await this.env.SITE.fetch('https://content.internal/.internal/manifest')).json(); this.set('manifest', manifest);
    } catch { /* record actual failure, never invented uptime */ }
    this.sql.exec('INSERT OR REPLACE INTO checks(at,ok,status,ms) VALUES(?,?,?,?)', start, ok ? 1 : 0, status, Date.now() - start);
    this.set('healthMaintenance', active(this.get('settings').maintenance));
    return { ok, status };
  }
  async cf(path, options = {}) {
    if (!this.env.CF_ACCOUNT_ID || !this.env.CF_API_TOKEN) throw fail('Cloudflare-Veröffentlichungszugang ist noch nicht eingerichtet.', 409);
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.env.CF_ACCOUNT_ID)}/workers/scripts/${encodeURIComponent(this.env.SITE_SCRIPT)}/${path}`, { ...options, headers: { Authorization: 'Bearer ' + this.env.CF_API_TOKEN, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000) });
    const data = await response.json(); if (!response.ok || !data.success) throw fail('Cloudflare hat die Anfrage nicht bestätigt. Bitte den Zustand im Cloudflare-Konto prüfen.', 502);
    return data.result;
  }
  async refreshReleases() {
    const result = await this.cf('versions');
    const items = (result.items || []).slice(0, 20).map(v => ({ id: v.id, created: v.metadata?.created_on || '', message: v.annotations?.['workers/message'] || 'Vorbereitete Website-Version' }));
    this.set('releases', items); return items;
  }
  async deployRelease(id) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw fail('Ungültige Versionskennung.');
    const releases = await this.refreshReleases(); if (!releases.some(r => r.id === id)) throw fail('Version nicht mehr verfügbar.');
    // Only the dedicated content Worker can be deployed. Auth and control state are untouched.
    const result = await this.cf('deployments', { method: 'POST', body: JSON.stringify({ strategy: 'percentage', versions: [{ version_id: id, percentage: 100 }], annotations: { 'workers/message': 'TextPen Control: geprüfte Website-Version' } }) });
    this.set('lastReleaseResult', { at: iso(), id, deployment: result.id, status: 'accepted' }); this.audit('release', id);
    const verification = await this.cf('deployments');
    const current = (verification.deployments || verification)[0];
    if (!current?.versions?.some(v => v.version_id === id && v.percentage === 100)) throw fail('Veröffentlichung angefordert, aber noch nicht verifiziert. Bitte aktualisieren.', 502);
    this.set('lastReleaseResult', { at: iso(), id, deployment: result.id, status: 'verified' }); await this.checkHealth();
  }
}
