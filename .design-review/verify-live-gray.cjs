const {chromium}=require('playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 for(const path of ['/', '/anleitung.html','/datenschutz.html','/impressum.html','/forest.css','/workspace.css']) {
  const res=await fetch('https://textpen.de'+path);
  assert.equal(res.status,200,path);
  const text=await res.text();
  if(path.endsWith('.css')) assert.equal(text,fs.readFileSync('textpen-web'+path,'utf8'));
  console.log('LIVE 200 '+path+(path.endsWith('.css')?' — matches local source':''));
 }
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const page=await browser.newPage({colorScheme:'dark',viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://textpen.de/');
  await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
  assert.equal(await page.locator('#textpen-app').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(24, 24, 24)');
  assert.equal(await page.locator('#example-text').evaluate(e=>getComputedStyle(e).color),'rgb(155, 212, 169)');
  await page.locator('#theme-toggle').click();
  assert.equal(await page.locator('#textpen-app').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(239, 232, 218)');
  await page.locator('#theme-toggle').click();
  await page.locator('#example-text').click();
  assert((await page.locator('#letter').inputValue()).length>0);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:'.design-review/live-gray-dark.png'});
  console.log('LIVE browser: dark gray, green accent, original light theme, example input, no JavaScript errors — PASS');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
