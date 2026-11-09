import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { runtime, code, testPassword, testIP, adminBase, publicBase } from './helpers.mjs';

const { mf } = await runtime();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext(); context.setDefaultTimeout(10000);
  const errors = [];
  await context.route('**/*', async route => {
    const req = route.request();
    if (!req.url().startsWith(publicBase)) return route.abort();
    const response = await mf.dispatchFetch(req.url(), { method: req.method(), headers: { ...req.headers(), 'CF-Connecting-IP': req.url().startsWith(adminBase) ? testIP : '198.51.100.20' }, body: req.postDataBuffer() || undefined, redirect: 'manual' });
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  });
  await context.routeWebSocket('**/__site/live?*', async route => {
    const response = await mf.dispatchFetch(route.url().replace('wss:', 'https:'), { headers: { Upgrade: 'websocket', Origin: publicBase, 'CF-Connecting-IP': '198.51.100.20' } });
    assert.equal(response.status, 101); const socket = response.webSocket;
    socket.addEventListener('message', event => route.send(event.data));
    socket.addEventListener('close', () => route.close().catch(() => {}));
    route.onMessage(message => socket.send(message));
    route.onClose(() => { try { socket.close(1000); } catch { /* closed */ } }); socket.accept();
  });
  const admin = await context.newPage();
  await admin.goto(adminBase);
  await admin.locator('#password').fill(testPassword); await admin.locator('#code').fill(await code(-1)); await admin.locator('button[type=submit]').click();
  await admin.locator('[data-view=operations]').click();
  const save = async () => {
    await admin.locator('#operations-form button[type=submit]').click();
    const saved = admin.waitForResponse(response => response.url().endsWith('/api/action'));
    await admin.locator('#confirmation button[type=submit]').click();
    assert.equal((await saved).status(), 200);
    await admin.waitForFunction(() => document.getElementById('notice').textContent === 'Änderung erfolgreich übernommen.');
  };
  const tabs = [];
  for (const path of ['/', '/impressum.html', '/datenschutz.html']) {
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.goto(publicBase + path);
    await page.evaluate(() => { window.maintenanceMarker = true; }); tabs.push(page);
  }
  await admin.locator('#maintenance-enabled').check(); await save();
  await tabs[0].locator('#site-control-gate').waitFor({ state: 'visible' });
  assert.equal(await tabs[0].locator('#site-control-gate nav').isVisible(), true);
  for (const page of tabs.slice(1)) assert.equal(await page.locator('#site-control-gate').isVisible(), false);
  await admin.locator('#maintenance-legal').check(); await save();
  assert.equal(await admin.locator('#maintenance-legal').isChecked(), true);
  for (const path of ['/impressum.html', '/datenschutz.html', '/impressum/', '/datenschutz']) {
    const response = await mf.dispatchFetch(publicBase + path, { headers: { 'CF-Connecting-IP': '198.51.100.20' } });
    assert.equal(response.status, 503);
    assert.match(await response.text(), /<nav data-control-legal-links hidden>/);
  }
  console.log('PASS Checkbox saves and blocks information pages, including URL aliases');
  for (const page of tabs) {
    await page.locator('#site-control-gate').waitFor({ state: 'visible' });
    await page.locator('#site-control-gate nav').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.maintenanceMarker), true);
  }
  const arrival = await context.newPage(); arrival.on('pageerror', error => errors.push(error.message));
  assert.equal((await arrival.goto(publicBase + '/')).status(), 503);
  await arrival.locator('#site-control-gate').waitFor({ state: 'visible' });
  assert.equal(await arrival.locator('a:visible').count(), 0);
  console.log('PASS Checked option hides information links on existing pages and new maintenance arrivals');
  await admin.locator('#maintenance-legal').uncheck(); await save();
  for (const page of tabs.slice(1)) await page.locator('#site-control-gate').waitFor({ state: 'hidden' });
  await tabs[0].locator('#site-control-gate nav').waitFor({ state: 'visible' });
  await arrival.locator('#site-control-gate nav').waitFor({ state: 'visible' });
  for (const path of ['/impressum.html', '/datenschutz.html']) {
    const response = await mf.dispatchFetch(publicBase + path, { headers: { 'CF-Connecting-IP': '198.51.100.20' } }); assert.equal(response.status, 200);
  }
  assert.equal(await tabs[0].locator('#site-control-gate').isVisible(), true);
  await admin.locator('#maintenance-enabled').uncheck(); await save();
  await tabs[0].locator('#site-control-gate').waitFor({ state: 'hidden' });
  assert.equal(await tabs[0].evaluate(() => window.maintenanceMarker), true);
  assert.deepEqual(errors, []);
  console.log('PASS Unchecking restores links and information pages live; ending maintenance preserves original page');
} finally { await browser.close(); await mf.dispose(); }
