import { body, escapeHTML, json, normalizeIP, notFound } from './security.js';
import { canonicalPath, PAGE_PATHS } from './model.js';
export { ControlStore } from './store.js';

const hidden = notFound;
function privateHeaders(response) {
  const result = new Response(response.body, response);
  const headers = {
    'Cache-Control': 'private, no-store, max-age=0', 'Pragma': 'no-cache',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
    'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Strict-Transport-Security': 'max-age=31536000'
  };
  for (const [name, value] of Object.entries(headers)) result.headers.set(name, value);
  return result;
}
function messagePage(title, text, status, extra = {}, live = false, showLegalLinks = true) {
  const client = live ? '<link rel="stylesheet" href="/site-control.css"><script src="/site-control.js" defer></script>' : '';
  return new Response(`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(title)} · TextPen</title>${client}<body${live ? ' data-control-shell' : ''}><main><p>TEXTPEN</p><h1>${escapeHTML(title)}</h1><p>${escapeHTML(text)}</p><nav data-control-legal-links${showLegalLinks ? '' : ' hidden'}><a href="/datenschutz.html">Datenschutz</a></nav></main></body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra } });
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const host = url.hostname;
    if (![env.ADMIN_HOST, env.PUBLIC_HOST].includes(host)) return hidden();
    const control = env.CONTROL.get(env.CONTROL.idFromName('textpen-owner-v1'));
    // CF-Connecting-IP is overwritten by Cloudflare at its edge. Never trust X-Forwarded-For.
    const ip = normalizeIP(request.headers.get('CF-Connecting-IP'));
    const secret = env.ADMIN_PATH;
    const adminBase = typeof secret === 'string' ? '/' + secret : null;
    const isAdminPath = adminBase && (url.pathname === adminBase || url.pathname.startsWith(adminBase + '/'));
    if (host === env.ADMIN_HOST && (host !== env.PUBLIC_HOST || isAdminPath)) {
      if (!secret || !/^[A-Za-z0-9_-]{50,512}$/.test(secret) || !ip || url.search || url.protocol !== 'https:') return privateHeaders(hidden());
      const base = '/' + secret;
      if (url.pathname !== base && !url.pathname.startsWith(base + '/')) return privateHeaders(hidden());
      const suffix = url.pathname.slice(base.length) || '/';
      if (!['/', '/control.css', '/login.js', '/panel.js', '/api/login', '/api/state', '/api/action', '/api/logout', '/api/export'].includes(suffix)) return privateHeaders(hidden());
      try {
        const headers = new Headers(request.headers); headers.set('X-Control-IP', ip);
        const internal = new Request('https://control.internal' + suffix, { method: request.method, headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body, redirect: 'manual' });
        return privateHeaders(await control.fetch(internal));
      } catch { return privateHeaders(new Response('Dienst vorübergehend nicht verfügbar.', { status: 503 })); }
    }
    if (url.pathname.startsWith('/.internal') || /(?:^|\/)(?:control|node_modules|\.git|\.env|\.dev\.vars)(?:\/|\.|$)/.test(url.pathname)) return hidden();
    if (!ip) return messagePage('Zugriff nicht möglich', 'Die Verbindung konnte nicht geprüft werden.', 403);
    const reviewPath = url.pathname === '/__site/reviews' || url.pathname.startsWith('/__site/reviews/');
    if (!['GET', 'HEAD'].includes(request.method) && !(url.pathname === '/__site/events' && request.method === 'POST') && !(reviewPath && ['POST', 'PUT', 'DELETE'].includes(request.method))) return new Response('Methode nicht erlaubt.', { status: 405, headers: { Allow: 'GET, HEAD' } });
    try {
      // Only the public control client and read-only policy channel remain available
      // during a block, so open pages can recover when the restriction is lifted.
      if (['/site-control.js', '/site-control.css'].includes(url.pathname)) {
        const response = await env.SITE.fetch(request);
        const output = new Response(response.body, response);
        output.headers.set('Cache-Control', 'no-store');
        output.headers.set('X-Content-Type-Options', 'nosniff');
        return output;
      }
      if (['/__site/live', '/__site/policy'].includes(url.pathname)) {
        const path = canonicalPath(url.searchParams.get('path') || '/');
        if (!PAGE_PATHS.includes(path)) return hidden();
        if (url.pathname === '/__site/policy') return json(await control.publicPolicy(path, ip));
        if (request.method !== 'GET' || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response(null, { status: 426 });
        if (url.protocol !== 'https:' || request.headers.get('origin') !== 'https://' + env.PUBLIC_HOST) return new Response(null, { status: 403 });
        return await control.fetch(new Request('https://control.internal/live?path=' + encodeURIComponent(path), { headers: { Upgrade: 'websocket', 'X-Control-IP': ip } }));
      }
      const policy = await control.publicPolicy(url.pathname, ip);
      if (policy.mode === 'blocked') return messagePage('Zugriff nicht möglich', 'Diese Anfrage wurde gesperrt.', 403, {}, true);
      if (policy.mode === 'maintenance') return messagePage('Wir sind bald zurück', policy.message, 503, { 'Retry-After': String(policy.retryAfter) }, true, policy.showLegalLinks);
      if (policy.mode === 'redirect') return new Response(null, { status: 302, headers: { Location: policy.target, 'Cache-Control': 'no-store' } });
      if (url.pathname === '/__site/config') return json(policy.config);
      if (url.pathname === '/__site/events') {
        if (request.method !== 'POST') return hidden();
        if (request.headers.get('origin') !== 'https://' + env.PUBLIC_HOST) return new Response(null, { status: 403 });
        const data = await body(request, 200); await control.collectEvent(ip, data); return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
      }
      if (reviewPath) {
        if (request.method !== 'GET' && request.headers.get('origin') !== 'https://' + env.PUBLIC_HOST) return new Response(null, { status: 403 });
        const data = request.method === 'GET' ? Object.fromEntries(url.searchParams) : await body(request, 4000);
        const [status, result] = await control.reviewApi(request.method, url.pathname, data, ip);
        return json(result, status);
      }
      if (url.pathname.startsWith('/__site/')) return hidden();
      const assetURL = new URL(request.url); assetURL.pathname = policy.path;
      const response = await env.SITE.fetch(new Request(assetURL, request));
      const output = new Response(response.body, response);
      // Never permit a browser or CDN to bypass a newly enabled access rule with cached content.
      output.headers.set('Cache-Control', 'no-store'); output.headers.set('X-Content-Type-Options', 'nosniff');
      output.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
      if (request.method === 'GET' && response.headers.get('content-type')?.includes('text/html')) ctx.waitUntil(control.recordPage(policy.path, response.status).catch(() => {}));
      return output;
    } catch (error) { return messagePage('Vorübergehend nicht verfügbar', 'Bitte versuche es später erneut.', error.status || 503, { 'Retry-After': '60' }); }
  },
  async scheduled(event, env, ctx) { const control = env.CONTROL.get(env.CONTROL.idFromName('textpen-owner-v1')); ctx.waitUntil(control.checkHealth()); }
};
