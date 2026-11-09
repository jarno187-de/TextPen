const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/glyph-cleanup.js','utf8');
const clean=vm.runInNewContext(source+'; GlyphCleanup.clean');
const E=[[[360,105],[300,110],[300,220],[325,220]],[[300,165],[365,162]]];
const a=[[[330,160],[300,160],[280,180],[280,205],[310,208],[325,190],[325,170],[335,210],[350,220]]];
test('removes three isolated marks like the E screenshot without changing the E',()=>{
 const result=clean('E',[...E,[[75,55]],[[150,235],[149,248]],[[500,275],[520,257]]]);
 assert.deepEqual(Array.from(result),E);assert.equal(result[0],E[0]);
});
test('removes both dots like the a screenshot, including the nearby right dot',()=>{
 assert.deepEqual(Array.from(clean('a',[...a,[[378,213]],[[525,285]]])),a);
});
for(const char of ['i','j','ä','ö','ü','Ä','é','ñ'])test('preserves dots/accents for '+char,()=>{
 const glyph=[[[300,145],[300,220],[325,220]],[[295,110]],[[317,110],[325,103]]];
 assert.equal(clean(char,glyph),glyph);
});
test('preserves cedilla below the body',()=>{
 const glyph=[...a,[[310,242],[306,252]]];assert.equal(clean('ç',glyph),glyph);
});
test('preserves touching and nearby short letter strokes',()=>{
 const glyph=[...E,[[325,220],[334,225]],[[342,225],[350,230]]];assert.equal(clean('E',glyph),glyph);
});
for(const char of ['.',':',';','!','?','%','÷','😀'])test('does not clean punctuation or complex symbols '+char,()=>{
 const glyph=[...E,[[500,275]]];assert.equal(clean(char,glyph),glyph);
});
test('single strokes and tiny drawings stay untouched',()=>{
 assert.equal(clean('a',a),a);const dots=[[[100,100]],[[500,250]]];assert.equal(clean('i',dots),dots);
});
test('cleanup is immutable and idempotent',()=>{
 const glyph=[...E,[[500,275]]],snapshot=JSON.stringify(glyph),result=clean('E',glyph);
 assert.equal(JSON.stringify(glyph),snapshot);assert.equal(clean('E',result),result);
});

for(const char of ['a','E','ẞ','ø','ł','æ','œ','ı','α','Ж','あ','7'])test('cleans detached noise for '+char,()=>{
 const glyph=[...E,[[500,275],[530,270]]];
 assert.deepEqual(Array.from(clean(char,glyph)),E);
});
for(const char of ['a','E','1','0'])test('does not protect accidental dots above '+char,()=>{
 assert.deepEqual(Array.from(clean(char,[...E,[[320,65]]])),E);
});
test('removes noise inside the bounding rectangle of an open letter',()=>{
 const C=[[[360,110],[280,110],[270,165],[280,220],[360,220]]];
 assert.deepEqual(Array.from(clean('C',[...C,[[325,165]],[[330,185],[345,185]]])),C);
});
test('removes scribbled specks regardless of their accumulated path length',()=>{
 const scribble=Array.from({length:200},(_,i)=>[470+i%5,220+i%7]);
 assert.deepEqual(Array.from(clean('E',[...E,scribble])),E);
});
test('removes a stray dot just outside the ink without deleting a crossing bar',()=>{
 const t=[[[300,100],[300,220]],[[280,155],[320,155]]];
 assert.deepEqual(Array.from(clean('t',[...t,[[310,195]]])),t);
});
test('protects a bar crossing between sparse points',()=>{
 const glyph=[[[300,100],[300,220]],[[280,155],[320,155]]];
 assert.equal(clean('t',glyph),glyph);
});
test('protects umlauts and removes a distant speck above the accent zone',()=>{
 const glyph=[...a,[[295,130]],[[320,130]]];
 assert.deepEqual(Array.from(clean('ä',[...glyph,[[310,20]]])),glyph);
});
test('cleans small handwriting at the same relative scale',()=>{
 const glyph=E.map(s=>s.map(([x,y])=>[x*.3,y*.3]));
 assert.deepEqual(Array.from(clean('E',[...glyph,[[150,80]]])),glyph);
});

