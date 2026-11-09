const {chromium} = require('C:/Users/jeter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async () => {
  const b = await chromium.launch({channel:'chrome',headless:true});
  const p = await b.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await p.goto('http://127.0.0.1:4173/.design-review/baseline/');
  await p.locator('#privacy-dialog').waitFor({state:'visible'});
  await p.screenshot({path:'.design-review/before-privacy.png'});
  await p.locator('#privacy-save').click();
  await p.locator('#textpen-app').waitFor({state:'visible'});
  await p.locator('#example-text').click();
  await p.screenshot({path:'.design-review/before-desktop.png'});
  await b.close();
})();

