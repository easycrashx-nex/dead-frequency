import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAccountStore } from '../server/account-store.js';
import { createAccountApi } from '../server/account-api.js';

async function setup(t, options = {}) {
  const store = createAccountStore({ path: ':memory:' }), calls = [];
  const rooms = { status: id => ({ roomId: 'demo', accountId: id }),
    create: async (user, body) => { calls.push({ user, body }); return { roomId: 'room', invite: 'CODE', ticket: 'ticket' }; },
    join: async () => ({ roomId: 'room' }), leave: async () => ({ ok: true }) };
  const handler = createAccountApi({ store, rooms, version: 'test-version', ...options });
  const server = createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { body, token, method = body ? 'POST' : 'GET', headers = {} } = {}) => {
    const response = await fetch(base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  return { store, calls, request, base };
}
const credentials = { username: 'Operator', password: 'test-password-long' };

test('HTTP registration, bearer authentication, profile and logout have a narrow stable response', async t => {
  const { request } = await setup(t);
  assert.equal((await request('/api/me')).status, 401);
  const created = await request('/api/auth/register', { body: credentials }); assert.equal(created.status, 201);
  const { token, user } = created.body; assert.match(token, /^[a-f0-9]{64}$/);
  const me = await request('/api/me', { token }); assert.equal(me.status, 200); assert.deepEqual(me.body.user, user);
  assert.equal(me.body.profile.credits, 750); assert.equal(me.body.version, 'test-version'); assert.equal(me.body.room.accountId, user.id);
  assert.equal(me.headers.get('cache-control'), 'no-store');
  assert.equal(JSON.stringify(me.body).includes('password'), false);
  assert.equal((await request('/api/auth/logout', { token, body: {} })).status, 200);
  assert.equal((await request('/api/me', { token })).status, 401);
});

test('HTTP refuses forged profile updates, oversized JSON, unsupported origins and wrong methods', async t => {
  const { request } = await setup(t), created = await request('/api/auth/register', { body: credentials }), token = created.body.token;
  assert.equal((await request('/api/action', { token, body: { kind: 'economy', action: 'claimAll', args: [], profile: { credits: 99999 } } })).status, 400);
  assert.equal((await request('/api/auth/register', { body: { ...credentials, username: 'Other', profile: { credits: 99999 } } })).status, 400);
  assert.equal((await request('/api/action', { token, body: { data: 'x'.repeat(33000) } })).status, 413);
  assert.equal((await request('/api/me', { token, headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await request('/api/me', { token, headers: { Origin: 'http://localhost:5173' } })).status, 200);
  assert.equal((await request('/api/me', { token, headers: { Origin: 'null' } })).status, 200);
  assert.equal((await request('/api/auth/login')).status, 405);
  assert.equal((await request('/api/me', { token })).body.profile.credits, 750);
});

test('auth endpoint throttles attempts per IP without disclosing whether login name exists', async t => {
  const { request } = await setup(t);
  const failures = [];
  for (let i = 0; i < 21; i++) failures.push(await request('/api/auth/login', { body: { username: i % 2 ? 'Missing' : 'Unknown', password: 'invalid-password' } }));
  assert.ok(failures.slice(0, 20).every(value => value.status === 401 && value.body.code === 'login_failed'));
  assert.equal(failures[20].status, 429); assert.equal(failures[20].headers.get('retry-after'), '60');
});

test('room endpoints forward authenticated identity and supported settings, never a client profile', async t => {
  const { request, calls } = await setup(t), created = await request('/api/auth/register', { body: credentials }), token = created.body.token;
  const body = { mode: 'solo', difficulty: 'hard', loadout: { mode: 'preset', presetId: 'scout' } };
  const result = await request('/api/rooms/create', { token, body }); assert.equal(result.status, 200);
  assert.deepEqual(calls[0], { user: created.body.user, body });
  assert.equal((await request('/api/rooms/create', { token, body: { ...body, profile: { credits: 999999 } } })).status, 400);
  assert.equal((await request('/api/rooms/join', { token, body: { invite: 'CODE' } })).status, 200);
  assert.equal((await request('/api/rooms/leave', { token, body: {} })).status, 200);
  assert.equal((await request('/api/rooms', { token })).status, 200);
});

test('unexpected backend failures never expose stack traces or infrastructure internals', async t => {
  const { request } = await setup(t, { rooms: { status() { throw new Error('SECRET SQLite path /srv/private/password'); } } });
  const created = await request('/api/auth/register', { body: credentials }), result = await request('/api/me', { token: created.body.token });
  assert.equal(result.status, 500); assert.equal(result.body.code, 'server_error'); assert.equal(JSON.stringify(result.body).includes('SECRET'), false);
});
