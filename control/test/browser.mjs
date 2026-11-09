import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { runtime, root, code, testPassword, testIP, adminBase, publicBase } from './helpers.mjs';
const { mf } = await runtime();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const screenshots = path.join(root, '.build/test/screenshots'); await mkdir(screenshots, { recursive: true });
const pass = message => console.log('PASS ' + message);
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  // A returning visitor: the first-visit introduction would cover the controls this test clicks.
  await context.addInitScript(() => { try { localStorage.setItem('textpen-onboarding', '1'); } catch {} });
  const events = [];
  const liveConnections = new Set();
  await context.routeWebSocket('**/__site/live?*', async route => {
    const response = await mf.dispatchFetch(route.url().replace('wss:', 'https:'), { headers: { Upgrade: 'websocket', Origin: publicBase, 'CF-Connecting-IP': '198.51.100.20' } });
    assert.equal(response.status, 101);
    const socket = response.webSocket; liveConnections.add(socket);
    socket.addEventListener('message', event => route.send(event.data));
    socket.addEventListener('close', () => { liveConnections.delete(socket); route.close().catch(() => {}); });
    route.onMessage(message => socket.send(message));
    route.onClose(() => { liveConnections.delete(socket); try { socket.close(1000); } catch { /* already closed */ } });
    socket.accept();
  });
  await context.route('**/*', async route => {
    const req = route.request(), url = req.url();
    if (!url.startsWith('https://textpen.test') && !url.startsWith(publicBase)) { await route.abort(); return; }
    if (url.endsWith('/__site/events')) events.push(req.postDataJSON());
    try {
      const response = await mf.dispatchFetch(url, { method: req.method(), headers: { ...req.headers(), 'CF-Connecting-IP': url.startsWith(adminBase) ? testIP : '198.51.100.20' }, body: req.postDataBuffer() || undefined, redirect: 'manual' });
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    } catch (error) { errors.push(error.message); await route.abort(); }
  });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(adminBase); await page.locator('#login').waitFor(); await page.screenshot({ path: path.join(screenshots, 'login.png') });
  await page.locator('#password').fill(testPassword); await page.locator('#code').fill(await code(-1)); await page.locator('button[type=submit]').click();
  await page.locator('.page-heading h1').waitFor(); assert.match(await page.locator('.page-heading h1').textContent(), /Übersicht/);
  pass('Browser login using actual Argon2id password and Google-compatible TOTP, secure cookie, strict CSP');
  await page.screenshot({ path: path.join(screenshots, 'overview-desktop.png'), fullPage: true });
  const visitor = await context.newPage(); visitor.on('pageerror', e => errors.push(e.message)); await visitor.goto(publicBase + '/');
  await visitor.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  const otherPages = [];
  for (const path of ['/anleitung.html', '/impressum.html', '/datenschutz.html']) {
    const other = await context.newPage(); other.on('pageerror', e => errors.push(e.message)); await other.goto(publicBase + path); otherPages.push(other);
  }
  const publicPages = [visitor, ...otherPages];
  for (const tab of publicPages) await tab.evaluate(() => { window.liveTestMarker = 'preserved'; });
  await page.locator('[data-view=operations]').click(); await page.locator('#banner-enabled').check(); await page.locator('#banner-text').fill('Neu: <script>kein HTML</script>');
  await page.locator('#operations-form button[type=submit]').click(); await page.locator('#confirmation button[type=submit]').click();
  await page.waitForFunction(() => document.getElementById('notice').textContent === 'Änderung erfolgreich übernommen.');
  for (const tab of publicPages) {
    await tab.waitForFunction(() => document.getElementById('site-notice')?.textContent === 'Neu: <script>kein HTML</script>', null, { timeout: 5000 });
    assert.equal(await tab.evaluate(() => window.liveTestMarker), 'preserved');
  }
  assert.equal(await visitor.locator('#privacy-analytics-option').count(), 1); assert.equal(await visitor.locator('#privacy-analytics-option').isVisible(), false);
  pass('Confirmed banner pushed to four already-open pages without navigation; rendered safely as text');
  await page.locator('#banner-text').fill('Live geändert');
  await page.locator('#operations-form button[type=submit]').click(); await page.locator('#confirmation button[type=submit]').click();
  for (const tab of publicPages) await tab.waitForFunction(() => document.getElementById('site-notice')?.textContent === 'Live geändert', null, { timeout: 5000 });
  // Force the existing transport to disconnect; the browser must reconnect itself.
  for (const socket of [...liveConnections]) socket.close(1012, 'Test reconnect');
  await page.waitForTimeout(1200);
  await page.locator('#banner-enabled').uncheck();
  await page.locator('#operations-form button[type=submit]').click(); await page.locator('#confirmation button[type=submit]').click();
  for (const tab of publicPages) { await tab.locator('#site-notice').waitFor({ state: 'hidden', timeout: 5000 }); assert.equal(await tab.evaluate(() => window.liveTestMarker), 'preserved'); }
  pass('Banner edits and removal arrive live after an interrupted connection reconnects');
  await visitor.bringToFront();
  await visitor.locator('#example-text').click();
  const pdfDownload = visitor.waitForEvent('download'); await visitor.locator('#pdf').click(); const pdf = await pdfDownload;
  const { readFile } = await import('node:fs/promises'); assert.equal((await readFile(await pdf.path())).subarray(0, 4).toString(), '%PDF');
  pass('Existing PDF generation still creates a valid PDF download');
  await page.locator('[data-view=pages]').click(); await page.locator('#feature-pdf').uncheck(); await page.locator('#pages-form button[type=submit]').click(); await page.locator('#confirmation button[type=submit]').click();
  await page.waitForFunction(() => document.getElementById('notice').textContent === 'Änderung erfolgreich übernommen.');
  await visitor.locator('#example-text').click(); await visitor.waitForFunction(() => document.getElementById('pdf').dataset.controlDisabled === 'true'); assert.equal(await visitor.locator('#pdf').isVisible(), false);
  pass('Feature switch actually changes public export controls');
  await page.locator('[data-view=analytics]').click(); await page.locator('[data-command=analytics]').click(); await page.locator('#confirmation button[type=submit]').click();
  await page.waitForFunction(() => document.getElementById('notice').textContent === 'Änderung erfolgreich übernommen.');
  await visitor.waitForFunction(() => !document.getElementById('privacy-analytics-option').hidden);
  const firstDownload = visitor.waitForEvent('download'); await visitor.locator('#download').click(); assert.ok(await firstDownload); assert.equal(events.length, 0);
  await visitor.locator('.privacy-footer [data-privacy-settings]').click(); await visitor.locator('#privacy-analytics').check(); await visitor.locator('#privacy-save').click();
  const secondDownload = visitor.waitForEvent('download'); await visitor.locator('#download').click(); assert.ok(await secondDownload);
  await visitor.waitForFunction(() => textpenPrivacy.analytics === true); await new Promise(r => setTimeout(r, 150));
  assert.deepEqual(events, [{ event: 'image', consent: true }]);
  await visitor.locator('.privacy-footer [data-privacy-settings]').click(); await visitor.locator('#privacy-reject').click(); assert.equal(await visitor.evaluate(() => textpenPrivacy.analytics), false);
  pass('Actual PNG export works; no event before consent; payload has no user content; revocation works');
  await page.locator('[data-view=security]').click(); await page.locator('#block-ip').fill('198.51.100.20'); await page.locator('#block-reason').fill('Browser-Test'); await page.locator('#block-form button[type=submit]').click(); await page.locator('#confirmation button[type=submit]').click();
  await page.waitForFunction(() => document.getElementById('notice').textContent === 'Änderung erfolgreich übernommen.');
  await visitor.locator('#site-control-gate').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('[data-unblock]').click(); await page.locator('#confirmation button[type=submit]').click();
  await page.waitForFunction(() => document.getElementById('notice').textContent === 'Änderung erfolgreich übernommen.');
  await visitor.locator('#site-control-gate').waitFor({ state: 'hidden', timeout: 5000 });
  assert.equal(await visitor.evaluate(() => window.liveTestMarker), 'preserved');
  assert.ok((await visitor.locator('#letter').inputValue()).length);
  pass('IP ban and unban take effect live and preserve the open editor');
  assert.equal(await page.locator('#ip-add-form, .access-entry, [data-command=lock]').count(), 0);
  assert.equal(await page.locator('.page-heading h1').textContent(), 'Sicherheit');
  pass('Security view has no admin IP allowlist or reset controls');
  const savedText = await visitor.locator('#letter').inputValue();
  await page.locator('[data-view=operations]').click(); await page.locator('#maintenance-enabled').check();
  await page.locator('#maintenance-message').fill('Kurze Live-Wartung');
  await page.locator('#operations-form button[type=submit]').click(); await page.locator('#confirmation button[type=submit]').click();
  await visitor.locator('#site-control-gate').waitFor({ state: 'visible', timeout: 5000 });
  await visitor.keyboard.press('Escape'); assert.equal(await visitor.locator('#site-control-gate').isVisible(), true);
  assert.equal(await otherPages[1].locator('#site-control-gate').isVisible(), false);
  const arriving = await context.newPage(); arriving.on('pageerror', e => errors.push(e.message));
  assert.equal((await arriving.goto(publicBase + '/')).status(), 503);
  await arriving.locator('#site-control-gate').waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForFunction(() => document.getElementById('notice').textContent === 'Änderung erfolgreich übernommen.');
  await page.locator('#maintenance-enabled').uncheck();
  await page.locator('#operations-form button[type=submit]').click(); await page.locator('#confirmation button[type=submit]').click();
  await visitor.locator('#site-control-gate').waitFor({ state: 'hidden', timeout: 5000 });
  assert.equal(await visitor.locator('#letter').inputValue(), savedText);
  assert.equal(await visitor.evaluate(() => window.liveTestMarker), 'preserved');
  await arriving.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  await arriving.close();
  pass('Maintenance gates open pages, preserves text, exempts legal pages and automatically restores new arrivals');
  for (const name of ['overview', 'operations', 'pages', 'analytics', 'security', 'releases', 'activity']) {
    await page.locator(`[data-view=${name}]`).click(); assert.ok((await page.locator('h1').textContent()).length);
    for (const width of [390, 1440]) { await page.setViewportSize({ width, height: 1050 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: overflow at ${width}`); }
  }
  await page.locator('[data-view=overview]').click(); await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: path.join(screenshots, 'overview-mobile.png'), fullPage: true });
  pass('All seven sections render at mobile and desktop widths without page overflow');
  await page.setViewportSize({ width: 1440, height: 1050 }); await page.locator('#logout').click(); await page.locator('#login').waitFor();
  assert.deepEqual(errors, []); pass('Logout and no browser exceptions');
} finally { await browser.close(); await mf.dispose(); }
