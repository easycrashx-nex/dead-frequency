import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAccountStore } from '../server/account-store.js';
import { createAdminStore } from '../server/admin-store.js';
import { createAdminApi } from '../server/admin-api.js';
import { createAccountApi } from '../server/account-api.js';

const password = 'api-admin-password-123';
async function fixture(t, roomOverrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'df-admin-api-')), path = join(directory, 'accounts.sqlite'), clock = { value: 100000 };
  const accounts = createAccountStore({ path, now: () => clock.value }), admins = createAdminStore({ path, accounts, now: () => clock.value }), calls = [], errors = [], states = new Map();
  const rooms = { publicStatus: id => states.get(id) ?? null, status: () => null, adminOverview: () => ({ rooms: [], maxRooms: 2 }),
    adminAction: async (action, payload) => { calls.push({ action, payload }); return { changed: true }; }, ...roomOverrides };
  const adminApi = createAdminApi({ store: admins, rooms, version: 'test', now: () => clock.value, onError: e => errors.push(e.message) }), gameApi = createAccountApi({ store: accounts, rooms });
  const server = createServer(async (req, res) => { if (!await adminApi(req, res) && !await gameApi(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); admins.close(); accounts.close(); rmSync(directory, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, token, body, headers = {}) => {
    const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST', headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json(), headers: response.headers };
  };
  const provision = async () => { await admins.setupAdmin('ControlAdmin', password); return (await request('/api/admin/login', null, { username: 'ControlAdmin', password })).data; };
  return { admins, accounts, clock, calls, errors, states, request, provision, origin };
}

test('admin HTTP requires its own provisioned credentials and tokens; ordinary account auth cannot cross the boundary', async t => {
  const f = await fixture(t), user = await f.accounts.register('ControlAdmin', password);
  assert.equal((await f.request('/api/admin/overview')).status, 401);
  assert.equal((await f.request('/api/admin/overview', user.token)).status, 401);
  assert.equal((await f.request('/api/admin/login', null, { username: 'ControlAdmin', password })).status, 401);
  const login = await f.provision(); assert.match(login.token, /^[a-f0-9]{64}$/);
  const me = await f.request('/api/admin/me', login.token); assert.deepEqual(me.data, { admin: { username: 'ControlAdmin' }, expiresAt: login.expiresAt });
  assert.equal((await f.request('/api/me', login.token)).status, 401);
  assert.equal((await f.request('/api/admin/catalog', login.token)).data.items.length, 201);
  assert.equal((await f.request('/api/admin/overview', login.token)).data.server.version, 'test');
  assert.equal((await f.request('/api/admin/player', login.token, { username: 'controladmin' })).data.player.profile.credits, 750);
});

test('admin login is throttled and error bodies never reveal implementation details', async t => {
  const f = await fixture(t); let result;
  for (let i = 0; i < 11; i++) result = await f.request('/api/admin/login', null, { username: 'Nobody', password });
  assert.equal(result.status, 429); assert.equal(result.headers.get('retry-after'), '60');
  assert.equal(JSON.stringify(result.data).includes(password), false); assert.equal(JSON.stringify(result.data).includes('scrypt'), false);
});

test('strict admin action fields reject unknown methods, extra grants, arbitrary coordinates and origin/body attacks', async t => {
  const f = await fixture(t), login = await f.provision(), user = await f.accounts.register('Player', password);
  for (const body of [
    { action: 'eval', payload: { code: 'secret' }, requestId: 'bad-action' },
    { action: { toString: null }, payload: {}, requestId: 'bad-action-type' },
    { action: 'credits-add', payload: { userId: user.user.id, amount: 1, profile: {} }, requestId: 'bad-extra' },
    { action: 'credits-add', payload: { userId: user.user.id, amount: 1e100 }, requestId: 'bad-amount' },
    { action: 'teleport-spawn', payload: { userId: user.user.id, x: 1, z: 2 }, requestId: 'bad-teleport' },
    { action: 'heal', payload: { userId: user.user.id } },
    { action: 'godmode', payload: { userId: user.user.id, enabled: 'true' }, requestId: 'bad-toggle' },
  ]) assert.equal((await f.request('/api/admin/action', login.token, body)).status, 400);
  assert.equal((await f.request('/api/admin/overview', login.token, undefined, { origin: 'https://attacker.example' })).status, 403);
  assert.equal((await f.request('/api/admin/player', login.token, { username: 'x'.repeat(33000) })).status, 413);
  assert.equal(f.accounts.getProfile(user.user.id).credits, 750); assert.deepEqual(f.calls, []);
  const audit = JSON.stringify(f.admins.audit()); assert.equal(audit.includes('secret'), false); assert.equal(audit.includes('profile'), false);
  assert.deepEqual(f.errors, []);
});

test('idempotent persistent actions grant once and reject request-ID reuse for a different operation', async t => {
  const f = await fixture(t), login = await f.provision(), user = await f.accounts.register('GrantTarget', password);
  const body = { action: 'credits-add', payload: { userId: user.user.id, amount: 100 }, requestId: 'grant-once-123' };
  const results = await Promise.all([f.request('/api/admin/action', login.token, body), f.request('/api/admin/action', login.token, body)]);
  assert.ok(results.every(r => r.status === 200)); assert.deepEqual(results[0].data, results[1].data);
  assert.equal(f.accounts.getProfile(user.user.id).credits, 850);
  assert.equal((await f.request('/api/admin/action', login.token, { ...body, payload: { ...body.payload, amount: 500 } })).status, 409);
  assert.equal(f.admins.audit().filter(event => event.action === 'credits-add' && event.result === 'success').length, 1);
});

test('concurrent retry of asynchronous live actions shares one execution and logs a safe result', async t => {
  let release, count = 0;
  const f = await fixture(t, { adminAction: async () => { count++; await new Promise(resolve => { release = resolve; }); return { changed: true }; } });
  const login = await f.provision(), user = await f.accounts.register('LivePlayer', password);
  const body = { action: 'heal', payload: { userId: user.user.id }, requestId: 'live-heal-once' };
  const first = f.request('/api/admin/action', login.token, body);
  while (!release) await new Promise(resolve => setTimeout(resolve, 1));
  const second = f.request('/api/admin/action', login.token, body); await new Promise(resolve => setTimeout(resolve, 15)); release();
  assert.deepEqual((await first).data, (await second).data); assert.equal(count, 1);
  assert.equal(f.admins.audit().filter(event => event.action === 'heal').length, 1);
});

test('ban and session revocation kick active users after durable restriction, while profiles stay protected in a raid', async t => {
  const f = await fixture(t), login = await f.provision(), user = await f.accounts.register('ActivePlayer', password);
  f.accounts.acquireRoom(user.user.id, 'active'); f.states.set(user.user.id, { roomId: 'active', phase: 'raid' });
  const action = (name, payload) => f.request('/api/admin/action', login.token, { action: name, payload: { userId: user.user.id, ...payload }, requestId: `request-${name}` });
  assert.equal((await action('credits-add', { amount: 50 })).status, 409);
  assert.equal((await action('account-ban', { reason: 'Test moderation' })).status, 200);
  assert.deepEqual(f.calls, [{ action: 'kick', payload: { userId: user.user.id } }]);
  assert.equal(f.accounts.authenticate(user.token), null); assert.equal(f.accounts.getProfile(user.user.id).credits, 750);
  assert.equal((await f.request('/api/admin/me', login.token)).status, 200);
});

test('logout, expiry and local credential rotation invalidate retries and cached action authorization', async t => {
  const f = await fixture(t), login = await f.provision(), user = await f.accounts.register('ExpiryPlayer', password);
  const body = { action: 'credits-add', payload: { userId: user.user.id, amount: 10 }, requestId: 'expiry-request' };
  assert.equal((await f.request('/api/admin/action', login.token, body)).status, 200);
  await f.request('/api/admin/logout', login.token, {}); assert.equal((await f.request('/api/admin/action', login.token, body)).status, 401);
  const rotated = await f.provision(); f.clock.value = rotated.expiresAt;
  assert.equal((await f.request('/api/admin/overview', rotated.token)).status, 401);
  assert.equal(f.accounts.getProfile(user.user.id).credits, 760);
});

test('a delayed POST body cannot execute after its already-checked administrator session is revoked or expires', async t => {
  const f = await fixture(t), user = await f.accounts.register('DelayedTarget', password);
  for (const mode of ['logout', 'rotation', 'expiry']) {
    const login = await f.provision(), authenticate = f.admins.authenticate;
    let authorized;
    const seen = new Promise(resolve => { authorized = resolve; });
    f.admins.authenticate = token => { const admin = authenticate(token); authorized(); return admin; };
    let pending;
    const finished = new Promise((resolve, reject) => {
      pending = httpRequest(f.origin + '/api/admin/action', { method: 'POST', headers: { authorization: `Bearer ${login.token}`, 'content-type': 'application/json' } }, response => {
        let data = ''; response.setEncoding('utf8'); response.on('data', chunk => { data += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, data: JSON.parse(data) }));
      });
      pending.on('error', reject); pending.write('{');
    });
    await seen; f.admins.authenticate = authenticate;
    if (mode === 'logout') f.admins.logout(login.token);
    else if (mode === 'rotation') await f.admins.setupAdmin('ControlAdmin', password);
    else f.clock.value = login.expiresAt;
    pending.end(JSON.stringify({ action: 'credits-add', payload: { userId: user.user.id, amount: 100 }, requestId: `delayed-${mode}` }).slice(1));
    assert.equal((await finished).status, 401, mode);
    assert.equal(f.accounts.getProfile(user.user.id).credits, 750);
  }
  assert.deepEqual(f.calls, []);
});

test('banned or session-revoked players cannot finish an already authenticated room admission request', async t => {
  let admissions = 0;
  const f = await fixture(t, { create: async () => { admissions++; return { ticket: 'must-not-be-issued' }; } }), login = await f.provision();
  for (const action of ['account-ban', 'sessions-revoke']) {
    const user = await f.accounts.register(`Delayed-${action}`, password), authenticate = f.accounts.authenticate;
    let authorized;
    const seen = new Promise(resolve => { authorized = resolve; });
    f.accounts.authenticate = token => { const result = authenticate(token); authorized(); return result; };
    let pending;
    const finished = new Promise((resolve, reject) => {
      pending = httpRequest(f.origin + '/api/rooms/create', { method: 'POST', headers: { authorization: `Bearer ${user.token}`, 'content-type': 'application/json' } }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      });
      pending.on('error', reject); pending.write('{');
    });
    await seen; f.accounts.authenticate = authenticate;
    const payload = { userId: user.user.id, ...(action === 'account-ban' ? { reason: 'Moderation' } : {}) };
    assert.equal((await f.request('/api/admin/action', login.token, { action, payload, requestId: `revoke-delayed-${action}` })).status, 200);
    pending.end('"mode":"solo"}');
    assert.equal(await finished, 401, action);
  }
  assert.equal(admissions, 0);
});
