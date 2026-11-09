'use strict';
const $=id=>document.getElementById(id);
const example='MEIN NÄCHSTER MOVE\n\nIdeen sammeln. Dinge ausprobieren. Einfach anfangen.\n\nHeute auf dem Plan:\n1. Ein bisschen kreativ sein.\n2. Etwas Neues lernen.\n3. Eine Idee wirklich umsetzen.\n\nDein Text muss nicht perfekt sein. Er muss nur deiner sein.\n\nStay original.';
const sets={lower:Array.from('abcdefghijklmnopqrstuvwxyzäöüß'),upper:Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ'),other:Array.from('0123456789.,!?;:–-„“\'()/&@€%+')} ;
const all=[...new Set(Object.values(sets).flat())];
let state={text:'',size:24,thickness:25,ruledRows:1,gridRows:1,spacing:1.7,paper:'plain',ink:'#000000',natural:true,font:'sample',glyphs:{},format:'a4',orientation:'portrait',pageWidth:210,pageHeight:297,margin:20,paperFit:'cover',paperImage:'',paperName:'',letterGap:0,wordGap:0,irregularity:25,multiplier:1,randomSeed:Math.floor(Math.random()*2147483647)};
let storageOK=true;
try{const stored=window.textpenPrivacy?.project ? JSON.parse((localStorage.getItem('textpen-v1')||localStorage.getItem('inkshift-v1'))) : null;if(stored&&typeof stored==='object'){for(const k of ['text','paper','ink','font','format','orientation','paperFit','paperImage','paperName'])if(typeof stored[k]==='string')state[k]=stored[k];for(const k of ['size','thickness','ruledRows','gridRows','spacing','pageWidth','pageHeight','margin','letterGap','wordGap','irregularity','multiplier','randomSeed'])if(Number.isFinite(stored[k]))state[k]=stored[k];if(typeof stored.natural==='boolean'){state.natural=stored.natural;if(!Number.isFinite(stored.irregularity))state.irregularity=stored.natural?25:0;}if(validGlyphs(stored.glyphs))state.glyphs=stored.glyphs;}}catch{storageOK=false;}
if(state.text===example)state.text='';
if(!['plain','lined','wide','grid','college','dots','custom'].includes(state.paper))state.paper='plain';
state.size=Math.min(64,Math.max(12,state.size));state.spacing=Math.min(2.3,Math.max(1.3,state.spacing));
for(const k of ['letterGap','wordGap','irregularity'])state[k]=Math.max(0,Math.min(100,state[k]));state.multiplier=Math.max(1,Math.min(5,Math.round(state.multiplier)));
state.thickness=Math.max(1,Math.min(100,state.thickness));for(const k of ['ruledRows','gridRows'])state[k]=Math.max(1,Math.min(5,Math.round(state[k])));
let paperBitmap=null,paperReady=Promise.resolve();
let currentSet='lower',current='a',strokes=[],activeStroke=null,selectedInk=state.ink,toastTimer,renderFrame=0,persistTimer,printing=false;
function toast(msg){$('toast').textContent=msg;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3500);}
// Keep synchronous storage and serialization out of the slider's input path.
function persist(){clearTimeout(persistTimer);persistTimer=setTimeout(flushPersist,250);}
function flushPersist(){clearTimeout(persistTimer);if(!window.textpenPrivacy?.necessary||!window.textpenPrivacy.project)return;try{localStorage.setItem('textpen-v1',JSON.stringify(state));storageOK=true;}catch{storageOK=false;}}
window.addEventListener('pagehide',flushPersist);
document.addEventListener('visibilitychange',()=>{if(document.hidden)flushPersist();});
function scheduleRender(){if(printing||renderFrame)return;renderFrame=requestAnimationFrame(()=>{renderFrame=0;render();});}
function validGlyphs(g){if(!g||typeof g!=='object'||Array.isArray(g)||Object.keys(g).length>150)return false;return Object.entries(g).every(([c,vs])=>all.includes(c)&&Array.isArray(vs)&&vs.length<=8&&vs.every(v=>Array.isArray(v)&&v.length>0&&v.length<=120&&v.every(s=>Array.isArray(s)&&s.length>0&&s.length<=5000&&s.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&n>=0&&n<=600)))));}
function switchView(own){$('write-view').hidden=own;$('font-view').hidden=!own;for(const [id,on]of [['write-tab',!own],['font-tab',own]]){$(id).classList.toggle('active',on);$(id).setAttribute('aria-selected',String(on));}if(own){drawPad();renderGrid();}else scheduleRender();}
$('write-tab').onclick=()=>switchView(false);$('font-tab').onclick=()=>switchView(true);$('to-font').onclick=()=>switchView(true);
$('help').onclick=()=>$('help-dialog').showModal();
$('help-start').onclick=()=>{$('help-dialog').close();switchView(false);$('letter').focus();};
function useExample(){if(state.text.trim()&&!confirm('Deinen aktuellen Text durch das Beispiel ersetzen?'))return;$('letter').value=`Eine kleine Erinnerung

Du musst nicht alles auf einmal schaffen.
Ein guter Anfang ist schon ein großer Schritt.

Nimm dir Zeit für deine Ideen.`;$('letter').dispatchEvent(new Event('input'));}
$('example-text').onclick=$('preview-example').onclick=useExample;$('close-help').onclick=()=>$('help-dialog').close();
for(const id of ['letter','size','spacing','paper','font','letter-gap','word-gap','irregularity']){$(id).addEventListener('input',()=>{state.text=$('letter').value;state.size=+$('size').value;state.spacing=+$('spacing').value;state.paper=$('paper').value;state.font=$('font').value;state.letterGap=+$('letter-gap').value;state.wordGap=+$('word-gap').value;state.irregularity=+$('irregularity').value;persist();scheduleRender();});}
function syncInkControls(){
 if(!/^#[0-9a-f]{6}$/i.test(state.ink))state.ink='#000000';
 state.ink=state.ink.toLowerCase();
 document.querySelectorAll('[data-ink]').forEach(b=>{const on=b.dataset.ink===state.ink;b.classList.toggle('selected',on);b.setAttribute('aria-pressed',String(on));});
 const custom=!['#000000','#243f65'].includes(state.ink);
 $('custom-ink-toggle').classList.toggle('selected',custom);$('custom-ink-toggle').setAttribute('aria-pressed',String(custom));
 $('custom-ink').value=state.ink;$('ink-hex').value=state.ink.toUpperCase();$('ink-hex').removeAttribute('aria-invalid');$('ink-error').hidden=true;
 ['r','g','b'].forEach((c,i)=>{const n=parseInt(state.ink.slice(1+i*2,3+i*2),16);$('ink-'+c).value=n;$('ink-'+c+'-value').textContent=n;});
 updateValues();
}
function setInk(color){state.ink=color;syncInkControls();persist();scheduleRender();}
document.querySelectorAll('[data-ink]').forEach(b=>b.onclick=()=>{setInk(b.dataset.ink);$('custom-ink-panel').hidden=true;$('custom-ink-toggle').setAttribute('aria-expanded','false');});
$('custom-ink-toggle').onclick=()=>{const open=$('custom-ink-panel').hidden;$('custom-ink-panel').hidden=!open;$('custom-ink-toggle').setAttribute('aria-expanded',String(open));};
$('custom-ink').addEventListener('input',e=>setInk(e.target.value));
$('ink-hex').addEventListener('input',e=>{const hex=e.target.value.trim().replace(/^#/,'');if(/^[0-9a-f]{6}$/i.test(hex))setInk('#'+hex);});
$('ink-hex').addEventListener('change',e=>{const valid=/^#?[0-9a-f]{6}$/i.test(e.target.value.trim());e.target.setAttribute('aria-invalid',String(!valid));$('ink-error').hidden=valid;});
for(const c of ['r','g','b'])$('ink-'+c).addEventListener('input',()=>setInk('#'+['r','g','b'].map(k=>(+$('ink-'+k).value).toString(16).padStart(2,'0')).join('')));


const glyphPaths=new WeakMap();
function glyphPath(strokes){let path=glyphPaths.get(strokes);if(path)return path;path=new Path2D();for(const stroke of strokes){if(!stroke.length)continue;path.moveTo(stroke[0][0],stroke[0][1]);for(let i=1;i<stroke.length;i++)path.lineTo(stroke[i][0],stroke[i][1]);if(stroke.length===1)path.lineTo(stroke[0][0]+.1,stroke[0][1]+.1);}glyphPaths.set(strokes,path);return path;}
function seeded(n){const v=Math.sin(n*127.1+311.7)*43758.5453123;return v-Math.floor(v);}
function glyphFor(c,i){const vs=state.glyphs[c];return state.font==='own'&&vs?.length?vs[Handwriting.variantIndex(vs.length,state.randomSeed,i,c)]:null;}
function bounds(st){let minX=600,maxX=0;for(const stroke of st)for(const p of stroke){minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);}return{minX,maxX};}
function strokePath(ctx,st){ctx.lineCap='round';ctx.lineJoin='round';for(const s of st){if(!s.length)continue;ctx.beginPath();ctx.moveTo(s[0][0],s[0][1]);for(let j=1;j<s.length;j++)ctx.lineTo(s[j][0],s[j][1]);if(s.length===1)ctx.lineTo(s[0][0]+.1,s[0][1]+.1);ctx.stroke();}}
for(const [id,key] of [['thickness','thickness'],['ruled-rows','ruledRows'],['grid-rows','gridRows']]){$(id).value=state[key];$(id).addEventListener('input',()=>{state[key]=+$(id).value;persist();scheduleRender();});}
function updateValues(){
 for(const [id,key] of [['thickness','thickness'],['ruled-rows','ruledRows'],['grid-rows','gridRows']])$(id+'-value').textContent=String(state[key]).replace('.',',')+(id==='thickness'?' %':'');
 $('ruled-rows-control').hidden=!['lined','wide','college'].includes(state.paper);$('grid-rows-control').hidden=state.paper!=='grid';
 $('free-spacing-control').hidden=['lined','wide','college','grid'].includes(state.paper);
 document.querySelectorAll('input[type=range]').forEach(r=>r.style.setProperty('--fill',((+r.value-+r.min)/(+r.max-+r.min)*100)+'%'));
 for(const [id,key]of [['letter-gap','letterGap'],['word-gap','wordGap'],['irregularity','irregularity']])$(id+'-value').textContent=String(state[key]).replace('.',',')+' %';
 $('size-value').textContent=String(state.size).replace('.',',')+' px';$('spacing-value').textContent=String(state.spacing).replace('.',',');$('char-count').textContent=Array.from(state.text).length+' Zeichen';
}
function render({exportScale=0,vector=false}={}){
 if(!exportScale&&$('write-view').hidden)return;
 if(!exportScale&&renderFrame){cancelAnimationFrame(renderFrame);renderFrame=0;}
 updateValues();
 const [mmW,mmH]=pageSize();const W=Math.round(mmW*96/25.4),H=Math.round(mmH*96/25.4);const {margin,left,unit,leading,base,size}=Handwriting.paperLayout(state.paper,W,H,state.size,state.spacing,state.margin,state.paper==='grid'?state.gridRows:state.ruledRows);
 $('format-label').textContent=`${state.format==='custom'?'Eigenes Format':state.format.toUpperCase()} · ${mmW} × ${mmH} mm`;$('margin-value').textContent=String(state.margin).replace('.',',')+' mm';$('custom-paper-controls').hidden=state.paper!=='custom';$('custom-dimensions').hidden=state.format!=='custom';
 let printStyle=$('print-size');if(!printStyle){printStyle=document.createElement('style');printStyle.id='print-size';document.head.append(printStyle);}const printRules=`@media print{@page{size:${mmW}mm ${mmH}mm;margin:0}.letter-page{width:${mmW}mm!important;height:${mmH}mm!important}}`;if(printStyle.textContent!==printRules)printStyle.textContent=printRules; 
 const measuring=document.createElement('canvas').getContext('2d');measuring.font=`${size}px Brief, 'Segoe Print', cursive`;
 // Render the preview at its actual screen resolution so paper lines stay crisp.
 const stage=$('pages'),stageStyle=getComputedStyle(stage);
 const displayWidth=Math.min(560,Math.max(1,stage.clientWidth-parseFloat(stageStyle.paddingLeft)-parseFloat(stageStyle.paddingRight)));
 const scale=exportScale||displayWidth*(window.devicePixelRatio||1)/W;
 const pixelWidth=Math.max(1,Math.floor(W*scale)),pixelHeight=Math.max(1,Math.round(H*scale));
 const existing=exportScale?[]:[...stage.children];
 const cssHeight=pixelHeight/(window.devicePixelRatio||1),pageGap=parseFloat(stageStyle.rowGap)||20;
 const visibleTop=stage.scrollTop-100,visibleBottom=stage.scrollTop+stage.clientHeight+100;
 let pages=[],ctx,x=left,y=base,index=0;
 function newPage(){
  if(vector){ctx=new VectorPdf.Context(W,H);ctx.fillStyle='#ffffff';ctx.fillRect(0,0,W,H);if(state.paper==='custom'&&paperBitmap)paintBackground(ctx,W,H);Handwriting.paintPaper(ctx,state.paper,W,H);ctx.fillStyle=ctx.strokeStyle=state.ink;ctx.font=`${size}px Brief`;pages.push(ctx);x=left;y=base;return;}
  const c=existing[pages.length]||document.createElement('canvas');
  const pageTop=pages.length*(cssHeight+pageGap);
  const paint=exportScale||pageTop+cssHeight>=visibleTop&&pageTop<=visibleBottom;
  const targetWidth=paint?pixelWidth:1,targetHeight=paint?pixelHeight:1;
  if(c.width!==targetWidth)c.width=targetWidth;if(c.height!==targetHeight)c.height=targetHeight;
  c.className='letter-page';c.setAttribute('aria-label','Textseite '+(pages.length+1));
  c.style.aspectRatio=W+' / '+H;
  if(!exportScale){c.style.width=pixelWidth/(window.devicePixelRatio||1)+'px';c.style.height=pixelHeight/(window.devicePixelRatio||1)+'px';}
  if(!paint){ctx=null;pages.push(c);x=left;y=base;return;}
  ctx=c.getContext('2d');ctx.setTransform(pixelWidth/W,0,0,pixelHeight/H,0,0);
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,W,H);
  if(state.paper==='custom'&&paperBitmap)paintBackground(ctx,W,H);
  Handwriting.paintPaper(ctx,state.paper,W,H);
  ctx.fillStyle=state.ink;ctx.strokeStyle=state.ink;ctx.font=`${size}px Brief, 'Segoe Print', cursive`;
  pages.push(c);x=left;y=base;
 }
 const widths=new Map(),glyphMetrics=new Map(),letterImages=new Map();
 // Paint repeated sample letters once per frame, then reuse their small bitmaps.
 // Exports keep native high-resolution text drawing.
 function paintLetter(c,x,y){
  if(exportScale){ctx.fillText(c,x,y);if(state.thickness>1){ctx.lineJoin='round';ctx.lineWidth=(state.thickness-1)/99*size*.13;ctx.strokeText(c,x,y);}return;}
  let stamp=letterImages.get(c);
  if(!stamp){
   const m=measuring.measureText(c),padding=size*.15+2,sx=pixelWidth/W,sy=pixelHeight/H;
   const left=Math.ceil((m.actualBoundingBoxLeft||0)+padding),top=Math.ceil((m.actualBoundingBoxAscent||size)+padding);
   const w=Math.max(1,Math.ceil((left+(m.actualBoundingBoxRight||m.width)+padding)*sx));
   const h=Math.max(1,Math.ceil((top+(m.actualBoundingBoxDescent||0)+padding)*sy));
   const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
   const cc=canvas.getContext('2d');cc.scale(sx,sy);cc.font=measuring.font;cc.fillStyle=cc.strokeStyle=state.ink;
   cc.fillText(c,left,top);if(state.thickness>1){cc.lineJoin='round';cc.lineWidth=(state.thickness-1)/99*size*.13;cc.strokeText(c,left,top);}
   stamp={canvas,left,top,w:w/sx,h:h/sy};letterImages.set(c,stamp);
  }
  ctx.drawImage(stamp.canvas,x-stamp.left,y-stamp.top,stamp.w,stamp.h);
 }
 function metrics(c,i){const g=glyphFor(c,i);if(g){let m=glyphMetrics.get(g);if(!m){const b=bounds(g),scale=size/140;m={g,b,scale,width:Math.max(size*.15,(b.maxX-b.minX)*scale)+size*.1+Handwriting.gap(c,size,state.letterGap,state.wordGap)};glyphMetrics.set(g,m);}return m;}if(!widths.has(c))widths.set(c,{width:measuring.measureText(c).width+Handwriting.gap(c,size,state.letterGap,state.wordGap)});return widths.get(c);}
 function newline(){x=left;y+=leading;if(y>H-margin)newPage();}
 newPage();
 const tokens=state.text.replace(/\r\n?/g,'\n').split(/(\n|[^\S\n]+)/u);
 for(const token of tokens){
  if(!token)continue;if(token==='\n'){newline();continue;}
  const chars=Array.from(token),wordWidth=chars.reduce((n,c,j)=>n+metrics(c,index+j).width,0);
  if(!/^\s+$/u.test(token)&&x>left&&x+wordWidth>W-margin)newline();
  for(const c of chars){
   const m=metrics(c,index);if(x+m.width>W-margin&&x>left)newline();
   if(ctx&&!/\s/u.test(c)){
    const offset=Handwriting.variation(state.irregularity,state.randomSeed,index).y*size;
    if(m.g){ctx.save();ctx.translate(x,y+offset);ctx.scale(m.scale,m.scale);ctx.translate(-m.b.minX,-220);ctx.lineWidth=1+(state.thickness-1)/99*18;ctx.lineCap=ctx.lineJoin='round';if(vector)strokePath(ctx,m.g);else ctx.stroke(glyphPath(m.g));ctx.restore();}
    else paintLetter(c,x,y+offset);
   }
   x+=m.width;index++;
  }
 }
 if(exportScale)return pages;
 for(const c of pages)if(c.parentNode!==stage)stage.append(c);
 for(const c of existing.slice(pages.length)){c.remove();c.width=c.height=1;}
 $('page-count').textContent=pages.length+(pages.length===1?' Seite':' Seiten');
 const chosen=$('export-page').value;if($('export-page').options.length!==pages.length)$('export-page').replaceChildren(...pages.map((_,i)=>new Option('Seite '+(i+1),String(i+1))));$('export-page').value=chosen&&+chosen<=pages.length?chosen:'1';$('export-page-label').hidden=pages.length<2;
 $('preview-empty').hidden=Boolean(state.text.trim());
 $('pdf').disabled=$('download').disabled=$('print').disabled=!state.text.trim();
 $('undo').disabled=$('clear-drawing').disabled=!strokes.length;

 const hint=$('font-hint');
 if(state.font==='own'){
  const missing=[...new Set(Array.from(state.text).filter(c=>!/\s/u.test(c)&&!state.glyphs[c]?.length))];
  const message=missing.length?`${missing.length} fehlende Zeichen nutzen die Beispielschrift: ${missing.slice(0,22).join(' ')}${missing.length>22?' …':''}`:'Alle Zeichen deines Texts sind in deiner Handschrift vorhanden.';
  if(hint.textContent!==message)hint.textContent=message;hint.dataset.font='own';
 }else if(hint.dataset.font!=='sample'){
  const b=document.createElement('button');b.className='inline-button';b.textContent='Optional: eigene Handschrift erstellen ↗';b.onclick=()=>switchView(true);hint.replaceChildren(b);hint.dataset.font='sample';
 }

}
const pad=$('drawing'),pc=pad.getContext('2d');
function drawPad(){pc.clearRect(0,0,600,300);pc.fillStyle='#fffef9';pc.fillRect(0,0,600,300);pc.lineWidth=1;for(const y of [60,135,220,270]){pc.setLineDash(y===135?[6,5]:[]);pc.strokeStyle=y===220?'#a1b389':'#e0e6d6';pc.beginPath();pc.moveTo(0,y);pc.lineTo(600,y);pc.stroke();}pc.setLineDash([]);pc.fillStyle='#d8ddce';pc.font="170px Brief, cursive";pc.textAlign='center';pc.fillText(current,300,220);pc.textAlign='start';pc.strokeStyle='#344f34';pc.lineWidth=5;strokePath(pc,strokes);$('undo').disabled=$('clear-drawing').disabled=!strokes.length;}
function point(e){const r=pad.getBoundingClientRect();return[Math.max(0,Math.min(600,(e.clientX-r.left)*600/r.width)),Math.max(0,Math.min(300,(e.clientY-r.top)*300/r.height))];}
pad.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();pad.setPointerCapture(e.pointerId);activeStroke=[point(e)];strokes.push(activeStroke);drawPad();};
pad.onpointermove=e=>{if(!activeStroke)return;for(const ev of (e.getCoalescedEvents?.().length?e.getCoalescedEvents():[e]))activeStroke.push(point(ev));drawPad();};
pad.onpointerup=pad.onpointercancel=()=>{activeStroke=null;};
$('undo').onclick=()=>{if(!strokes.length){toast('Noch kein Strich vorhanden.');return;}strokes.pop();drawPad();};$('clear-drawing').onclick=()=>{strokes=[];drawPad();toast('Zeichenfeld geleert.');};
function selectGlyph(c){current=c;strokes=[];renderGrid();drawPad();}
function renderGrid(){const count=all.filter(c=>state.glyphs[c]?.length).length;$('glyph-count').textContent=count+' Zeichen';const completed=all.reduce((n,c)=>n+Math.min(state.multiplier,state.glyphs[c]?.length||0),0);const total=all.length*state.multiplier;const next=Handwriting.nextMissing(all,state.glyphs,state.multiplier);$('progress-label').textContent=`${completed} von ${total} Varianten · ${count} von ${all.length} Zeichen`;$('progress-fill').style.width=(completed/total*100)+'%';$('round-status').textContent=next?`Durchgang ${next.round} von ${state.multiplier} · Nächstes offenes Zeichen: ${next.char} (${next.index+1}/${all.length})`:`Fertig! Alle ${state.multiplier} Durchgänge sind vollständig.`;$('continue-training').disabled=!next;$('current-glyph').textContent=current;const vs=state.glyphs[current]||[];$('variants').textContent=vs.length+(vs.length===1?' Variante':' Varianten');$('glyph-grid').replaceChildren(...sets[currentSet].map(c=>{const b=document.createElement('button');b.textContent=c;const badge=document.createElement('small');const n=state.glyphs[c]?.length||0;badge.textContent=n+'/'+state.multiplier;b.append(badge);b.classList.toggle('saved',n>=state.multiplier);b.classList.toggle('partial',n>0&&n<state.multiplier);b.classList.toggle('current',c===current);b.setAttribute('aria-label',c+' – '+n+' von '+state.multiplier+' Varianten');b.onclick=()=>selectGlyph(c);return b;}));$('variant-list').replaceChildren(...vs.map((g,i)=>{const wrap=document.createElement('div');wrap.className='variant';const c=document.createElement('canvas');c.width=110;c.height=80;const cx=c.getContext('2d');cx.scale(.24,.24);const b=bounds(g);cx.translate(25-b.minX,0);cx.lineWidth=5;cx.strokeStyle=state.ink;strokePath(cx,g);const del=document.createElement('button');del.textContent='×';del.title='Variante '+(i+1)+' löschen';del.onclick=()=>{state.glyphs[current].splice(i,1);if(!state.glyphs[current].length)delete state.glyphs[current];persist();renderGrid();render();};wrap.append(c,del);return wrap;}));}
document.querySelectorAll('[data-set]').forEach(b=>b.onclick=()=>{currentSet=b.dataset.set;document.querySelectorAll('[data-set]').forEach(x=>x.classList.toggle('active',x===b));selectGlyph(sets[currentSet][0]);});
$('save-glyph').onclick=()=>{if(!strokes.length){toast('Zeichne zuerst das angezeigte Zeichen.');return;}const vs=state.glyphs[current]||=[];if(vs.length>=state.multiplier){toast('Ziel für dieses Zeichen erreicht. Wähle einen höheren Multiplikator oder lösche eine Variante.');return;}const saved=current;vs.push(strokes.map(s=>s.map(p=>[...p])));persist();const next=Handwriting.nextMissing(all,state.glyphs,state.multiplier);if(next)jumpToGlyph(next.char);else{strokes=[];renderGrid();drawPad();}render();toast(next?'„'+saved+'“ gespeichert.':'Alle Durchgänge abgeschlossen! Deine Handschrift ist bereit.');};
$('use-font').onclick=()=>{if(!Object.values(state.glyphs).some(v=>v.length)){toast('Speichere zuerst mindestens einen Buchstaben.');return;}state.font='own';$('font').value='own';persist();render();switchView(false);};
function download(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();const result=$('export-result');if(result.dataset.url)URL.revokeObjectURL(result.dataset.url);result.dataset.url=u;result.href=u;result.download=name;result.textContent=name+' · nochmals öffnen / speichern';result.hidden=false;toast('Datei erstellt: '+name);}
$('export-font').onclick=()=>download(new Blob([JSON.stringify({version:1,glyphs:state.glyphs,multiplier:state.multiplier},null,2)],{type:'application/json'}),'meine-handschrift.json');
$('import-font').onclick=()=>$('font-file').click();$('font-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>10*1024*1024)throw Error();const data=JSON.parse(await file.text());if(data.version!==1||!validGlyphs(data.glyphs))throw Error();if(Object.keys(state.glyphs).length&&!confirm('Deine gespeicherten Zeichen durch diese Schrift ersetzen?'))return;state.glyphs=data.glyphs;state.font='own';$('font').value='own';if(Number.isInteger(data.multiplier)&&data.multiplier>=1&&data.multiplier<=5)state.multiplier=data.multiplier;$('multiplier').value=state.multiplier;persist();renderGrid();render();toast('Deine Handschrift wurde geladen.');}catch{toast('Diese Datei ist keine gültige TextPen-Schrift.');}finally{e.target.value='';}};
$('print').onclick=async()=>{await paperReady;await document.fonts.ready;switchView(false);window.print();};
window.addEventListener('beforeprint',()=>{
 if(renderFrame){cancelAnimationFrame(renderFrame);renderFrame=0;}
 printing=true;$('pages').replaceChildren(...render({exportScale:2}));
});
window.addEventListener('afterprint',()=>{printing=false;scheduleRender();});
$('download').onclick=()=>runExport($('download'),async pages=>{const n=Math.max(1,Math.min(pages.length,Number($('export-page').value)||1));const blob=await new Promise((resolve,reject)=>pages[n-1].toBlob(b=>b?resolve(b):reject(Error('Bild konnte nicht erstellt werden.')),'image/png'));download(blob,`textpen-text-seite-${n}.png`);});
$('generate').onclick=async()=>{if(!state.text.trim()){toast('Gib zuerst deinen Text ein.');$('letter').focus();return;}const b=$('generate');b.disabled=true;b.textContent='Wird erstellt …';try{await readyForExport();switchView(false);render();toast('Vorschau aktualisiert.');$('pages').scrollIntoView({behavior:'smooth',block:'start'});}catch(e){toast('Generieren fehlgeschlagen: '+e.message);}finally{b.disabled=false;b.textContent='Zur Vorschau ↓';}};
async function readyForExport(){await paperReady;await Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,3000))]);render();}
async function runExport(button,action,{vector=false}={}){const label=button.textContent;button.disabled=true;button.textContent='Wird erstellt …';try{await readyForExport();await document.fonts.load(`${state.size}px Brief`);await action(render({exportScale:2,vector}));}catch(e){toast('Export fehlgeschlagen: '+e.message);}finally{button.disabled=false;button.textContent=label;}}
function syncControls(){
 $('letter').value=state.text;
 const bindings={thickness:'thickness','ruled-rows':'ruledRows','grid-rows':'gridRows',size:'size',spacing:'spacing',paper:'paper',font:'font',format:'format',orientation:'orientation','page-width':'pageWidth','page-height':'pageHeight',margin:'margin','paper-fit':'paperFit','letter-gap':'letterGap','word-gap':'wordGap',irregularity:'irregularity',multiplier:'multiplier'};
 for(const [id,key]of Object.entries(bindings))$(id).value=state[key];
 syncInkControls();
 $('paper-name').textContent=state.paperName||'PNG, JPG oder WebP auswählen.';
}
$('letter').value=state.text;for(const id of ['size','spacing','paper','font'])$(id).value=state[id];for(const [id,key]of [['letter-gap','letterGap'],['word-gap','wordGap'],['irregularity','irregularity']])$(id).value=state[key];syncInkControls();
initTraining();initPaperSettings();renderGrid();drawPad();render();document.fonts.ready.then(()=>{render();drawPad();});

