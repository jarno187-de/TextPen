'use strict';
(() => {
 const preferences={necessary:true,project:false,theme:false,analytics:false};window.textpenPrivacy=preferences;
 const dialog=document.getElementById('privacy-dialog'),project=document.getElementById('privacy-project'),theme=document.getElementById('privacy-theme'),error=document.getElementById('privacy-error');
 let trigger,started=false,busy=false;
 const remove=keys=>{let ok=true;for(const key of keys)try{localStorage.removeItem(key);}catch{ok=false;}return ok;};
 function open(event){trigger=event?.currentTarget;project.checked=preferences.project;theme.checked=preferences.theme;document.getElementById('privacy-analytics').checked=preferences.analytics;error.hidden=true;if(!dialog.open)dialog.showModal();}
 function close(){dialog.close();trigger?.focus();}
 function chooseProject(){return new Promise(resolve=>{
  const choice=document.createElement('dialog');choice.className='privacy-dialog';choice.setAttribute('aria-labelledby','restore-title');choice.innerHTML='<h2 id="restore-title">Welche Arbeit möchtest du behalten?</h2><p>Auf diesem Gerät liegt ein gespeichertes Projekt. Du hast in dieser Seite bereits Änderungen gemacht.</p><div class="restore-actions"><button type="button" data-choice="load">Gespeichertes Projekt laden</button><button type="button" data-choice="keep">Aktuelle Arbeit behalten und speichern</button><button type="button" data-choice="cancel">Abbrechen</button></div>';document.body.append(choice);
  const finish=value=>{choice.close();choice.remove();resolve(value);};choice.querySelectorAll('button').forEach(b=>b.onclick=()=>finish(b.dataset.choice));choice.addEventListener('cancel',e=>{e.preventDefault();finish('cancel');});choice.showModal();
 });}
 async function apply(without=false){
  if(busy||!started)return;busy=true;dialog.querySelectorAll('button').forEach(b=>b.disabled=true);error.hidden=true;
  const next={necessary:true,project:!without&&project.checked,theme:!without&&theme.checked,analytics:!without&&!document.getElementById('privacy-analytics-option').hidden&&document.getElementById('privacy-analytics').checked};
  try{
   let stored=null,savedTheme=null,savedBeta=null;
   // Read storage only after an explicit request to enable the corresponding purpose.
   if(next.project&&!preferences.project){const raw=localStorage.getItem('textpen-v1')||localStorage.getItem('inkshift-v1');if(raw){stored=JSON.parse(raw);if(!stored||typeof stored!=='object'||Array.isArray(stored))throw Error('Das gespeicherte Projekt ist nicht lesbar. Die aktuelle Arbeit bleibt erhalten.');}}
   if(next.theme&&!preferences.theme){savedTheme=localStorage.getItem('textpen-theme')||localStorage.getItem('inkshift-theme');savedBeta=localStorage.getItem('textpen-beta');}
   if(stored){const action=hasCurrentWork()?await chooseProject():'load';if(action==='cancel')return;if(action==='load')await restoreSavedProject(stored);}
   let removed=true;
   if(preferences.project&&!next.project)removed=remove(['textpen-v1','inkshift-v1'])&&removed;
   if(preferences.theme&&!next.theme)removed=remove(['textpen-theme','inkshift-theme','textpen-beta'])&&removed;
   Object.assign(preferences,next);
   if(next.project){flushPersist();if(!storageOK){preferences.project=false;project.checked=false;throw Error('Dein Browser konnte die Arbeit nicht speichern. Die Speicherung wurde deaktiviert. Bitte sichere wichtige Ergebnisse als Datei.');}}
   if(next.theme){const value=['light','dark','system'].includes(savedTheme)?savedTheme:themeChoice;try{localStorage.setItem('textpen-theme',value);}catch{preferences.theme=false;theme.checked=false;throw Error('Dein Browser konnte die Darstellung nicht speichern.');}applyTheme(value);applyBeta(savedBeta==='1'||betaEnabled);}
   if(!removed)throw Error('Die Speicherung ist ausgeschaltet, aber dein Browser hat das Löschen blockiert. Bitte entferne die Websitedaten in den Browsereinstellungen.');
   close();
  }catch(e){error.textContent=e.message||'Speicherzugriff nicht möglich. Deine aktuelle Arbeit bleibt nutzbar.';error.hidden=false;}
  finally{busy=false;dialog.querySelectorAll('button').forEach(b=>b.disabled=false);project.checked=preferences.project;theme.checked=preferences.theme;}
 }
 function script(src){return new Promise((resolve,reject)=>{const el=document.createElement('script');el.src=src;el.onload=resolve;el.onerror=()=>reject(Error('Datei konnte nicht geladen werden: '+src));document.body.append(el);});}
 document.querySelectorAll('[data-privacy-settings]').forEach(b=>b.addEventListener('click',open));
 document.getElementById('privacy-save').onclick=()=>apply();document.getElementById('privacy-reject').onclick=()=>apply(true);document.getElementById('privacy-close').onclick=close;
 dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
 const showFromHash=()=>{if(location.hash==='#datenschutzeinstellungen')open();};window.addEventListener('hashchange',showFromHash);
 const workspaces=[document.getElementById('write-view'),document.getElementById('font-view')];workspaces.forEach(el=>el.inert=true);
 (async()=>{try{for(const src of ['characters.js','handwriting.js','assets/handwriting-vectors.js','vector-pdf.js','goodnotes-writer.js','assets/font-strokes.js','glyph-cleanup.js','app.js','goodnotes-export.js','web.js','onboarding.js','reviews.js'])await script(src);started=true;workspaces.forEach(el=>el.inert=false);document.documentElement.dataset.ready='true';document.dispatchEvent(new Event('textpen-ready'));showFromHash();}catch(e){document.getElementById('app-error').hidden=false;document.getElementById('error-detail').textContent=e.message;}})();
})();
