import { fail, normalizeIP } from './security.js';

export const DEFAULT_SETTINGS = {
  maintenance: { enabled: false, message: 'TextPen wird gerade gewartet. Bitte versuche es später erneut.', startsAt: '', endsAt: '', includeLegal: false },
  banner: { enabled: false, text: '', tone: 'info', startsAt: '', endsAt: '' },
  features: { pdf: true, image: true, print: true, fontImport: true, fontExport: true, goodnotes: true, reviews: true },
  ads: { enabled: false },
  analytics: { enabled: false },
  pages: {}
};
export const PAGE_PATHS = ['/', '/anleitung.html', '/datenschutz.html', '/impressum.html'];
export const LEGAL = ['/datenschutz.html', '/impressum.html'];
export function canonicalPath(path) {
  if (path === '/index.html') return '/';
  for (const name of ['anleitung', 'datenschutz', 'impressum']) if (path === '/' + name || path === '/' + name + '/') return '/' + name + '.html';
  return path;
}
function short(value, max) { if (typeof value !== 'string' || value.length > max) throw fail('Text ist ungültig oder zu lang.'); return value; }
function bool(value) { if (typeof value !== 'boolean') throw fail('Ungültiger Schalter.'); return value; }
function date(value) { if (value === '') return ''; if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw fail('Ungültiges Datum.'); return new Date(value).toISOString(); }
function period(value) { const startsAt = date(value.startsAt), endsAt = date(value.endsAt); if (startsAt && endsAt && endsAt <= startsAt) throw fail('Das Ende muss nach dem Beginn liegen.'); return { startsAt, endsAt }; }
export function validateSettings(value, adsReady = false) {
  try {
    const settings = {
      maintenance: { enabled: bool(value.maintenance.enabled), message: short(value.maintenance.message, 500), ...period(value.maintenance), includeLegal: bool(value.maintenance.includeLegal) },
      banner: { enabled: bool(value.banner.enabled), text: short(value.banner.text, 300), tone: value.banner.tone, ...period(value.banner) },
      features: Object.fromEntries(Object.keys(DEFAULT_SETTINGS.features).map(key => [key, bool(value.features[key] ?? DEFAULT_SETTINGS.features[key])])),
      ads: { enabled: bool(value.ads.enabled) }, analytics: { enabled: bool(value.analytics.enabled) }, pages: {}
    };
    if (!['info', 'warning', 'success'].includes(settings.banner.tone)) throw fail('Ungültiger Hinweistyp.');
    if (settings.banner.enabled && !settings.banner.text.trim()) throw fail('Bitte einen Hinweistext eingeben.');
    if (settings.ads.enabled && !adsReady) throw fail('AdSense ist noch nicht vollständig eingerichtet. Werbung bleibt ausgeschaltet.');
    for (const [path, rule] of Object.entries(value.pages || {})) {
      if (!PAGE_PATHS.includes(path) || LEGAL.includes(path)) throw fail('Diese Seite darf hier nicht gesperrt werden.');
      if (!['open', 'blocked', 'redirect'].includes(rule.mode)) throw fail('Ungültige Seitenregel.');
      if (rule.mode === 'redirect' && (!PAGE_PATHS.includes(rule.target) || rule.target === path)) throw fail('Bitte eine andere vorhandene Zielseite wählen.');
      settings.pages[path] = { mode: rule.mode, target: rule.mode === 'redirect' ? rule.target : '' };
    }
    for (const start of Object.keys(settings.pages)) { const seen = new Set(); let at = start; while (settings.pages[at]?.mode === 'redirect') { if (seen.has(at)) throw fail('Weiterleitungen dürfen keinen Kreis bilden.'); seen.add(at); at = settings.pages[at].target; } }
    return settings;
  } catch (error) { if (error.status) throw error; throw fail('Unvollständige Einstellungen.'); }
}
export function active(value, now = Date.now()) { return value.enabled && (!value.startsAt || Date.parse(value.startsAt) <= now) && (!value.endsAt || Date.parse(value.endsAt) > now); }
export function validateBlock(value) {
  const ip = normalizeIP(value.ip); if (!ip) throw fail('Ungültige IP-Adresse.');
  const reason = short(value.reason || '', 200), expiresAt = date(value.expiresAt || '');
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) throw fail('Das Ablaufdatum muss in der Zukunft liegen.');
  return { ip, reason, expiresAt };
}
