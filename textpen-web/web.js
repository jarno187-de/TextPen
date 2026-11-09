'use strict';
// themeChoice is 'light', 'dark' or 'system'; 'system' follows the device setting live.
const systemDark=matchMedia('(prefers-color-scheme: dark)');
let themeChoice='system';
function applyTheme(choice){themeChoice=['light','dark'].includes(choice)?choice:'system';document.documentElement.dataset.theme=themeChoice==='system'?(systemDark.matches?'dark':'light'):themeChoice;try{if(window.textpenPrivacy?.theme)localStorage.setItem('textpen-theme',themeChoice);}catch{}document.querySelectorAll('input[name=theme]').forEach(r=>{r.checked=r.value===themeChoice;});}
systemDark.addEventListener('change',()=>{if(themeChoice==='system')applyTheme('system');});
applyTheme('system');
document.querySelectorAll('input[name=theme]').forEach(r=>r.onchange=()=>applyTheme(r.value));
$('settings-button').onclick=()=>$('settings-dialog').showModal();
document.querySelector('[data-settings-close]').onclick=()=>$('settings-dialog').close();
// Close settings before the privacy dialog opens on top of it.
$('settings-dialog').addEventListener('click',e=>{if(e.target.closest('[data-privacy-settings]'))$('settings-dialog').close();},true);
// Settings topics on the left: click or arrow keys, like a vertical tab list.
const settingsTabs=[...document.querySelectorAll('.settings-nav [role=tab]')];
function showSettingsTopic(tab){for(const t of settingsTabs){const on=t===tab;t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;$(t.getAttribute('aria-controls')).hidden=!on;}}
settingsTabs.forEach((tab,i)=>{tab.onclick=()=>showSettingsTopic(tab);tab.onkeydown=e=>{const step={ArrowDown:1,ArrowRight:1,ArrowUp:-1,ArrowLeft:-1}[e.key];if(!step)return;e.preventDefault();const next=settingsTabs[(i+step+settingsTabs.length)%settingsTabs.length];showSettingsTopic(next);next.focus();};});
// Beta features stay hidden until switched on; switching on needs the warning confirmed first.
let betaEnabled=false;
function applyBeta(on){betaEnabled=on;$('beta-toggle').checked=on;$('beta-confirm').hidden=true;$('goodnotes').hidden=!on;try{if(window.textpenPrivacy?.theme){if(on)localStorage.setItem('textpen-beta','1');else localStorage.removeItem('textpen-beta');}}catch{}}
$('beta-toggle').onchange=()=>{if(!$('beta-toggle').checked){applyBeta(false);return;}$('beta-toggle').checked=false;$('beta-confirm').hidden=false;$('beta-accept').focus();};
$('beta-accept').onclick=()=>{applyBeta(true);$('beta-toggle').focus();};
$('beta-cancel').onclick=()=>{$('beta-confirm').hidden=true;$('beta-toggle').focus();};
