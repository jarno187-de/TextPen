// Appearance only: shared behavior for login and authenticated control pages.
(() => {
  const system = matchMedia('(prefers-color-scheme: dark)');
  let preference;
  try { preference = localStorage.getItem('textpen-admin-theme'); } catch {}
  const apply = theme => {
    document.documentElement.dataset.theme = theme;
    const button = document.getElementById('theme-toggle');
    if (button) {
      button.innerHTML = theme === 'dark' ? '<svg class="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/></svg> Hellmodus' : '<svg class="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/></svg> Dunkelmodus';
      button.setAttribute('aria-label', theme === 'dark' ? 'Hellmodus einschalten' : 'Dunkelmodus einschalten');
    }
  };
  apply(['light', 'dark'].includes(preference) ? preference : system.matches ? 'dark' : 'light');
  document.addEventListener('DOMContentLoaded', () => {
    apply(document.documentElement.dataset.theme);
    document.getElementById('theme-toggle').addEventListener('click', () => {
      preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      apply(preference);
      try { localStorage.setItem('textpen-admin-theme', preference); } catch {}
    });
  });
  system.addEventListener('change', event => {
    if (!['light', 'dark'].includes(preference)) apply(event.matches ? 'dark' : 'light');
  });
})();

document.addEventListener('DOMContentLoaded', () => {
'use strict';
document.getElementById('login').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget, button = form.querySelector('button'), error = document.getElementById('login-error');
  button.disabled = true; button.textContent = 'Zugang wird geprüft …'; error.hidden = true;
  try {
    const response = await fetch(new URL('api/login', document.baseURI), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: form.password.value, code: form.code.value }) });
    const result = await response.json(); if (!response.ok) throw Error(result.error || 'Anmeldung nicht möglich.');
    form.password.value = ''; form.code.value = ''; location.replace(document.baseURI);
  } catch (reason) { error.textContent = reason.message; error.hidden = false; form.code.value = ''; }
  finally { button.disabled = false; button.innerHTML = 'Sicher anmelden <svg class="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 12h16m-6-6 6 6-6 6"/></svg>'; }
});

});
