// Only public HTTPS Date headers are requested. No codes, keys or credentials leave this machine.
export async function referenceClock(fetcher = fetch, now = Date.now) {
  const readings = await Promise.allSettled(['https://www.cloudflare.com', 'https://www.google.com', 'https://www.microsoft.com'].map(async origin => {
    const start = now();
    const response = await fetcher(origin + '/?textpen-clock=' + crypto.randomUUID(), { method: 'HEAD', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(5000) });
    const end = now(), server = Date.parse(response.headers.get('date'));
    if (!Number.isFinite(server) || end - start > 5000 || Number(response.headers.get('age') || 0) > 0) throw Error('Zeitangabe nicht aktuell.');
    return server + 500 - (start + end) / 2;
  }));
  const offsets = readings.filter(r => r.status === 'fulfilled').map(r => r.value).sort((a, b) => a - b);
  for (let i = 0; i < offsets.length - 1; i++) if (Math.abs(offsets[i + 1] - offsets[i]) <= 5000) return { trusted: true, offset: (offsets[i + 1] + offsets[i]) / 2 };
  return { trusted: false, offset: 0 };
}
