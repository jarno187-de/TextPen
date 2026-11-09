'use strict';
(() => {
  const mapping = { pdf: 'pdf', goodnotes: 'goodnotes', 'reviews-open': 'reviews', download: 'image', print: 'print', 'import-font': 'fontImport', 'export-font': 'fontExport' };
  let config = null, failure = false, policy = null, socket = null;
  let reconnectTimer, connectTimer, heartbeatTimer, pongTimer, retry = 0, generation = 0, stopped = false, updating = false;
  const local = location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  const defaults = { features: { pdf: true, goodnotes: true, reviews: true, image: true, print: true, fontImport: true, fontExport: true }, analytics: { enabled: false }, banner: null };
  window.textpenControl = {
    allowed(feature) { return local && config === null ? true : Boolean(config?.features?.[feature]) && !failure && policy?.mode === 'open'; },
    event(event) {
      if (!config?.analytics?.enabled || !window.textpenPrivacy?.analytics || failure || policy?.mode !== 'open') return;
      fetch('/__site/events', { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event, consent: true }), keepalive: true }).catch(() => {});
    }
  };
  function apply() {
    let banner = document.getElementById('site-notice');
    if (!banner) { banner = document.createElement('aside'); banner.id = 'site-notice'; banner.className = 'site-notice'; banner.setAttribute('role', 'status'); document.body.prepend(banner); }
    banner.hidden = !failure && !config?.banner;
    banner.textContent = failure ? 'Die Verbindung zur Website-Steuerung ist gerade nicht verfügbar. Deine aktuelle Arbeit bleibt im Browser erhalten. Bitte versuche es später erneut.' : config?.banner?.text || '';
    banner.dataset.tone = failure ? 'warning' : config?.banner?.tone || 'info';
    for (const [id, feature] of Object.entries(mapping)) { const element = document.getElementById(id); if (element) element.dataset.controlDisabled = window.textpenControl.allowed(feature) ? 'false' : 'true'; }
    const option = document.getElementById('privacy-analytics-option'); if (option) option.hidden = !config?.analytics?.enabled;
    if (!config?.analytics?.enabled && window.textpenPrivacy) window.textpenPrivacy.analytics = false;
    let gate = document.getElementById('site-control-gate');
    if (['blocked', 'maintenance'].includes(policy?.mode)) {
      if (!gate) {
        gate = document.createElement('dialog'); gate.id = 'site-control-gate';
        gate.setAttribute('aria-labelledby', 'site-control-title');
        gate.innerHTML = '<h1 id="site-control-title"></h1><p class="site-control-message"></p><p>Deine aktuelle Arbeit bleibt in diesem Browser erhalten.</p><nav data-control-legal-links><a href="/datenschutz.html">Datenschutz</a></nav>';
        gate.addEventListener('cancel', event => event.preventDefault()); document.body.append(gate);
      }
      gate.querySelector('h1').textContent = policy.mode === 'maintenance' ? 'Wir sind bald zurück' : 'Zugriff nicht möglich';
      gate.querySelector('.site-control-message').textContent = policy.mode === 'maintenance' ? policy.message : 'Diese Seite ist derzeit gesperrt.';
      if (!gate.open) gate.showModal();
    } else if (gate?.open) gate.close();
    if (policy) for (const links of document.querySelectorAll('[data-control-legal-links]')) links.hidden = policy.showLegalLinks === false;
  }
  function receive(next) {
    if (!next || !['open', 'blocked', 'maintenance', 'redirect'].includes(next.mode)) throw Error('Invalid policy');
    generation++; policy = next; config = next.config; failure = false;
    if (next.mode === 'redirect') { location.replace(next.target); return; }
    // A visitor who initially received only the maintenance shell has no editor
    // to preserve. Already loaded application pages never reload for settings.
    if (next.mode === 'open' && document.body.hasAttribute('data-control-shell')) { location.reload(); return; }
    apply();
  }
  async function update() {
    if (updating || stopped) return;
    updating = true; const started = generation;
    try {
      const response = await fetch('/__site/policy?path=' + encodeURIComponent(location.pathname), { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw Error();
      const next = await response.json(); if (generation === started) receive(next);
    } catch {
      if (generation === started) {
        if (local) { config = defaults; policy = { mode: 'open' }; } else failure = true;
        apply();
      }
    } finally { updating = false; }
  }
  function disconnect() {
    clearTimeout(connectTimer); clearTimeout(pongTimer); clearInterval(heartbeatTimer);
    const previous = socket; socket = null;
    if (previous) { previous.onclose = null; previous.onerror = null; previous.close(); }
  }
  function reconnect() {
    disconnect();
    if (stopped) return;
    update(); clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, Math.min(15000, 500 * 2 ** Math.min(retry++, 5)) + Math.random() * 250);
  }
  function connect() {
    clearTimeout(reconnectTimer);
    if (stopped || socket) return;
    try {
      const url = new URL('/__site/live', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('path', location.pathname);
      const current = new WebSocket(url); socket = current;
      connectTimer = setTimeout(reconnect, 10000);
      current.onmessage = event => {
        if (socket !== current) return;
        if (event.data === 'pong') { clearTimeout(pongTimer); return; }
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'policy') { receive(message.policy); clearTimeout(connectTimer); retry = 0; }
        } catch { reconnect(); }
      };
      current.onopen = () => {
        if (socket !== current) return;
        heartbeatTimer = setInterval(() => {
          if (current.readyState !== WebSocket.OPEN) return;
          current.send('ping'); clearTimeout(pongTimer); pongTimer = setTimeout(reconnect, 10000);
        }, 25000);
      };
      current.onerror = current.onclose = () => { if (socket === current) reconnect(); };
    } catch { reconnect(); }
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('button'); const feature = mapping[button?.id];
    if (feature && !window.textpenControl.allowed(feature)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  const ready = () => { apply(); if (location.protocol === 'file:') { config = defaults; policy = { mode: 'open' }; apply(); } else { update(); connect(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
  document.addEventListener('textpen-ready', apply);
  const resume = () => { if (location.protocol === 'file:') return; stopped = false; disconnect(); update(); connect(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resume(); });
  window.addEventListener('online', resume);
  window.addEventListener('pagehide', () => { stopped = true; clearTimeout(reconnectTimer); disconnect(); });
  window.addEventListener('pageshow', event => { if (event.persisted) resume(); });
  setInterval(() => { if (!socket && location.protocol !== 'file:') update(); }, 15000);
})();
