import assert from 'node:assert/strict';
import { runtime, request, login, code, testPassword, testIP, adminBase, publicBase } from './helpers.mjs';

let count = 0;
const pass = label => { console.log('PASS ' + label); count++; };
const { mf } = await runtime();
try {
  for (const ip of ['198.51.100.9', '2001:db8::999']) {
    const response = await request(mf, '', { ip });
    assert.equal(response.status, 200); assert.match(await response.text(), /id="login"/);
    assert.equal((await request(mf, '/api/state', { ip })).status, 401);
  }
  assert.equal((await request(mf, '/unknown')).status, 404);
  assert.equal((await mf.dispatchFetch('https://bez.textpen.test/not-the-secret', { headers: { 'CF-Connecting-IP': testIP } })).status, 404);
  assert.equal((await mf.dispatchFetch(adminBase.replace('https:', 'http:'), { headers: { 'CF-Connecting-IP': testIP } })).status, 404);
  pass('IPv4 and IPv6 reach login; secret path, host and HTTPS guards remain');
  const page = await request(mf); assert.equal(page.status, 200); assert.match(await page.text(), /Google Authenticator/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/); assert.match(page.headers.get('cache-control'), /no-store/);
  assert.equal((await request(mf, '/panel.js')).status, 401); assert.equal((await request(mf, '/api/state')).status, 401);
  pass('Admin UI and API never leak before authentication; CSP and no-store');
  assert.equal((await request(mf, '/api/login', { data: { password: 'wrong', code: await code() } })).status, 401);
  assert.equal((await request(mf, '/api/login', { data: { password: testPassword, code: 'bad' } })).status, 401);
  assert.equal((await request(mf, '/api/login', { data: { password: testPassword, code: await code() }, origin: 'https://evil.test' })).status, 403);
  let auth = await login(mf);
  assert.equal((await request(mf, '/api/login', { data: { password: testPassword, code: await code() } })).status, 401);
  pass('Password plus real TOTP, Origin check and used-code replay rejection');
  assert.equal((await request(mf, '/api/state', { cookie: auth.cookie, ip: '198.51.100.9' })).status, 200);
  assert.equal((await request(mf, '/api/action', { cookie: auth.cookie, data: { action: 'settings', settings: auth.state.settings, revision: auth.state.revision } })).status, 403);
  pass('Session survives network changes; CSRF required for writes');
  const action = data => request(mf, '/api/action', { cookie: auth.cookie, csrf: auth.csrf, data });
  const publicGet = (path = '/', ip = '198.51.100.9') => mf.dispatchFetch(publicBase + path, { redirect: 'manual', headers: { 'CF-Connecting-IP': ip } });
  let settings = structuredClone(auth.state.settings); settings.maintenance.enabled = true; settings.maintenance.message = '<script>alert(1)</script> Wartung';
  assert.equal((await action({ action: 'settings', settings, revision: auth.state.revision })).status, 200);
  const maintenance = await publicGet(); assert.equal(maintenance.status, 503); assert.match(await maintenance.text(), /&lt;script&gt;/);
  assert.equal((await publicGet('/app.js')).status, 503);
  assert.equal((await publicGet('/datenschutz.html')).status, 200);
  assert.equal((await request(mf, '/api/state', auth)).status, 200);
  assert.equal((await action({ action: 'settings', settings, revision: auth.state.revision })).status, 409);
  pass('Maintenance covers document and assets, escapes messages, preserves admin/legal, rejects stale writes');
  auth.state = await (await request(mf, '/api/state', auth)).json();
  settings.maintenance.enabled = false; settings.features.pdf = false;
  assert.equal((await action({ action: 'settings', settings, revision: auth.state.revision })).status, 200);
  assert.equal((await (await publicGet('/__site/config')).json()).features.pdf, false);
  assert.equal((await publicGet('/')).status, 200);
  assert.equal((await publicGet('/.internal/manifest')).status, 404);
  assert.equal((await mf.dispatchFetch('https://other.test/' , { headers: { 'CF-Connecting-IP': testIP } })).status, 404);
  pass('Feature flags delivered without admin details; internal manifest and alternate hosts rejected');
  assert.equal((await action({ action: 'block', block: { ip: '198.51.100.9', reason: 'Integration test', expiresAt: '' } })).status, 200);
  assert.equal((await publicGet()).status, 403); assert.equal((await publicGet('/assets/handwriting.ttf')).status, 403);
  assert.equal((await publicGet('/', '198.51.100.10')).status, 200);
  assert.equal((await action({ action: 'block', block: { ip: testIP, reason: '', expiresAt: '' } })).status, 200);
  assert.equal((await action({ action: 'unblock', ip: '198.51.100.9' })).status, 200);
  assert.equal((await request(mf, '/api/state', auth)).status, 200);
  assert.equal((await request(mf, '', { ip: '198.51.100.9' })).status, 200);
  pass('Visitor IP blocks cover public assets and API while admin login stays accessible');
  auth.state = await (await request(mf, '/api/state', auth)).json();
  settings.analytics.enabled = true; settings.pages['/anleitung.html'] = { mode: 'redirect', target: '/' };
  assert.equal((await action({ action: 'settings', settings, revision: auth.state.revision })).status, 200);
  assert.equal((await publicGet('/anleitung.html')).status, 302);
  const event = data => mf.dispatchFetch(publicBase + '/__site/events', { method: 'POST', headers: { 'CF-Connecting-IP': '198.51.100.9', Origin: publicBase, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  await event({ event: 'pdf', consent: false }); await event({ event: 'pdf', consent: true, text: 'must never be stored' }); await event({ event: 'pdf', consent: true });
  auth.state = await (await request(mf, '/api/state', auth)).json();
  assert.equal(auth.state.metrics.filter(m => m.kind === 'event' && m.path === 'pdf').reduce((s, m) => s + m.value, 0), 1);
  assert.ok(!JSON.stringify(auth.state).includes('must never be stored'));
  pass('Events strictly allowlisted, require consent, reject content fields');
  const backup = await (await request(mf, '/api/export', auth)).json();
  for (const secret of ['TOTP_SECRET', 'PASSWORD_HASH', testPassword, auth.cookie, auth.csrf]) assert.ok(!JSON.stringify(backup).includes(secret));
  assert.ok(auth.state.snapshots.length >= 3);
  assert.equal((await action({ action: 'restore', id: auth.state.snapshots[0].id, revision: auth.state.revision })).status, 401);
  assert.equal((await action({ action: 'release', id: 'bad' })).status, 401);
  pass('Automatic backups exclude secrets; restore and release require fresh second-factor authentication');
  assert.equal((await action({ action: 'diagnostics' })).status, 200);
  const diagnostic = await (await request(mf, '/api/state', auth)).json(); assert.equal(diagnostic.health.latest.ok, 1);
  assert.equal((await action({ action: 'refresh-releases' })).status, 409);
  pass('Real health-check plumbing and explicit missing provider configuration');
  assert.equal((await request(mf, '/api/logout', { ...auth, data: {} })).status, 200);
  assert.equal((await request(mf, '/api/state', auth)).status, 401);
  pass('Logout revokes server-side session');
} finally { await mf.dispose(); }
const { mf: closed } = await runtime({ PASSWORD_HASH: '' });
try { assert.equal((await request(closed)).status, 404); pass('Missing credentials fail closed'); } finally { await closed.dispose(); }
const { mf: limited } = await runtime();
try {
  for (let i = 0; i < 5; i++) assert.equal((await request(limited, '/api/login', { data: { password: 'wrong', code: 'bad' } })).status, 401);
  assert.equal((await request(limited, '/api/login', { data: { password: testPassword, code: await code() } })).status, 429);
  pass('Login throttling enforced before expensive password verification');
} finally { await limited.dispose(); }
const { mf: restoring } = await runtime();
try {
  const auth = await login(restoring, -1);
  const action = data => request(restoring, '/api/action', { cookie: auth.cookie, csrf: auth.csrf, data });
  const settings = structuredClone(auth.state.settings); settings.banner = { ...settings.banner, enabled: true, text: 'Before restore' };
  assert.equal((await action({ action: 'settings', settings, revision: auth.state.revision })).status, 200);
  let state = await (await request(restoring, '/api/state', auth)).json();
  const result = await action({ action: 'restore', id: state.snapshots[0].id, revision: state.revision, password: testPassword, code: await code() });
  assert.equal(result.status, 200, await result.text());
  state = await (await request(restoring, '/api/state', auth)).json(); assert.equal(state.settings.banner.enabled, false);
  const backup = { format: 'textpen-settings-v1', settings, blocks: [{ ip: '198.51.100.90', reason: 'Imported', expires: '' }] };
  const imported = await action({ action: 'import', backup, revision: state.revision, password: testPassword, code: await code(1) });
  assert.equal(imported.status, 200, await imported.text());
  state = await (await request(restoring, '/api/state', auth)).json(); assert.equal(state.settings.banner.text, 'Before restore'); assert.equal(state.blocks[0].ip, '198.51.100.90');
  assert.equal('adminIPs' in state, false); assert.equal('adminEntries' in state, false); assert.equal(state.sessions.length, 1);
  pass('Fresh reauthentication restores settings and imports backup atomically without altering access');
} finally { await restoring.dispose(); }
const { mf: racing } = await runtime();
try {
  const data = { password: testPassword, code: await code() };
  const outcomes = await Promise.all([request(racing, '/api/login', { data }), request(racing, '/api/login', { data })]);
  assert.deepEqual(outcomes.map(r => r.status).sort(), [200, 401]);
  pass('Concurrent login attempts cannot reuse the same TOTP code');
} finally { await racing.dispose(); }
const { mf: retired } = await runtime({ ADMIN_ALLOWED_IPS: 'invalid legacy data', ADMIN_PINNED_IPS: 'invalid legacy data' });
try {
  const response = await request(retired, '/api/login', { ip: '198.51.100.77', data: { password: testPassword, code: await code() } });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const state = await (await request(retired, '/api/state', { ip: '2001:db8::777', cookie })).json();
  assert.ok(state.csrf); assert.equal('adminIPs' in state, false);
  for (const action of ['ips', 'ip-add', 'ip-remove', 'ip-rename', 'lock']) {
    const result = await request(retired, '/api/action', { cookie, csrf: state.csrf, data: { action } });
    assert.equal(result.status, 400); assert.match((await result.json()).error, /Unbekannte Aktion/);
  }
  pass('Legacy IP secrets ignored; IPv4 login and IPv6 session work; retired APIs rejected');
} finally { await retired.dispose(); }
console.log(`All integration groups: ${count} passed.`);
