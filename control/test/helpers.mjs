import { Miniflare, createFetchMock } from 'miniflare';
import { build } from 'esbuild';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { passwordHash, totp } from '../src/security.js';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const testIP = '2001:db8::24', testPassword = 'Only-for-isolated-tests!Aa1234567890', testSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
export const testPath = 'local-test-path-' + 'aB9_'.repeat(16);
export const adminBase = 'https://textpen.test/' + testPath;
export const publicBase = 'https://textpen.test';
export async function runtime(overrides = {}) {
  await mkdir(path.join(root, '.build/test'), { recursive: true });
  const bundle = path.join(root, '.build/test/control.mjs');
  await build({ entryPoints: [path.join(root, 'control/src/worker.js')], outfile: bundle, bundle: true, format: 'esm', target: 'es2022', external: ['cloudflare:workers'], loader: { '.html': 'text', '.css': 'text' }, plugins: [{ name: 'client-source', setup(b) { b.onLoad({ filter: /\.client\.js$/ }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' })); } }] });
  const mock = createFetchMock(); mock.disableNetConnect();
  mock.get(publicBase).intercept({ path: '/', method: 'GET' }).reply(200, '<h1>TextPen</h1>').persist();
  const options = {
    cf: false, log: undefined,
    workers: [
      { name: 'control', modules: true, scriptPath: bundle, compatibilityDate: '2026-07-30', compatibilityFlags: ['nodejs_compat'], durableObjects: { CONTROL: { className: 'ControlStore', useSQLite: true } }, serviceBindings: { SITE: 'content' }, fetchMock: mock,
        bindings: { ADMIN_HOST: 'textpen.test', PUBLIC_HOST: 'textpen.test', ADMIN_PATH: testPath, PASSWORD_HASH: passwordHash(testPassword), TOTP_SECRET: testSecret, SITE_SCRIPT: 'textpen-content', ...overrides } },
      { name: 'content', modules: true, scriptPath: path.join(root, '.build/content-worker.mjs'), compatibilityDate: '2026-07-30', assets: { directory: path.join(root, '.build/public'), binding: 'ASSETS', routerConfig: { invoke_user_worker_ahead_of_assets: true, has_user_worker: true }, assetConfig: { html_handling: 'none' } } }
    ]
  };
  const mf = new Miniflare(options); await mf.ready;
  return { mf, options, mock };
}
export async function code(offset = 0) { return totp(testSecret, Math.floor(Date.now() / 30000) + offset); }
export function request(mf, suffix = '', options = {}) {
  const { ip = testIP, data, csrf, cookie, origin = 'https://textpen.test', headers = {}, ...rest } = options;
  return mf.dispatchFetch(adminBase + suffix, { redirect: 'manual', ...rest, method: data ? 'POST' : rest.method || 'GET', headers: { 'CF-Connecting-IP': ip, ...(data ? { 'Content-Type': 'application/json', Origin: origin } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: data ? JSON.stringify(data) : undefined });
}
export async function login(mf, offset = 0) {
  const response = await request(mf, '/api/login', { data: { password: testPassword, code: await code(offset) } });
  if (response.status !== 200) throw Error('Test login failed: ' + response.status + ' ' + await response.text());
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const result = await request(mf, '/api/state', { cookie });
  const state = await result.json(); return { cookie, csrf: state.csrf, state };
}
