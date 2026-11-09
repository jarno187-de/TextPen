const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({channel:'chrome', headless:true});
 for (const width of [1440,390]) {
  const page = await browser.newPage({viewport:{width,height:1000}, colorScheme:'light', reducedMotion:'reduce'});
  let baseline = true;
  await page.route('**/forest.css', route => baseline ? route.fulfill({path:'.design-review/baseline/forest-before-gray.css',contentType:'text/css'}) : route.continue());
  await page.route('**/workspace.css', route => baseline ? route.fulfill({path:'.design-review/baseline/workspace-before-gray.css',contentType:'text/css'}) : route.continue());
  const captures = [];
  for (const old of [true,false]) {
   baseline = old;
   await page.goto('http://127.0.0.1:4173/textpen-web/');
   await page.evaluate(() => document.fonts.ready);
   await page.waitForFunction(()=>document.documentElement.dataset.ready==='true'); await page.evaluate(()=>document.querySelector('#privacy-dialog').showModal());
   const privacy = await page.screenshot({animations:'disabled'});
   await page.locator('#privacy-save').click();
   if (await page.locator('#help-dialog').isVisible()) await page.locator('#help-start').click();
   await page.locator('#letter').fill('');
   await page.locator('#letter').blur();
   const editor = await page.screenshot({animations:'disabled'});
   captures.push({privacy,editor});
  }
  assert(captures[0].privacy.equals(captures[1].privacy),`Light privacy changed at ${width}`);
  assert(captures[0].editor.equals(captures[1].editor),`Light editor changed at ${width}`);
  await page.locator('#theme-toggle').click();
  const colors = await page.evaluate(() => Object.fromEntries(['body','#textpen-app','.editor','.preview-area','#example-text'].map(s=>{const c=getComputedStyle(document.querySelector(s));return [s,{background:c.backgroundColor,color:c.color}]})));
  assert.equal(colors['#textpen-app'].background,'rgb(24, 24, 24)');
  assert.equal(colors['.editor'].background,'rgb(34, 34, 34)');
  assert.equal(colors['.preview-area'].background,'rgb(44, 44, 44)');
  assert.equal(colors['#example-text'].color,'rgb(155, 212, 169)');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`.design-review/gray-dark-${width}.png`,animations:'disabled'});
  await page.locator('#font-tab').click();
  await page.screenshot({path:`.design-review/gray-dark-font-${width}.png`,animations:'disabled'});
  await page.evaluate(()=>document.querySelector('#privacy-dialog').showModal());
  assert.equal(await page.locator('#privacy-dialog').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(34, 34, 34)');
  assert.equal(await page.locator('#privacy-dialog').evaluate(e=>getComputedStyle(e,'::backdrop').backgroundColor),'rgba(0, 0, 0, 0.74)');
  console.log(JSON.stringify({width,light:'pixel-identical',dark:colors,privacy:'neutral',overflow:false}));
  await page.goto('http://127.0.0.1:4173/textpen-web/anleitung.html');
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  assert.equal(await page.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(24, 24, 24)');
  await page.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});



