'use strict';
function applyTheme(theme){document.documentElement.dataset.theme=theme;try{if(window.textpenPrivacy?.theme)localStorage.setItem('textpen-theme',theme);}catch{}$('theme-toggle').textContent=theme==='dark'?'☀ Hellmodus':'☾ Dunkelmodus';}
applyTheme(document.documentElement.dataset.theme||'dark');
$('theme-toggle').onclick=()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');
