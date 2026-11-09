const {chromium}=require('C:/Users/jeter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('fs'),assert=require('assert/strict');
(async()=>{
 for(const f of ['boot.css','boot.js'])assert.deepEqual(fs.readFileSync('textpen-web/'+f),fs.readFileSync('.design-review/baseline/'+f));
 const markup=p=>fs.readFileSync(p,'utf8').match(/<div id="boot"[\s\S]*?(?=\r?\n<div id="textpen-app")/)[0];
 assert.equal(markup('textpen-web/index.html'),markup('.design-review/baseline/index.html'));
 assert.ok(!/#boot|\.boot-/.test(fs.readFileSync('textpen-web/workspace.css','utf8')));
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});
 try {
  const snapshots=[];
  for(const base of ['.design-review/baseline','textpen-web']){
   const p=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'no-preference'});
   await p.goto('http://127.0.0.1:4173/'+base+'/');
   snapshots.push(await p.evaluate(()=>{
    document.getAnimations().forEach(a=>{a.pause();a.currentTime=1500;});
    return [...document.querySelectorAll('#boot, #boot *')].map(e=>{const s=getComputedStyle(e);return Object.fromEntries([...s].filter(k=>!k.startsWith('--')).map(k=>[k,s.getPropertyValue(k)]));});
   }));
   await p.close();
  }
  assert.deepEqual(snapshots[0],snapshots[1]);
  console.log('PASS original animation files, markup and all computed animation styles unchanged');
  const p=await browser.newPage({reducedMotion:'no-preference'});
  await p.addInitScript(()=>{window.startupChecks=[];window.addEventListener('textpen:boot-finished',()=>window.startupChecks.push({event:'boot-finished',time:performance.now(),bootExists:!!document.getElementById('boot'),privacyOpen:document.getElementById('privacy-dialog').open}));});
  await p.goto('http://127.0.0.1:4173/textpen-web/');
  assert.ok(await p.locator('#boot').isVisible());assert.equal(await p.locator('#privacy-dialog').isVisible(),false);assert.equal(await p.locator('#help-dialog').isVisible(),false);
  await p.locator('#privacy-dialog').waitFor({state:'visible'});
  const checks=await p.evaluate(()=>window.startupChecks);assert.equal(checks.length,1);assert.equal(checks[0].bootExists,false);assert.equal(checks[0].privacyOpen,false);assert.ok(checks[0].time>=3900);
  assert.equal(await p.locator('#boot').count(),0);assert.equal(await p.locator('#help-dialog').isVisible(),false);
  await p.locator('#privacy-save').click();await p.locator('#help-dialog').waitFor({state:'visible'});
  console.log('PASS sequence: original animation → privacy choice → guide after successful choice');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