for(const [char,glyph] of Object.entries({
 t:[[[300,100],[300,220]],[[318,150],[350,150]]],
 f:[[[330,100],[305,105],[300,220]],[[270,150],[290,150]]],
 E:[[[360,105],[300,110],[300,220],[360,220]],[[315,165],[350,163]]],
 A:[[[270,220],[305,100],[340,220]],[[288,170],[300,170]]]
}))test('keeps a letter part drawn with a gap for '+char,()=>{
 assert.equal(clean(char,glyph),glyph);
 assert.deepEqual(Array.from(clean(char,[...glyph,[[520,40]]])),glyph);
});

function appHarness(glyphs={},draft=[]){
 const app=fs.readFileSync(__dirname+'/app.js','utf8'),buttons={},messages=[],downloads=[];
 const ctx=vm.createContext({GlyphCleanup:{clean},Blob,state:{glyphs,multiplier:3,font:'own'},strokes:draft,current:'E',currentSet:'upper',activeStroke:null,
  sets:{upper:['E']},Handwriting:{nextMissing:()=>null},
  $:id=>buttons[id]??={},toast:msg=>messages.push(msg),persist:()=>{},drawPad:()=>{},renderGrid:()=>{},render:()=>{},
  download:(blob,name)=>downloads.push({blob,name}),syncExtraGlyphs:()=>{},confirm:()=>true});
 vm.runInContext(fs.readFileSync(__dirname+'/characters.js','utf8'),ctx);
 vm.runInContext(app.slice(app.indexOf('function validGlyphs('),app.indexOf('function switchView(')),ctx);
 vm.runInContext(app.slice(app.indexOf('function cleanAllGlyphs('),app.indexOf('async function restoreSavedProject(')),ctx);
 vm.runInContext(app.slice(app.indexOf("$('save-glyph').onclick="),app.indexOf("$('use-font').onclick")),ctx);
 vm.runInContext(app.slice(app.indexOf("$('export-font').onclick="),app.indexOf("$('print').onclick=")),ctx);
 return {ctx,buttons,messages,downloads};
}
test('saving a letter always removes stray marks',()=>{
 const h=appHarness({},[...E,[[320,65]],[[500,275]]]);h.buttons['save-glyph'].onclick();
 assert.equal(JSON.stringify(h.ctx.state.glyphs.E[0]),JSON.stringify(E));
});
test('loading a font file cleans every character and variant',async()=>{
 const dirty=[...E,[[500,275]]],h=appHarness();
 await h.buttons['font-file'].onchange({target:{files:[{size:100,text:async()=>JSON.stringify({version:1,glyphs:{E:[dirty,dirty],ø:[dirty]},multiplier:12})}],value:'font.json'}});
 for(const variants of Object.values(h.ctx.state.glyphs))for(const glyph of variants)assert.equal(JSON.stringify(glyph),JSON.stringify(E));
 assert.equal(h.ctx.state.multiplier,12);
 h.buttons['export-font'].onclick();
 const exported=JSON.parse(await h.downloads[0].blob.text());
 assert.deepEqual(exported.glyphs.E[0],E);assert.equal(exported.cleanupEnabled,undefined);
});
test('project restoration cleans stored glyphs and keeps up to 15 variants',()=>{
 const app=fs.readFileSync(__dirname+'/app.js','utf8'),h=appHarness();
 h.ctx.example='';h.ctx.stored={glyphs:{E:[[...E,[[500,275]]]]},multiplier:15};
 vm.runInContext(app.slice(app.indexOf('function restoreProject('),app.indexOf('async function restoreSavedProject(')),h.ctx);
 vm.runInContext('restoreProject(stored)',h.ctx);
 assert.equal(JSON.stringify(h.ctx.state.glyphs.E[0]),JSON.stringify(E));assert.equal(h.ctx.state.multiplier,15);
});
test('cleanup is loaded before the app and has no manual buttons',()=>{
 const privacy=fs.readFileSync(__dirname+'/privacy.js','utf8');
 assert.ok(privacy.indexOf("'glyph-cleanup.js'")<privacy.indexOf("'app.js'"));
 const html=fs.readFileSync(__dirname+'/index.html','utf8');
 for(const id of ['clean-drawing','clean-font','clean-export'])assert.ok(!html.includes('id="'+id+'"'));
 assert.ok(!html.includes('data-undo-cleanup'));
});
