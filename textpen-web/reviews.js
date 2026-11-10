'use strict';
// Public reviews dialog: list with average and distribution, one review per browser, editable later.
// Anti-bot work happens quietly: the challenge is fetched and solved while the visitor reads and types.
// User text is only ever inserted with textContent.
(() => {
  const API = '/__site/reviews', KEY = 'textpen-review';
  const el = (tag, props = {}, ...children) => { const n = Object.assign(document.createElement(tag), props); n.append(...children.filter(c => c !== null && c !== undefined)); return n; };
  const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
  const decimal = n => n.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const date = iso => new Date(iso).toLocaleDateString('de-DE');
  const stored = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return v && Number.isSafeInteger(v.id) && typeof v.token === 'string' ? v : null; } catch { return null; } };
  const remember = v => { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch { /* still works for this visit */ } };
  async function call(method, path, body) {
    const response = await fetch(API + path, { method, credentials: 'omit', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(Error(data.error || 'Bewertungen sind gerade nicht verfügbar.'), { status: response.status });
    return data;
  }

  // Proof of work: SHA-256(salt.nonce) must start with `difficulty` zero bits.
  async function solve(c) {
    const enc = new TextEncoder();
    for (let nonce = 0; ; nonce++) {
      const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(c.salt + '.' + nonce)));
      let bits = 0; for (const b of h) { if (b) { bits += Math.clz32(b) - 24; break; } bits += 8; }
      if (bits >= c.difficulty) return { ...c, nonce };
    }
  }
  let work = null;
  const prepare = () => { work = call('GET', '/challenge').then(solve); work.catch(() => { work = null; }); return work; };

  const dialog = el('dialog', { id: 'reviews-dialog', className: 'privacy-dialog reviews-dialog' });
  dialog.setAttribute('aria-labelledby', 'reviews-title');
  const close = el('button', { type: 'button', className: 'close', textContent: '×' }); close.setAttribute('aria-label', 'Bewertungen schließen');
  const summary = el('div', { className: 'reviews-summary' });
  const list = el('ol', { className: 'reviews-list' }), more = el('button', { type: 'button', className: 'quiet reviews-more', textContent: 'Ältere Bewertungen laden', hidden: true });
  const rating = el('fieldset', { className: 'reviews-rating' }, el('legend', { textContent: 'Deine Bewertung' }));
  const choices = el('div', { className: 'reviews-choices' });
  for (let n = 5; n >= 1; n--) {   // reversed in the DOM so CSS can colour every star up to the chosen one
    const input = el('input', { type: 'radio', name: 'rating', value: String(n), id: 'review-star-' + n, required: true });
    const label = el('label', { htmlFor: input.id, textContent: '★', title: n + (n === 1 ? ' Stern' : ' Sterne') });
    label.append(el('span', { className: 'sr-only', textContent: n + (n === 1 ? ' Stern' : ' Sterne') }));
    choices.append(input, label);
  }
  rating.append(choices);
  const name = el('input', { name: 'name', maxLength: 40, autocomplete: 'nickname' });
  const text = el('textarea', { name: 'text', maxLength: 1000, rows: 4 }), counter = el('small', { className: 'reviews-counter', textContent: '0 / 1000' });
  const trap = el('input', { name: 'website', tabIndex: -1, autocomplete: 'off' });   // honeypot, see review-store.js
  const send = el('button', { type: 'submit', className: 'primary', textContent: 'Bewertung senden' });
  const remove = el('button', { type: 'button', className: 'quiet', textContent: 'Meine Bewertung löschen', hidden: true });
  const status = el('p', { className: 'reviews-status' }); status.setAttribute('role', 'status');
  const form = el('form', { className: 'reviews-form', noValidate: true },
    el('h3', { textContent: 'Wie gefällt dir TextPen?' }), rating,
    el('label', {}, el('span', { textContent: 'Name (optional)' }), name),
    el('label', {}, el('span', { textContent: 'Kommentar (optional)' }), text, counter),
    el('div', { className: 'reviews-trap' }, el('label', { textContent: 'Website' }, trap)),
    el('div', { className: 'reviews-actions' }, send, remove), status,
    el('details', { className: 'reviews-note' }, el('summary', { textContent: 'So prüfen wir Bewertungen' }),
      el('p', { textContent: 'Bewerten geht ohne Konto. Wir können deshalb nicht prüfen, ob jemand TextPen wirklich benutzt hat. Bewertungen mit Name oder Kommentar erscheinen erst, nachdem wir sie auf Spam und Rechtsverstöße geprüft haben – unabhängig von der Sternzahl. Kritische Bewertungen löschen wir nicht. Reine Sternbewertungen ohne Text erscheinen sofort. Gegen automatisierte Einsendungen löst dein Browser kurz eine kleine Rechenaufgabe. Aus deiner IP-Adresse bilden wir nur einen Prüfwert gegen Massen-Einsendungen, der nach spätestens 24 Stunden gelöscht wird; die IP-Adresse selbst speichern wir nicht.' }),
      el('p', {}, 'Damit du deine Bewertung später ändern oder löschen kannst, merkt sich dieser Browser einen Schlüssel dafür. Mehr in der ', el('a', { href: 'datenschutz.html', target: '_blank', rel: 'noopener', textContent: 'Datenschutzerklärung' }), '.')));
  trap.closest('.reviews-trap').setAttribute('aria-hidden', 'true');
  dialog.append(close, el('h2', { id: 'reviews-title', textContent: 'Bewertungen' }), summary, form, list, more);
  document.body.append(dialog);

  function renderSummary(data) {
    summary.replaceChildren();
    if (!data.count) { summary.append(el('p', { textContent: 'Noch keine Bewertungen. Schreib gern die erste!' })); return; }
    const score = el('div', { className: 'reviews-score' }, el('strong', { textContent: decimal(data.average) }),
      el('span', { className: 'reviews-stars', textContent: stars(Math.round(data.average)) }), el('small', { textContent: data.count + (data.count === 1 ? ' Bewertung' : ' Bewertungen') }));
    score.querySelector('.reviews-stars').setAttribute('role', 'img');
    score.querySelector('.reviews-stars').setAttribute('aria-label', `Durchschnitt ${decimal(data.average)} von 5 Sternen`);
    const bars = el('div', { className: 'reviews-bars' }); bars.setAttribute('aria-hidden', 'true');
    for (let n = 5; n >= 1; n--) {
      const share = data.distribution[n - 1] / data.count;
      bars.append(el('span', { textContent: n + '★' }), el('span', { className: 'reviews-bar' }, el('i', { style: `width:${Math.round(share * 100)}%` })), el('span', { textContent: String(data.distribution[n - 1]) }));
    }
    summary.append(score, bars);
  }
  function renderReviews(reviews, append) {
    if (!append) list.replaceChildren();
    for (const r of reviews) { // the server sends written reviews only; star-only ones count in the chart
      const head = el('div', { className: 'reviews-head' }, el('strong', { textContent: r.name }), el('span', { className: 'reviews-stars', textContent: stars(r.rating) }));
      head.lastChild.setAttribute('aria-label', r.rating + ' von 5 Sternen');
      list.append(el('li', {}, head,
        r.text ? el('p', { className: 'reviews-text', textContent: r.text }) : null,
        el('small', { textContent: date(r.date) + (r.edited ? ' · bearbeitet' : '') }),
        r.reply ? el('div', { className: 'reviews-reply' }, el('strong', { textContent: 'Antwort von TextPen' }), el('p', { textContent: r.reply.text })) : null));
    }
  }
  let oldest = 0;
  async function load(append = false) {
    try {
      const data = await call('GET', append && oldest ? '?before=' + oldest : '');
      if (!append) renderSummary(data);
      renderReviews(data.reviews, append);
      oldest = data.reviews.length ? data.reviews[data.reviews.length - 1].id : oldest; more.hidden = !data.more;
      showSummary(data);
      window.dispatchEvent(new CustomEvent('textpen-reviews', { detail: { count: data.count, average: data.average } }));
    } catch (e) { summary.replaceChildren(el('p', { textContent: e.message })); }
  }

  // Always-visible entry points: header badge and the "Was andere sagen" section on the page.
  const badge = document.getElementById('reviews-badge'), section = document.getElementById('bewertungen');
  function showSummary(data) {
    if (window.textpenControl?.allowed('reviews') === false) { if (badge) badge.hidden = true; if (section) section.hidden = true; return; }
    const label = data.count ? `${decimal(data.average)} von 5 Sternen, ${data.count} ${data.count === 1 ? 'Bewertung' : 'Bewertungen'}` : 'TextPen bewerten';
    if (badge) {
      badge.hidden = false;
      document.getElementById('reviews-badge-text').textContent = data.count ? `${decimal(data.average)} · ${data.count}` : 'Bewerten';
      badge.setAttribute('aria-label', label); badge.title = label;
    }
    if (!section) return;
    section.hidden = false;
    const score = document.getElementById('reviews-section-score');
    if (!data.count) { score.replaceChildren(el('p', { textContent: 'Noch keine Bewertungen. Sei die erste Person, die TextPen bewertet!' })); return; }
    const big = el('div', { className: 'reviews-score' }, el('strong', { textContent: decimal(data.average) }),
      el('span', { className: 'reviews-stars', textContent: stars(Math.round(data.average)) }), el('small', { textContent: data.count + (data.count === 1 ? ' Bewertung' : ' Bewertungen') }));
    big.querySelector('.reviews-stars').setAttribute('role', 'img');
    big.querySelector('.reviews-stars').setAttribute('aria-label', `Durchschnitt ${decimal(data.average)} von 5 Sternen`);
    const latest = data.reviews.find(r => r.text);
    score.replaceChildren(big, latest ? el('blockquote', { className: 'reviews-quote' }, el('p', { textContent: latest.text }), el('small', { textContent: '– ' + latest.name })) : '');
  }
  if (badge) badge.onclick = () => open();
  if (section) {
    const row = document.getElementById('reviews-section-stars');
    for (let n = 1; n <= 5; n++) { const b = el('button', { type: 'button', textContent: '★', title: n + (n === 1 ? ' Stern' : ' Sterne') }); b.setAttribute('aria-label', n + (n === 1 ? ' Stern' : ' Sterne')); b.onclick = () => open(n); row.append(b); }
    document.getElementById('reviews-section-open').onclick = () => open();
    document.getElementById('reviews-section-all').onclick = () => { open(); list.scrollIntoView({ block: 'start' }); };
  }
  call('GET', '').then(showSummary, () => {});
  async function loadMine() {
    const mine = stored(); remove.hidden = !mine; send.textContent = mine ? 'Bewertung aktualisieren' : 'Bewertung senden';
    if (!mine) return;
    try {
      const r = await call('POST', '/mine', mine);
      form.elements.rating.value = String(r.rating); name.value = r.name; text.value = r.text; counter.textContent = text.value.length + ' / 1000';
      status.textContent = r.status === 'pending' ? 'Deine Bewertung wird noch geprüft.' : r.status === 'rejected' ? 'Deine Bewertung wurde nicht veröffentlicht.' : '';
    } catch (e) { if (e.status === 404) { remember(null); remove.hidden = true; send.textContent = 'Bewertung senden'; } }
  }

  function open(preset) {
    if (window.textpenControl?.allowed('reviews') === false) return;
    if (!dialog.open) dialog.showModal();
    if (!work) prepare();
    load(); loadMine().then(() => { if (preset) form.elements.rating.value = String(preset); });
  }
  close.onclick = () => dialog.close();
  more.onclick = () => load(true);
  text.oninput = () => { counter.textContent = text.value.length + ' / 1000'; };
  form.onsubmit = async event => {
    event.preventDefault();
    const value = Number(form.elements.rating.value);
    if (!value) { status.textContent = 'Bitte wähle 1 bis 5 Sterne.'; choices.querySelector('input').focus(); return; }
    send.disabled = true; status.textContent = 'Wird gesendet …';
    const mine = stored(), fields = { rating: value, name: name.value, text: text.value };
    try {
      if (mine) {
        const r = await call('PUT', '/mine', { ...mine, ...fields });
        status.textContent = r.status === 'pending' ? 'Gespeichert. Die Änderung erscheint nach kurzer Prüfung.' : 'Gespeichert.';
      } else {
        let proof = await (work || prepare());
        let r;
        try { r = await call('POST', '', { ...fields, website: trap.value, work: proof }); }
        catch (e) {
          if (e.status !== 409 && e.status !== 429 || !/Sicherheitsprüfung|zu schnell/.test(e.message)) throw e;
          if (e.status === 429) await new Promise(res => setTimeout(res, 4000));
          proof = await prepare(); r = await call('POST', '', { ...fields, website: trap.value, work: proof });
        }
        work = null;
        remember({ id: r.id, token: r.token });
        status.textContent = r.status === 'pending' ? 'Danke! Deine Bewertung erscheint nach kurzer Prüfung.' : 'Danke! Deine Bewertung ist jetzt sichtbar.';
        remove.hidden = false; send.textContent = 'Bewertung aktualisieren';
      }
      load();
    } catch (e) { status.textContent = e.message; }
    finally { send.disabled = false; }
  };
  remove.onclick = async () => {
    const mine = stored(); if (!mine || !confirm('Deine Bewertung wirklich löschen?')) return;
    try { await call('DELETE', '/mine', mine); } catch (e) { if (e.status !== 404) { status.textContent = e.message; return; } }
    remember(null); form.reset(); counter.textContent = '0 / 1000'; remove.hidden = true; send.textContent = 'Bewertung senden'; status.textContent = 'Deine Bewertung wurde gelöscht.'; load();
  };

  // Entry points: footer button, and once per visit after the third export a small, dismissible question.
  const entry = document.getElementById('reviews-open');
  if (entry) entry.onclick = () => open();
  let exports = 0, asked = false;
  function ask() {
    if (asked || stored() || window.textpenControl?.allowed('reviews') === false) return; asked = true;
    const card = el('aside', { className: 'reviews-prompt' }, el('p', { textContent: 'Gefällt dir TextPen?' }));
    card.setAttribute('aria-label', 'TextPen bewerten');
    const row = el('div', { className: 'reviews-prompt-stars' });
    for (let n = 1; n <= 5; n++) { const b = el('button', { type: 'button', textContent: '★', title: n + (n === 1 ? ' Stern' : ' Sterne') }); b.setAttribute('aria-label', n + (n === 1 ? ' Stern' : ' Sterne')); b.onclick = () => { card.remove(); open(n); }; row.append(b); }
    const later = el('button', { type: 'button', className: 'quiet', textContent: 'Später' }); later.onclick = () => card.remove();
    card.append(row, later); document.body.append(card);
  }
  function hook() {
    const original = window.download || (typeof download === 'function' ? download : null);
    if (!original) return;
    // download() in app.js is a global function; every finished export passes through it.
    download = function (...args) { original.apply(this, args); if (/\.(pdf|png|goodnotes)$/.test(args[1]) && ++exports === 3) setTimeout(ask, 1200); };
  }
  if (document.documentElement.dataset.ready === 'true') hook(); else document.addEventListener('textpen-ready', hook);
  window.TextPenReviews = { open };
})();
