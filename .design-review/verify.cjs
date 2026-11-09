const { chromium } = require('C:/Users/jeter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('fs'), assert = require('assert/strict'), crypto = require('crypto');
const {PNG}=require('C:/Users/jeter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pngjs');
const root='http://127.0.0.1:4173/';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const log=[];
const pass=s=>{log.push(s);console.log('PASS',s);};
const compare=(a,b,s)=>{assert.deepEqual(a,b,s);pass(s);};
function comparePixels(a,b,s){
 if(hash(a)===hash(b)){pass(s+' (exact)');return;}
 const x=PNG.sync.read(a),y=PNG.sync.read(b);assert.equal(x.width,y.width);assert.equal(x.height,y.height);
 let count=0,max=0;for(let i=0;i<x.data.length;i+=4){let d=0;for(let c=0;c<4;c++)d=Math.max(d,Math.abs(x.data[i+c]-y.data[i+c]));if(d){count++;max=Math.max(max,d);}}
 // Chromium's translucent rounded dialog edge can differ by up to 3/255
 // between independent renders. This does not permit text/layout changes.
 assert.ok(max<=3&&count<=100,`${s}: ${count} differing pixels, maximum channel difference ${max}`);
 pass(s+` (compositor rounding: ${count} pixels, max ${max}/255)`);
}
async function settle(p){await p.bringToFront();await p.evaluate(()=>document.fonts.ready);await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function enter(p,base,accept=false){
 await p.goto(root+base+'/');await p.locator(accept?'#privacy-accept':'#privacy-save').click();
 await p.waitForFunction(()=>!document.getElementById('textpen-app').inert);
 if(base==='textpen-web'){await p.locator('#help-dialog').waitFor({state:'visible'});await p.locator('#close-help').click();}
 await settle(p);
}
async function fixture(p,settings={}){
 await p.evaluate(async settings=>{
  state={text:'Eine kleine Erinnerung\n\nÄÖÜ äöü ß – Schreiben & Ideen.\nNimm dir Zeit für deine Ideen.\n0123456789 !?\n'+('a Handgeschrieben, mit Abstand.\n'.repeat(22)),size:24,thickness:25,ruledRows:1,gridRows:1,spacing:1.7,paper:'plain',ink:'#000000',natural:true,font:'sample',glyphs:{},format:'a4',orientation:'portrait',pageWidth:210,pageHeight:297,margin:20,paperFit:'cover',paperImage:'',paperName:'',letterGap:0,wordGap:0,irregularity:25,multiplier:1,randomSeed:1729,...settings};
  if(state.paper==='custom'){
   const c=document.createElement('canvas');c.width=120;c.height=180;const ctx=c.getContext('2d');ctx.fillStyle='#f9e9c8';ctx.fillRect(0,0,120,180);ctx.fillStyle='#aaaabb';ctx.fillRect(10,10,80,3);
   state.paperImage=c.toDataURL();paperBitmap=await loadPaper(state.paperImage);
  }else paperBitmap=null;
  switchView(false);syncControls();render();
 },settings);await settle(p);
}
async function outputs(p){return p.evaluate(async()=>{
 const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
 const pages=render({exportScale:2});const raster=[];
 for(const c of pages){const b=await new Promise(r=>c.toBlob(r));raster.push({w:c.width,h:c.height,hash:await digest(await b.arrayBuffer())});}
 const [w,h]=pageSize();const pdf=await VectorPdf.make(render({exportScale:2,vector:true}),w,h);
 return {raster,pdf:await digest(await pdf.arrayBuffer()),pageSize:[w,h]};
 });}
async function styles(p,selector){return p.locator(selector).evaluate(el=>[el,...el.querySelectorAll('*')].map(e=>{const s=getComputedStyle(e);return {tag:e.tagName,id:e.id,text:e.textContent,style:Object.fromEntries(Array.from(s).filter(k=>!k.startsWith('--')).map(k=>[k,s.getPropertyValue(k)]))};}));}
(async()=>{
 for(const f of ['impressum.html','datenschutz.html','privacy.css','privacy.js','style.css','textpen.css','boot.css','boot.js','app.js','web.js','handwriting.js','vector-pdf.js','assets/handwriting.ttf','assets/handwriting-vectors.js']) compare(hash(fs.readFileSync('.design-review/baseline/'+f)),hash(fs.readFileSync('textpen-web/'+f)),'unchanged '+f);
 const before=fs.readFileSync('.design-review/baseline/index.html','utf8'),after=fs.readFileSync('textpen-web/index.html','utf8');
 compare(after.slice(after.indexOf('<section id="privacy-closed"'),after.indexOf('<script src="boot.js"')),before.slice(before.indexOf('<section id="privacy-closed"'),before.indexOf('<script src="boot.js"')),'protected main-page markup unchanged');
 compare(after.match(/<footer>[\s\S]*?<\/footer>/)[0],before.match(/<footer>[\s\S]*?<\/footer>/)[0],'footer markup unchanged');
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});
 const errors=[];
 for(const theme of (process.env.CORE_ONLY ? [] : ['light','dark']))for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:1000},colorScheme:theme,reducedMotion:'reduce'});
  const pages=await Promise.all([context.newPage(),context.newPage()]);
  const bases=['.design-review/baseline','textpen-web'];
  for(let i=0;i<2;i++){pages[i].on('pageerror',e=>errors.push(e.message));await pages[i].goto(root+bases[i]+'/');await pages[i].locator('#privacy-dialog').waitFor({state:'visible'});await settle(pages[i]);}
  compare(await styles(pages[0],'#privacy-dialog'),await styles(pages[1],'#privacy-dialog'),`consent computed styles ${theme} ${width}`);
  compare(hash(await pages[0].screenshot()),hash(await pages[1].screenshot()),`consent pixels ${theme} ${width}`);
  for(const p of pages){await p.locator('#privacy-details summary').click();await p.mouse.move(0,0);await p.locator('#privacy-dialog').evaluate(e=>e.scrollTop=0);await settle(p);}
  for(let i=0;i<2;i++){await pages[i].bringToFront();await pages[i].screenshot({path:`.design-review/privacy-expanded-${theme}-${width}-${i}.png`});}
  compare(await styles(pages[0],'#privacy-dialog'),await styles(pages[1],'#privacy-dialog'),`expanded consent computed styles ${theme} ${width}`);
  comparePixels(await pages[0].screenshot(),await pages[1].screenshot(),`expanded consent pixels ${theme} ${width}`);
  for(const p of pages)await p.locator('#privacy-reject').click();
  compare(hash(await pages[0].screenshot()),hash(await pages[1].screenshot()),`rejected-use pixels ${theme} ${width}`);
  for(const f of ['impressum.html','datenschutz.html']){
   for(let i=0;i<2;i++)await pages[i].goto(root+bases[i]+'/'+f);
   compare(hash(await pages[0].screenshot({fullPage:true})),hash(await pages[1].screenshot({fullPage:true})),`${f} pixels ${theme} ${width}`);
  }
  for(let i=0;i<2;i++)await enter(pages[i],bases[i]);
  for(const p of pages){await p.locator('[data-privacy-settings]').click();await p.mouse.move(0,0);await settle(p);}
  compare(await styles(pages[0],'#privacy-dialog'),await styles(pages[1],'#privacy-dialog'),`reopened privacy computed styles ${theme} ${width}`);
  comparePixels(await pages[0].locator('#privacy-dialog').screenshot(),await pages[1].locator('#privacy-dialog').screenshot(),`reopened privacy pixels ${theme} ${width}`);
  for(const p of pages)await p.locator('#privacy-close').click();
  assert.equal(await pages[1].locator('#help-dialog').isVisible(),false);pass(`guide does not reopen after settings ${theme} ${width}`);
  // Compare the legal controls themselves, excluding surrounding page geometry.
  compare(await styles(pages[0],'.privacy-footer'),await styles(pages[1],'.privacy-footer'),`legal footer computed styles ${theme} ${width}`);
  // Different editor heights put the unchanged footer at a different subpixel
  // document offset. Normalize that offset for the isolated raster comparison.
  for(const p of pages){await p.locator('.privacy-footer').evaluate(e=>{const r=e.getBoundingClientRect();Object.assign(e.style,{position:'fixed',top:'100px',left:'0px',width:r.width+'px',background:'var(--bg)',boxShadow:'0 0 0 8px var(--bg)'});});await p.mouse.move(0,500);}
  comparePixels(await pages[0].locator('.privacy-footer').screenshot(),await pages[1].locator('.privacy-footer').screenshot(),`legal footer pixels (aligned) ${theme} ${width}`);
  await context.close();
 }
 if(process.env.PRIVACY_ONLY){await browser.close();fs.writeFileSync('.design-review/privacy-results.json',JSON.stringify({passed:log.length,checks:log},null,2));return;}
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',acceptDownloads:true});
 const pages=await Promise.all([context.newPage(),context.newPage()]);
 for(let i=0;i<2;i++)await enter(pages[i],['.design-review/baseline','textpen-web'][i]);
 const cases=[{},...['lined','wide','grid','college','dots'].map(paper=>({paper})),...['cover','contain','stretch'].map(paperFit=>({paper:'custom',paperFit})),...['a5','a6','letter','custom'].map(format=>({format,orientation:'landscape',pageWidth:173,pageHeight:240,margin:12})),{font:'own',glyphs:{a:[[[[100,220],[150,60],[220,220]]],[[[80,220],[130,90],[200,220]]]]},multiplier:2,ink:'#243f65',letterGap:12,wordGap:20,irregularity:70},{size:64,thickness:100,spacing:2.3,margin:40},{paper:'grid',gridRows:5,size:12,thickness:1,irregularity:0}];
 for(let n=0;n<cases.length;n++){
  for(const p of pages)await fixture(p,cases[n]);
  compare(await outputs(pages[0]),await outputs(pages[1]),`PNG/PDF byte equality case ${n+1} ${JSON.stringify(cases[n]).slice(0,100)}`);
 }
 for(const p of pages)await fixture(p,{text:'Druckprüfung\nÄÖÜ äöü ß\nSchrift und Papier bleiben gleich.',paper:'grid',format:'a5',orientation:'landscape'});
 for(const p of pages){await p.emulateMedia({media:'print'});await p.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));}
 compare(await pages[0].locator('.letter-page').evaluate(e=>({w:e.width,h:e.height,css:getComputedStyle(e).cssText,data:e.toDataURL(),rect:[e.getBoundingClientRect().width,e.getBoundingClientRect().height]})),await pages[1].locator('.letter-page').evaluate(e=>({w:e.width,h:e.height,css:getComputedStyle(e).cssText,data:e.toDataURL(),rect:[e.getBoundingClientRect().width,e.getBoundingClientRect().height]})),'print canvas pixels and physical geometry');
 compare(hash(await pages[0].screenshot({fullPage:true})),hash(await pages[1].screenshot({fullPage:true})),'print stylesheet pixels');
 for(let i=0;i<2;i++)await pages[i].pdf({path:`.design-review/printed-${i}.pdf`,preferCSSPageSize:true,printBackground:true});
 for(const p of pages){await p.emulateMedia({media:'screen'});await p.evaluate(()=>window.dispatchEvent(new Event('afterprint')));}
 // Real download handlers rather than only renderer calls.
 for(const id of ['pdf','download']){
  const downloads=[];
  for(const p of pages){const pending=p.waitForEvent('download');await p.locator('#'+id).click();const d=await pending;downloads.push({name:d.suggestedFilename(),hash:hash(fs.readFileSync(await d.path()))});}
  compare(downloads[0],downloads[1],`actual ${id} download equality`);
 }
 // Drawing through pointer events, undo, clear, saving, variants and file round trip.
 const p=pages[1];await p.locator('#font-tab').click();
 async function stroke(){await p.locator('#drawing').scrollIntoViewIfNeeded();const r=await p.locator('#drawing').boundingBox();await p.mouse.move(r.x+r.width*.2,r.y+r.height*.7);await p.mouse.down();await p.mouse.move(r.x+r.width*.3,r.y+r.height*.2,{steps:4});await p.mouse.move(r.x+r.width*.4,r.y+r.height*.7,{steps:4});await p.mouse.up();}
 await stroke();await p.locator('#undo').click();assert.equal(await p.evaluate(()=>strokes.length),0);
 await stroke();await p.locator('#clear-drawing').click();assert.equal(await p.evaluate(()=>strokes.length),0);
 await stroke();await p.locator('#save-glyph').click();assert.equal(await p.evaluate(()=>state.glyphs.a.length),1);
 const first=await p.evaluate(()=>state.glyphs.a[0][0][0]);assert.ok(Math.abs(first[0]-120)<1&&Math.abs(first[1]-210)<1);pass('drawing coordinates, undo, clear and glyph save');
 await p.locator('.training-options summary').click();await p.locator('#multiplier').selectOption('2');
 await p.locator('#glyph-grid button').first().click();await stroke();await p.locator('#save-glyph').click();assert.equal(await p.evaluate(()=>state.glyphs.a.length),2);
 await p.locator('#glyph-grid button').first().click();await p.locator('#variant-list button').first().click();assert.equal(await p.evaluate(()=>state.glyphs.a.length),1);pass('variant multiplier and removal');
 const fontDownload=p.waitForEvent('download');await p.locator('#export-font').click();const fd=await fontDownload;const fp=await fd.path();const saved=JSON.parse(fs.readFileSync(fp));
 p.on('dialog',d=>d.accept());await p.locator('#font-file').setInputFiles({name:'meine-handschrift.json',mimeType:'application/json',buffer:fs.readFileSync(fp)});
 await p.waitForFunction(()=>document.getElementById('toast').textContent==='Deine Handschrift wurde geladen.');compare(await p.evaluate(()=>state.glyphs),saved.glyphs,'font import/export round trip');
 await p.locator('#use-font').click();assert.equal(await p.locator('#font').inputValue(),'own');pass('own handwriting use and return to editor');
 await p.locator('#paper').selectOption('custom');await p.locator('#paper-file').setInputFiles({name:'test-paper.png',mimeType:'image/png',buffer:fs.readFileSync('.design-review/before-privacy.png')});await p.waitForFunction(()=>state.paperName==='test-paper.png');assert.ok(await p.evaluate(()=>!!paperBitmap));pass('custom paper upload');
 await p.locator('#custom-ink-toggle').click();await p.locator('#ink-hex').fill('#A13D32');await p.locator('#ink-hex').blur();assert.equal(await p.evaluate(()=>state.ink),'#a13d32');pass('custom ink input');
 await p.locator('#help').click();await p.keyboard.press('Escape');assert.equal(await p.locator('#help-dialog').isVisible(),false);await p.locator('#help').click();await p.locator('#help-start').click();assert.equal(await p.locator('#letter').evaluate(e=>e===document.activeElement),true);pass('manual guide, Escape, start action and focus');
 await p.locator('#theme-toggle').click();assert.equal(await p.evaluate(()=>document.documentElement.dataset.theme),'dark');pass('theme toggle');
 compare(await p.evaluate(()=>Object.keys(localStorage)),[],'no optional storage means no new stored keys');
 await p.locator('[data-privacy-settings]').click();await p.locator('#privacy-accept').click();await p.waitForFunction(()=>localStorage.getItem('textpen-v1'));
 await p.locator('#theme-toggle').click();assert.equal(await p.evaluate(()=>localStorage.getItem('textpen-theme')),'light');pass('existing project and theme storage after consent');
 await p.locator('[data-privacy-settings]').click();await p.locator('#privacy-project').uncheck();await p.locator('#privacy-theme').uncheck();await p.locator('#privacy-save').click();compare(await p.evaluate(()=>Object.keys(localStorage)),[],'revocation removes existing storage keys');
 await p.locator('[data-privacy-settings]').click();await p.locator('#privacy-necessary').uncheck();await p.locator('#privacy-save').click();assert.equal(await p.locator('#privacy-closed').isVisible(),true);assert.equal(await p.locator('#help-dialog').isVisible(),false);pass('ending use keeps workspace and guide closed');
 compare(errors,[],'no browser errors');
 await browser.close();fs.writeFileSync('.design-review/results.json',JSON.stringify({passed:log.length,checks:log},null,2));
})().catch(e=>{console.error(e);process.exit(1);});

