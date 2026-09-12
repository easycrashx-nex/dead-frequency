import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAccountStore } from '../server/account-store.js';
import { createAccountApi } from '../server/account-api.js';

async function fixture(t) {
  const store = createAccountStore({ path: ':memory:' }), clock = { value: 100000 }, calls = [], states = new Map();
  const rooms = {
    status: () => ({ invite: 'PRIVATE-OWNER-INVITE', profile: 'PRIVATE-PROFILE' }),
    publicStatus: id => { calls.push({ method: 'publicStatus', id }); return states.get(id) ?? null; },
    invitations: user => [{ invitationId: 'one-time-id', from: { id: 'e'.repeat(32), username: 'Friend' }, receiver: user.id }],
    list: user => { calls.push({ method: 'list', user }); return { rooms: [{ roomId: 'public-room' }], room: null, capacity: { used: 1, maximum: 2 } }; },
  };
  for (const method of ['create', 'join', 'leave', 'invite', 'respondInvitation']) rooms[method] = (user, body) => {
    calls.push({ method, user, body }); return method === 'join' || method === 'respondInvitation' && body.accept ? { roomId: 'room', ticket: 'admission' } : { ok: true };
  };
  const api = createAccountApi({ store, rooms, now: () => clock.value });
  const server = createServer(async (req, res) => { if (!await api(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, token, body, method) => {
    const response = await fetch(base + route, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const user = username => store.register(username, 'social-test-password-123');
  return { store, clock, calls, states, request, user };
}

test('social and friendship routes require authentication and never expose another account profile', async t => {
  const f = await fixture(t), a = await f.user('Alice'), b = await f.user('Bobby');
  assert.equal((await f.request('/api/social')).status, 401);
  assert.equal((await f.request('/api/friends/request', null, { username: 'Bobby' })).status, 401);
  const sent = await f.request('/api/friends/request', a.token, { username: 'Bobby' });
  assert.equal(sent.status, 200); assert.equal(sent.data.result, true); assert.deepEqual(sent.data.social.outgoing, [b.user]);
  assert.equal((await f.request('/api/friends/respond', a.token, { userId: b.user.id, accept: true })).status, 404);
  const accepted = await f.request('/api/friends/respond', b.token, { userId: a.user.id, accept: true });
  assert.equal(accepted.status, 200); assert.equal(accepted.data.social.friends[0].username, 'Alice');
  const state = (await f.request(`/api/social?userId=${b.user.id}`, a.token)).data;
  assert.equal(state.friends[0].id, b.user.id); assert.equal(state.invitations[0].receiver, a.user.id);
  const encoded = JSON.stringify(state); assert.equal(encoded.includes('PRIVATE'), false); assert.equal(encoded.includes(a.token), false); assert.equal(encoded.includes(b.token), false);
  assert.equal((await f.request('/api/friends/remove', a.token, { userId: b.user.id })).status, 200);
  assert.deepEqual((await f.request('/api/social', b.token)).data.friends, []);
});

test('friend presence expires after 45 seconds and safe active room summaries override stale HTTP presence', async t => {
  const f = await fixture(t), a = await f.user('Observer'), b = await f.user('VisibleFriend');
  f.store.requestFriend(a.user.id, b.user.username); f.store.respondFriend(b.user.id, a.user.id, true);
  const friend = async () => (await f.request('/api/social', a.token)).data.friends[0];
  assert.equal((await friend()).status, 'offline');
  await f.request('/api/me', b.token); assert.equal((await friend()).status, 'online');
  f.clock.value += 44999; assert.equal((await friend()).status, 'online');
  f.clock.value++; assert.equal((await friend()).status, 'offline');
  f.states.set(b.user.id, { roomId: 'room', phase: 'lobby', mode: 'coop', invite: 'SECRET', ticket: 'SECRET', profile: { credits: 9000 },
    host: { ...b.user, token: 'SECRET' }, players: [{ ...b.user, loadout: 'SECRET' }] });
  let current = await friend(); assert.equal(current.status, 'lobby'); assert.equal(JSON.stringify(current).includes('SECRET'), false);
  f.states.get(b.user.id).phase = 'raid'; assert.equal((await friend()).status, 'raid');
  f.states.get(b.user.id).phase = 'error'; assert.equal((await friend()).status, 'online');
  f.states.delete(b.user.id); assert.equal((await friend()).status, 'offline');
  await f.request('/api/me', b.token); await f.request('/api/auth/logout', b.token, {}); assert.equal((await friend()).status, 'offline');
  assert.ok(f.calls.filter(call => call.method === 'publicStatus').every(call => call.id === b.user.id));
});

test('social mutation bodies are exact, friend search is by full name and mutations are rate limited', async t => {
  const f = await fixture(t), a = await f.user('ExactName'), b = await f.user('SecondPlayer');
  for (const [route, body] of [
    ['/api/friends/request', { username: b.user.username, profile: { credits: 100 } }],
    ['/api/friends/request', { username: {} }], ['/api/friends/request', {}],
    ['/api/friends/respond', { userId: b.user.id, accept: 'true' }],
    ['/api/friends/respond', { userId: b.user.id }], ['/api/friends/remove', { userId: 'bad-id' }],
  ]) assert.equal((await f.request(route, a.token, body)).status, 400);
  assert.equal((await f.request('/api/friends/request', a.token, { username: 'Second' })).status, 404);
  assert.equal((await f.request('/api/friends', a.token)).status, 405);
  let response;
  for (let i = 0; i < 21; i++) response = await f.request('/api/friends/request', b.token, { username: a.user.username });
  assert.equal(response.status, 429); assert.equal(f.store.social(b.user.id).outgoing.length, 1);
});

test('room browser and friend invitations use authenticated identity and preserve legacy invitation joins', async t => {
  const f = await fixture(t), a = await f.user('RoomOwner'), b = await f.user('RoomFriend');
  const browser = await f.request('/api/rooms', a.token); assert.equal(browser.status, 200); assert.deepEqual(browser.data.rooms, [{ roomId: 'public-room' }]);
  assert.deepEqual(f.calls.find(call => call.method === 'list').user, a.user);
  const actions = [
    ['/api/rooms/create', { mode: 'coop', visibility: 'friends' }, 'create'],
    ['/api/rooms/join', { roomId: 'public-room', loadout: { mode: 'preset', presetId: 'scout' } }, 'join'],
    ['/api/rooms/join', { invite: 'wss://example.test/coop?token=legacy' }, 'join'],
    ['/api/rooms/invite', { userId: b.user.id }, 'invite'],
    ['/api/rooms/invitation', { invitationId: 'invite-id', accept: true, loadout: { mode: 'preset' } }, 'respondInvitation'],
    ['/api/rooms/invitation', { invitationId: 'invite-id', accept: false }, 'respondInvitation'],
  ];
  for (const [route, body, method] of actions) {
    const response = await f.request(route, a.token, body); assert.equal(response.status, 200);
    assert.deepEqual(f.calls.at(-1), { method, user: a.user, body });
  }
  for (const [route, body] of [
    ['/api/rooms/create', { visibility: 'hidden' }], ['/api/rooms/create', { loadout: [] }],
    ['/api/rooms/join', { roomId: 'one', invite: 'two' }], ['/api/rooms/join', {}],
    ['/api/rooms/invite', { userId: 'invalid' }], ['/api/rooms/invite', { userId: b.user.id, profile: {} }],
    ['/api/rooms/invitation', { invitationId: {}, accept: true }], ['/api/rooms/invitation', { invitationId: 'id', accept: 1 }],
  ]) assert.equal((await f.request(route, a.token, body)).status, 400);
});
