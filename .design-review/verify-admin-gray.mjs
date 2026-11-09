import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {runtime,adminBase,testIP,testPassword,code} from '../control/test/helpers.mjs';
const css=await readFile('control/ui/control.css','utf8');
const baseline=await readFile('.design-review/baseline/control-before-gray.css','utf8');
const light=s=>s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/:root\[data-theme=dark\][^{]*\{[^}]*\}/g,'').replace(/\s+/g,'');
assert.equal(light(css),light(baseline));
console.log('PASS all non-dark CSS unchanged');
const {mf}=await runtime();
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const context=await browser.newContext({colorScheme:'dark',viewport:{width:1440,height:1000}});
 await context.route('**/*',async route=>{
  const req=route.request();
  if(!req.url().startsWith('https://textpen.test')) return route.abort();
  const res=await mf.dispatchFetch(req.url(),{method:req.method(),headers:{...req.headers(),'CF-Connecting-IP':testIP},body:req.postDataBuffer()||undefined,redirect:'manual'});
  await route.fulfill({status:res.status,headers:Object.fromEntries(res.headers),body:Buffer.from(await res.arrayBuffer())});
 });
 const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 const bg=s=>page.locator(s).first().evaluate(e=>getComputedStyle(e).backgroundColor);
 await page.goto(adminBase);await page.locator('#login').waitFor();
 assert.equal(await bg('body'),'rgb(24, 24, 24)');assert.equal(await bg('.login-card'),'rgb(34, 34, 34)');assert.equal(await bg('.primary'),'rgb(155, 212, 169)');
 await page.screenshot({path:'.design-review/admin-gray-login.png'});
 await page.locator('#password').fill(testPassword);await page.locator('#code').fill(await code(-1));await page.locator('button[type=submit]').click();await page.locator('.page-heading h1').waitFor();
 assert.equal(await bg('.sidebar'),'rgb(34, 34, 34)');assert.equal(await bg('.stat-card.accent'),'rgb(44, 44, 44)');
 for(const width of [1440,390]) {
  await page.setViewportSize({width,height:1000});
  for(const view of ['overview','operations','pages','analytics','security','releases','activity']) {
   await page.locator(`[data-view=${view}]`).click();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),view);
   assert.equal(await bg('body'),'rgb(24, 24, 24)');
  }
  await page.locator('[data-view=overview]').click();
  await page.screenshot({path:`.design-review/admin-gray-${width}.png`,fullPage:true});
 }
 await page.locator('#theme-toggle').click();assert.equal(await bg('body'),'rgb(239, 232, 218)');
 assert.deepEqual(errors,[]);console.log('PASS dark login, dashboard, all seven sections at desktop/mobile, light toggle, no browser errors');
} finally {await browser.close();await mf.dispose();}
