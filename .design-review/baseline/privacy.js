'use strict';
(() => {
  // Deliberately kept in memory: every new document requires a fresh choice.
  const preferences = { necessary: false, project: false, theme: false };
  window.textpenPrivacy = preferences;
  const app = document.getElementById('textpen-app');
  const dialog = document.getElementById('privacy-dialog');
  const closed = document.getElementById('privacy-closed');
  const necessary = document.getElementById('privacy-necessary');
  const project = document.getElementById('privacy-project');
  const theme = document.getElementById('privacy-theme');
  const close = document.getElementById('privacy-close');
  let started = false;
  let busy = false;
  let trigger;

  function remove(keys) {
    let success = true;
    for (const key of keys) try { localStorage.removeItem(key); } catch { success = false; }
    return success;
  }
  function open(event) {
    trigger = event?.currentTarget;
    necessary.checked = started ? preferences.necessary : true;
    project.checked = preferences.project;
    theme.checked = preferences.theme;
    close.hidden = !started;
    document.getElementById('privacy-details').open = started || location.hash === '#datenschutzeinstellungen';
    document.getElementById('privacy-title').textContent = started ? 'Datenschutzeinstellungen' : 'Deine Daten. Deine Entscheidung.';
    dialog.showModal();
  }
  function leave() {
    Object.assign(preferences, { necessary: false, project: false, theme: false });
    dialog.close();
    app.hidden = true;
    app.inert = true;
    closed.hidden = false;
    document.getElementById('privacy-ended-title').focus();
  }
  function script(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = () => reject(new Error('Datei konnte nicht geladen werden: ' + src));
      document.body.append(el);
    });
  }
  async function apply(all = false) {
    if (busy) return;
    if (!all && !necessary.checked) { leave(); return; }
    busy = true;
    dialog.querySelectorAll('button').forEach(button => button.disabled = true);
    const next = { necessary: true, project: all || project.checked, theme: all || theme.checked };
    let removed = true;
    // A revoked permission also removes data written under that permission.
    if (preferences.project && !next.project) removed = remove(['textpen-v1', 'inkshift-v1']) && removed;
    if (preferences.theme && !next.theme) removed = remove(['textpen-theme', 'inkshift-theme']) && removed;
    Object.assign(preferences, next);
    try {
      if (!started) {
        if (next.theme) try {
          const saved = localStorage.getItem('textpen-theme') || localStorage.getItem('inkshift-theme');
          if (['light', 'dark'].includes(saved)) document.documentElement.dataset.theme = saved;
        } catch {}
        app.hidden = false;
        for (const src of ['handwriting.js', 'assets/handwriting-vectors.js', 'vector-pdf.js', 'app.js', 'web.js']) await script(src);
        started = true;
        persist();
      } else {
        persist();
        if (next.theme) applyTheme(document.documentElement.dataset.theme);
      }
      app.inert = false;
      dialog.close();
      if (!removed) alert('Der Browser hat das Löschen gespeicherter Daten blockiert. Bitte lösche die Websitedaten in deinen Browsereinstellungen. Die Speicherung ist jetzt ausgeschaltet.');
      (trigger || document.getElementById('letter')).focus();
    } catch (error) {
      document.getElementById('privacy-error').hidden = false;
      document.getElementById('privacy-error').textContent = error.message + ' Bitte lade die Seite neu.';
      // A partial application startup must not be executed twice.
      return;
    } finally {
      if (started) {
        busy = false;
        dialog.querySelectorAll('button').forEach(button => button.disabled = false);
      }
    }
  }
  document.querySelectorAll('[data-privacy-settings]').forEach(button => button.addEventListener('click', open));
  document.getElementById('privacy-accept').onclick = () => apply(true);
  document.getElementById('privacy-save').onclick = () => apply();
  document.getElementById('privacy-reject').onclick = leave;
  document.getElementById('privacy-reload').onclick = () => location.reload();
  close.onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (!started || busy) event.preventDefault(); });
  // Returning via the browser's back/forward cache is a fresh visit too.
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  if(document.documentElement.classList.contains('booting'))window.addEventListener('textpen:boot-finished',()=>open(),{once:true});
  else open();
})();
