const {chromium}=require('C:/Users/jeter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 for(const theme of ['light','dark']) {
  const page=await browser.newPage({viewport:{width:1440,height:1000},colorScheme:theme,reducedMotion:'reduce'});
  await page.goto('http://127.0.0.1:4173/textpen-web/');
  await page.locator('#privacy-save').click();
  await page.locator('#help-dialog').waitFor({state:'visible'});
  await page.screenshot({path:`.design-review/after-guide-${theme}.png`});
  await page.locator('#help-start').click();
  await page.locator('#example-text').click();
  await page.evaluate(()=>document.fonts.ready);
  for(const [name,width,height] of [['desktop',1440,1000],['tablet',820,1100],['mobile',390,844],['small',320,740]]) {
   await page.setViewportSize({width,height});
   await page.locator('#write-tab').click();
   await page.evaluate(()=>window.scrollTo(0,0));
   await page.screenshot({path:`.design-review/after-${name}-${theme}.png`,fullPage:true});
   console.log(theme,name,'overflow',await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));
   await page.locator('#font-tab').click();
   await page.screenshot({path:`.design-review/after-font-${name}-${theme}.png`,fullPage:true});
  }
  await page.close();
 }
 await browser.close();
})();
