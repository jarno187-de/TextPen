'use strict';
if(document.documentElement.classList.contains('booting')){
 document.querySelectorAll('.boot-word span').forEach((s,i)=>s.style.setProperty('--i',i));
 const finish=()=>{document.documentElement.classList.remove('booting');document.getElementById('boot')?.remove();window.dispatchEvent(new Event('textpen:boot-finished'));};
 setTimeout(finish,matchMedia('(prefers-reduced-motion: reduce)').matches?350:3900);
}else{document.getElementById('boot').remove();}
