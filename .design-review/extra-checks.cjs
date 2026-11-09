const {chromium}=require('C:/Users/jeter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('assert/strict'),fs=require('fs'),crypto=require('crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});
 const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});const outputs=[];let current;
 for(const base of ['.design-review/baseline','textpen-web']){
  const page=await ctx.newPage();await page.goto('http://127.0.0.1:4173/'+base+'/');await page.locator('#privacy-save').click();
  await page.waitForFunction(()=>!document.getElementById('textpen-app').inert);
  if(base==='textpen-web'){await page.locator('#help-dialog').waitFor({state:'visible'});await page.locator('#close-help').click();current=page;}
  await page.evaluate(()=>document.fonts.ready);
  await page.locator('#letter').fill(('Eine weitere Zeile für die Seitenauswahl.\n').repeat(60));
  await page.evaluate(()=>{state.randomSeed=99;render();});
  await page.locator('#export-page').selectOption('2');
  const waiting=page.waitForEvent('download');await page.locator('#download').click();const d=await waiting;
  outputs.push({name:d.suggestedFilename(),bytes:hash(fs.readFileSync(await d.path()))});
 }
 assert.deepEqual(outputs[0],outputs[1]);assert.equal(outputs[1].name,'textpen-text-seite-2.png');console.log('PASS actual second-page PNG download byte equality');
 await current.evaluate(()=>{window.print=()=>{window.printButtonCalled=true;};});await current.locator('#print').click();await current.waitForFunction(()=>window.printButtonCalled);console.log('PASS print button invokes browser printing');
 await current.locator('[data-privacy-settings]').click();await current.locator('#privacy-accept').click();
 await current.locator('#letter').fill('Wiederherstellung nach Neuladen.');await current.waitForFunction(()=>JSON.parse(localStorage.getItem('textpen-v1'))?.text==='Wiederherstellung nach Neuladen.');
 await current.reload();await current.locator('#privacy-accept').click();await current.locator('#help-dialog').waitFor({state:'visible'});await current.keyboard.press('Escape');assert.equal(await current.locator('#letter').inputValue(),'Wiederherstellung nach Neuladen.');console.log('PASS existing saved project restoration; guide once after renewed consent');
 for(const width of [1440,820,390,320])for(const theme of ['light','dark']){
  await current.setViewportSize({width,height:900});await current.evaluate(theme=>applyTheme(theme),theme);
  for(const tab of ['#write-tab','#font-tab']){
   await current.locator(tab).click();assert.equal(await current.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  await current.locator('#help').click();
  await current.locator('#help-dialog details').evaluateAll(elements=>elements.forEach(e=>e.open=true));
  assert.equal(await current.locator('#help-dialog').evaluate(e=>e.scrollWidth>e.clientWidth),false);
  await current.locator('#help-dialog').screenshot({path:`.design-review/guide-expanded-${width}-${theme}.png`});
  await current.keyboard.press('Escape');
  console.log('PASS both workspaces and expanded guide without overflow',width,theme);
 }
 await current.setViewportSize({width:390,height:844});await current.locator('#write-tab').click();await current.locator('#letter').fill('');
 await current.locator('#preview-empty').screenshot({path:'.design-review/empty-mobile-dark.png'});
 assert.ok(await current.locator('#pdf').isDisabled());await current.locator('#preview-example').click();assert.ok((await current.locator('#letter').inputValue()).length>0);console.log('PASS empty preview, disabled export, preview example');
 await current.locator('#help').focus();await current.keyboard.press('Enter');assert.ok(await current.locator('#help-dialog').isVisible());await current.keyboard.press('Escape');assert.equal(await current.locator('#help').evaluate(e=>e===document.activeElement),true);console.log('PASS keyboard help and return focus');
 const range=current.locator('#size');await range.focus();const value=Number(await range.inputValue());await current.keyboard.press('ArrowRight');assert.equal(Number(await range.inputValue()),value+.25);assert.notEqual(await range.evaluate(e=>getComputedStyle(e).outlineStyle),'none');console.log('PASS keyboard slider step and visible focus');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});

