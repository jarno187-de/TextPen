'use strict';
// Short guided tour. It has no close button and ignores Escape, so it is always finished once.
(() => {
 const KEY='textpen-onboarding';
 const steps=[
  {view:false,target:'.editor .panel-heading, #letter',title:'Text eingeben',text:'Tippe oder füge hier deinen Text ein. „Beispiel ausprobieren“ zeigt dir sofort ein Ergebnis.'},
  {view:false,target:'.settings',title:'Schrift gestalten',text:'Wähle Handschrift, Größe, Abstände, Papier und Farbe.'},
  {view:false,target:'.preview-area',title:'Dein Ergebnis',text:'Hier entsteht deine Seite. Lade sie als PDF oder Bild herunter oder drucke sie.'},
  {view:true,target:'.draw-section',title:'Deine Schrift',text:'Zeichne ein Zeichen und tippe „Speichern & weiter“. Versehentliche Punkte und Striche daneben entfernt TextPen automatisch.'},
  {view:true,target:'.training-options',open:true,title:'Varianten',text:'Mit dem Regler zeichnest du jedes Zeichen bis zu 15-mal. Das macht deine Schrift natürlicher.'},
  {view:false,target:'#settings-button',title:'Einstellungen',text:'Oben rechts öffnest du die Einstellungen. Unter „Darstellung“ wählst du Hell, Dunkel oder System.'},
  {view:false,target:'.privacy-footer',title:'Datenschutz',text:'Ganz unten findest du den Datenschutz und die Datenschutzeinstellungen, z. B. um deine Arbeit auf dem Gerät zu speichern.'}
 ];
 const app=document.getElementById('textpen-app');
 const layer=document.createElement('div');layer.className='onboarding';layer.hidden=true;
 layer.innerHTML='<div class="onboarding-spot"></div><section class="onboarding-card" role="dialog" aria-modal="true" aria-labelledby="onboarding-title" aria-describedby="onboarding-text"><span class="onboarding-count"></span><h2 id="onboarding-title"></h2><p id="onboarding-text"></p><div class="onboarding-actions"><button type="button" class="quiet" data-back>← Zurück</button><button type="button" class="primary" data-next></button></div></section>';
 document.body.append(layer);
 const spot=layer.querySelector('.onboarding-spot'),next=layer.querySelector('[data-next]'),back=layer.querySelector('[data-back]');
 let index=0,targets=[];
 const rect=()=>{const rs=targets.map(t=>t.getBoundingClientRect());return {left:Math.min(...rs.map(r=>r.left)),top:Math.min(...rs.map(r=>r.top)),right:Math.max(...rs.map(r=>r.right)),bottom:Math.max(...rs.map(r=>r.bottom))};};
 function place(){
  if(!targets.length)return;const r=rect(),pad=8;
  Object.assign(spot.style,{left:r.left-pad+'px',top:r.top-pad+'px',width:r.right-r.left+pad*2+'px',height:r.bottom-r.top+pad*2+'px'});
 }
 function show(i){
  index=i;const step=steps[i];
  switchView(step.view);
  targets=[...document.querySelectorAll(step.target)];
  if(step.open)targets.forEach(t=>{t.open=true;});
  layer.querySelector('.onboarding-count').textContent=(i+1)+' / '+steps.length;
  layer.querySelector('h2').textContent=step.title;layer.querySelector('p').textContent=step.text;
  back.hidden=i===0;next.textContent=i===steps.length-1?'Los geht’s':'Weiter →';
  const r=rect();
  window.scrollTo({top:Math.max(0,r.top+window.scrollY-Math.min(96,window.innerHeight*.12)),behavior:'instant'});
  place();next.focus();
 }
 function start(){app.inert=true;layer.hidden=false;show(0);}
 function finish(){
  try{localStorage.setItem(KEY,'1');}catch{}
  if(location.hash==='#einfuehrung')history.replaceState(null,'',location.pathname+location.search);
  layer.hidden=true;targets=[];app.inert=false;switchView(false);window.scrollTo({top:0,behavior:'instant'});
 }
 next.onclick=()=>index<steps.length-1?show(index+1):finish();
 back.onclick=()=>show(index-1);
 window.addEventListener('resize',place);window.addEventListener('scroll',place,{passive:true});
 document.querySelectorAll('[data-onboarding]').forEach(b=>b.addEventListener('click',start));
 let seen=false;try{seen=localStorage.getItem(KEY)==='1';}catch{}
 if(!seen||location.hash==='#einfuehrung')start();
})();