function pageSize(){
 const presets={a4:[210,297],a5:[148,210],a6:[105,148],letter:[215.9,279.4]};
 let [w,h]=presets[state.format]||[state.pageWidth,state.pageHeight];
 w=Math.min(420,Math.max(90,Number(w)||210));h=Math.min(420,Math.max(90,Number(h)||297));
 return state.orientation==='landscape'?[Math.max(w,h),Math.min(w,h)]:[Math.min(w,h),Math.max(w,h)];
}
function paintBackground(ctx,w,h){
 const im=paperBitmap;if(!im)return;
 if(state.paperFit==='stretch'){ctx.drawImage(im,0,0,w,h);return;}
 const scale=state.paperFit==='contain'?Math.min(w/im.width,h/im.height):Math.max(w/im.width,h/im.height);
 ctx.drawImage(im,(w-im.width*scale)/2,(h-im.height*scale)/2,im.width*scale,im.height*scale);
}
function loadPaper(src){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('Bild nicht lesbar'));im.src=src;});}
function initPaperSettings(){
 const bindings={format:'format',orientation:'orientation','page-width':'pageWidth','page-height':'pageHeight',margin:'margin','paper-fit':'paperFit'};
 for(const [id,key]of Object.entries(bindings)){$(id).value=state[key];$(id).addEventListener('input',()=>{if($(id).type==='number'&&!$(id).checkValidity())return;state[key]=['pageWidth','pageHeight','margin','letterGap','wordGap','irregularity','multiplier','randomSeed'].includes(key)?+$(id).value:$(id).value;persist();scheduleRender();});}
 $('paper-name').textContent=state.paperName||'PNG, JPG oder WebP – z. B. ein Foto oder Scan deines Papiers.';
 if(/^data:image\/(jpeg|png|webp);base64,/.test(state.paperImage)){paperReady=loadPaper(state.paperImage).then(im=>{paperBitmap=im;render();}).catch(()=>{state.paperImage='';toast('Bitte dein Papierbild erneut auswählen.');});}
 $('upload-paper').onclick=()=>$('paper-file').click();
 $('paper-file').onchange=e=>{const f=e.target.files[0];if(!f)return;paperReady=(async()=>{let u;try{if(!['image/png','image/jpeg','image/webp'].includes(f.type)||f.size>20*1024*1024)throw Error();u=URL.createObjectURL(f);const im=await loadPaper(u);const scale=Math.min(1,2000/Math.max(im.width,im.height));const c=document.createElement('canvas');c.width=Math.max(1,Math.round(im.width*scale));c.height=Math.max(1,Math.round(im.height*scale));const cx=c.getContext('2d');cx.fillStyle='#fffdf7';cx.fillRect(0,0,c.width,c.height);cx.drawImage(im,0,0,c.width,c.height);const src=c.toDataURL('image/jpeg',.88);const normalized=await loadPaper(src);paperBitmap=normalized;state.paperImage=src;state.paperName=f.name;state.paper='custom';$('paper').value='custom';$('paper-name').textContent=f.name;persist();render();toast('Dein Papier wurde übernommen.');}catch{toast('Bitte ein lesbares PNG-, JPG- oder WebP-Bild bis 20 MB auswählen.');}finally{if(u)URL.revokeObjectURL(u);e.target.value='';}})();};
 $('pdf').onclick=()=>runExport($('pdf'),async pages=>{const [w,h]=pageSize();download(await VectorPdf.make(pages,w,h),'textpen-text.pdf');},{vector:true});
}
function jumpToGlyph(c){currentSet=Object.keys(sets).find(k=>sets[k].includes(c));document.querySelectorAll('[data-set]').forEach(b=>b.classList.toggle('active',b.dataset.set===currentSet));selectGlyph(c);}
function initTraining(){
 $('multiplier').value=state.multiplier;
 $('multiplier').onchange=()=>{state.multiplier=+$('multiplier').value;persist();renderGrid();if(!strokes.length){const next=Handwriting.nextMissing(all,state.glyphs,state.multiplier);if(next)jumpToGlyph(next.char);}};
 $('continue-training').onclick=()=>{const next=Handwriting.nextMissing(all,state.glyphs,state.multiplier);if(next){if(strokes.length&&!confirm('Die ungespeicherte Zeichnung verwerfen und zum nächsten fehlenden Zeichen wechseln?'))return;jumpToGlyph(next.char);}};
 $('reshuffle').onclick=()=>{state.randomSeed=Math.floor(Math.random()*2147483647);persist();render();toast('Zeichenvarianten und Höhenversatz neu gemischt.');};
 const next=Handwriting.nextMissing(all,state.glyphs,state.multiplier);if(next)jumpToGlyph(next.char);
}

// Repaint for viewport resizing, browser zoom, and returning from the font editor.
new ResizeObserver(()=>{if(!$('write-view').hidden)scheduleRender();}).observe($('pages'));
window.addEventListener('resize',scheduleRender);

// Offscreen sheets retain their layout; paint them as they enter the preview.
$('pages').addEventListener('scroll',scheduleRender,{passive:true});
