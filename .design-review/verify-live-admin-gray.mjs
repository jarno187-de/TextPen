import {readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const {ADMIN_PATH}=JSON.parse(await readFile(path.join(process.env.LOCALAPPDATA,'TextPenControl','secrets.json'),'utf8'));
const base='https://textpen.de/'+ADMIN_PATH+'/';
const res=await fetch(base+'control.css');
assert.equal(res.status,200);
assert.equal(await res.text(),await readFile('control/ui/control.css','utf8'));
console.log('PASS live admin CSS matches updated source');
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({colorScheme:'dark'});
 await page.goto(base);await page.locator('#login').waitFor();
 assert.equal(await page.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(24, 24, 24)');
 assert.equal(await page.locator('.primary').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(155, 212, 169)');
 await page.locator('#theme-toggle').click();
 assert.equal(await page.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(239, 232, 218)');
 console.log('PASS live admin login dark palette and light toggle');
} finally {await browser.close();}
