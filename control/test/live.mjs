import assert from 'node:assert/strict';
import { runtime, request, login, publicBase, testPassword, code } from './helpers.mjs';

const { mf } = await runtime();
const connections = [];
async function connect(path = '/', ip = '198.51.100.20') {
  const response = await mf.dispatchFetch(publicBase + '/__site/live?path=' + encodeURIComponent(path), { headers: { Upgrade: 'websocket', Origin: publicBase, 'CF-Connecting-IP': ip } });
  assert.equal(response.status, 101);
  const socket = response.webSocket, messages = [];
  socket.addEventListener('message', event => messages.push(event.data === 'pong' ? 'pong' : JSON.parse(event.data)));
  socket.accept(); connections.push(socket);
  return { socket, messages, async next(predicate = () => true) {
    const end = Date.now() + 6000;
    while (Date.now() < end) {
      const index = messages.findIndex(predicate);
      if (index >= 0) return messages.splice(index, 1)[0];
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw Error('Timed out waiting for live policy');
  } };
}
try {
  const auth = await login(mf, -1);
  let revision = auth.state.revision, settings = structuredClone(auth.state.settings);
  const action = async data => {
    const response = await request(mf, '/api/action', { ...auth, data });
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); revision = result.revision;
  };
  const save = () => action({ action: 'settings', revision, settings });
  const first = await connect(), second = await connect('/anleitung.html'), legal = await connect('/impressum.html', '198.51.100.21');
  for (const connection of [first, second, legal]) assert.equal((await connection.next()).policy.mode, 'open');
  first.socket.send('ping'); assert.equal(await first.next(message => message === 'pong'), 'pong');
  settings.banner = { ...settings.banner, enabled: true, text: 'Instant banner' }; await save();
  for (const connection of [first, second, legal]) {
    const message = await connection.next(); assert.equal(message.policy.config.banner.text, 'Instant banner');
    assert.deepEqual(Object.keys(message.policy).sort(), ['config', 'mode', 'path']);
    assert.ok(!JSON.stringify(message).includes(auth.csrf));
  }
  const later = await connect(); assert.equal((await later.next()).policy.config.banner.text, 'Instant banner');
  console.log('PASS Push to existing visitors, current state for new visitors, heartbeat and public-only payload');

  settings.maintenance.enabled = true; await save();
  assert.equal((await first.next()).policy.mode, 'maintenance'); assert.equal((await legal.next()).policy.mode, 'open');
  const blockedArrival = await connect(); assert.equal((await blockedArrival.next()).policy.mode, 'maintenance');
  settings.maintenance.enabled = false; settings.pages['/anleitung.html'] = { mode: 'blocked', target: '' }; await save();
  assert.equal((await first.next()).policy.mode, 'open');
  assert.equal((await second.next(message => message.policy.mode === 'blocked')).policy.path, '/anleitung.html');
  settings.pages['/anleitung.html'] = { mode: 'redirect', target: '/' }; await save();
  assert.equal((await second.next(message => message.policy.mode === 'redirect')).policy.target, '/');
  console.log('PASS Maintenance start/stop, legal exception and per-page block/redirect reach open connections');

  await action({ action: 'block', block: { ip: '198.51.100.20', reason: 'Private reason', expiresAt: new Date(Date.now() + 1600).toISOString() } });
  const blocked = await first.next(message => message.policy?.mode === 'blocked'); assert.ok(!JSON.stringify(blocked).includes('Private reason'));
  first.messages.length = 0;
  assert.equal((await first.next(message => message.policy?.mode === 'open')).policy.mode, 'open');
  settings.banner.startsAt = new Date(Date.now() + 1200).toISOString(); settings.banner.endsAt = new Date(Date.now() + 2700).toISOString();
  first.messages.length = 0; await save();
  assert.equal((await first.next()).policy.config.banner, null);
  assert.equal((await first.next(message => message.policy?.config.banner?.text === 'Instant banner')).policy.config.banner.text, 'Instant banner');
  assert.equal((await first.next()).policy.config.banner, null);
  console.log('PASS Scheduled banner starts and ends, IP block expires without another admin action');

  const state = await (await request(mf, '/api/state', auth)).json();
  first.messages.length = 0;
  await action({ action: 'restore', id: state.snapshots.at(-1).id, revision, password: testPassword, code: await code() });
  assert.equal((await first.next()).policy.config.banner, null);
  await action({ action: 'import', revision, password: testPassword, code: await code(1), backup: { format: 'textpen-settings-v1', settings: auth.state.settings, blocks: [{ ip: '198.51.100.20', reason: 'private', expires: '' }] } });
  assert.equal((await first.next()).policy.mode, 'blocked');
  await action({ action: 'unblock', ip: '198.51.100.20' }); assert.equal((await first.next()).policy.mode, 'open');
  console.log('PASS Restore and atomic import push final policy, including imported blocks; unblocking restores live access');

  for (const [path, origin, expected] of [['/', 'https://evil.test', 403], ['/control/private', publicBase, 404]]) {
    const response = await mf.dispatchFetch(publicBase + '/__site/live?path=' + encodeURIComponent(path), { headers: { Upgrade: 'websocket', Origin: origin, 'CF-Connecting-IP': '198.51.100.20' } });
    assert.equal(response.status, expected);
  }
  console.log('PASS Cross-origin subscriptions and non-public paths rejected');
} finally {
  for (const socket of connections) { try { socket.close(1000); } catch { /* already closed */ } }
  await mf.dispose();
}
