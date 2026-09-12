import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createAccountStore } from '../server/account-store.js';
import { createCoopServer } from '../server/coop-server.js';
import { createRoomService } from '../server/rooms.js';

const version = '1.13.0';
async function fixture(t, options = {}) {
  const store = createAccountStore({ path: ':memory:' }), sockets = [], runtimes = new Map();
  const http = createServer(); await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const rooms = createRoomService({ store, publicOrigin: `http://127.0.0.1:${http.address().port}`, version, maxRooms: 8, ...options,
    async createRuntime(configuration) {
      await options.beforeRuntime?.();
      const runtime = await createCoopServer(configuration); runtimes.set(configuration.token, runtime); return runtime;
    } });
  http.on('upgrade', rooms.handleUpgrade);
  t.after(async () => { for (const socket of sockets) socket.terminate(); await rooms.close(); await new Promise(resolve => http.close(resolve)); store.close(); });
  const user = async name => (await store.register(name, 'isolated-social-test-password')).user;
  const friend = (a, b) => { store.requestFriend(a.id, b.username); store.respondFriend(b.id, a.id, true); };
  async function connect(admission, fields = {}, expectFailure = false) {
    const socket = new WebSocket(admission.url), received = [];
    sockets.push(socket); socket.on('error', () => {}); socket.on('message', data => received.push(JSON.parse(data)));
    await once(socket, 'open'); socket.send(JSON.stringify({ type: 'join', version, protocol: 1, ticket: admission.ticket, ...fields }));
    const deadline = Date.now() + 8000;
    while (!received.some(message => message.type === (expectFailure ? 'error' : 'welcome'))) {
      if (expectFailure && socket.readyState === WebSocket.CLOSED) break;
      assert.ok(Date.now() < deadline, 'Account ticket did not receive a welcome');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return { socket, id: received.find(message => message.type === 'welcome')?.id, received };
  }
  return { store, rooms, user, friend, connect, runtime: admission => runtimes.get(new URL(admission.url).searchParams.get('token')) };
}
const safe = value => {
  const json = JSON.stringify(value);
  assert.doesNotMatch(json, /"(?:token|ticket|invite|url|profile|loadout)"|\/coop\?token=|[a-f0-9]{64}/i);
};

test('discovery lists only initialized public open coop rooms and exposes no admission secrets', async t => {
  const f = await fixture(t), host = await f.user('PublicHost'), privateHost = await f.user('FriendsHost'), solo = await f.user('SoloHost'), viewer = await f.user('Viewer');
  const opened = await f.rooms.create(host, { difficulty: 'hard' });
  await f.rooms.create(privateHost, { visibility: 'friends' }); await f.rooms.create(solo, { mode: 'solo' });
  const listing = f.rooms.list(viewer);
  assert.equal(listing.rooms.length, 1); assert.equal(listing.room, null); assert.deepEqual(listing.capacity, { rooms: 3, maxRooms: 8 });
  const row = listing.rooms[0]; safe(row);
  assert.deepEqual(row, { roomId: opened.roomId, mode: 'coop', phase: 'lobby', visibility: 'public', host,
    players: [host], playerCount: 1, maxPlayers: 2, difficulty: 'hard', version, createdAt: row.createdAt, joinable: true });
  assert.deepEqual([opened.visibility, opened.difficulty, opened.phase], ['public', 'hard', 'lobby']);
  row.host.username = 'Changed'; row.players[0].username = 'Changed';
  assert.equal(f.rooms.publicStatus(host.id).host.username, host.username);
  assert.equal(f.rooms.status(host.id).visibility, 'public');
  assert.equal(f.rooms.publicStatus(solo.id).visibility, 'private'); safe(f.rooms.publicStatus(solo.id));
  await f.rooms.join(viewer, { roomId: opened.roomId });
  assert.equal(f.rooms.list(host).rooms.length, 0, 'An HTTP reservation immediately removes a full room from discovery');
  f.rooms.leave(viewer); assert.equal(f.rooms.list(viewer).rooms.length, 1);
  assert.throws(() => f.rooms.list(null), /Anmeldung/);
});

test('an initializing room counts against capacity but cannot be discovered or joined', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { beforeRuntime: () => gate }), host = await f.user('LoadingHost'), viewer = await f.user('LoadingViewer');
  const pending = f.rooms.create(host);
  assert.equal(f.rooms.list(viewer).capacity.rooms, 1); assert.deepEqual(f.rooms.list(viewer).rooms, []);
  const hidden = f.rooms.publicStatus(host.id); assert.equal(hidden.joinable, false); safe(hidden);
  await assert.rejects(f.rooms.join(viewer, { roomId: hidden.roomId }), /nicht mehr verfügbar/);
  release(); await pending; assert.equal(f.rooms.list(viewer).rooms.length, 1);
});

test('friends-only room IDs and legacy invite URLs both enforce current accepted friendship', async t => {
  const f = await fixture(t), host = await f.user('ProtectedHost'), accepted = await f.user('Accepted'), pending = await f.user('PendingFriend');
  f.friend(host, accepted); f.store.requestFriend(host.id, pending.username);
  const room = await f.rooms.create(host, { visibility: 'friends' });
  assert.equal(f.rooms.list(accepted).rooms.length, 0);
  await assert.rejects(f.rooms.join(pending, { roomId: room.roomId }), error => error.status === 403);
  await assert.rejects(f.rooms.join(pending, { invite: room.invite }), error => error.status === 403);
  await f.store.action(pending.id, { kind: 'economy', action: 'storeAll', args: [] });
  const admission = await f.rooms.join(accepted, { invite: room.invite }); assert.equal(admission.visibility, 'friends');
  f.rooms.leave(accepted); f.store.removeFriend(host.id, accepted.id);
  await assert.rejects(f.rooms.join(accepted, { roomId: room.roomId }), error => error.status === 403);
  await assert.rejects(f.rooms.join(accepted, { roomId: room.roomId, invite: room.invite }), error => error.status === 400);
  await assert.rejects(f.rooms.create(pending, { visibility: 'everyone' }), error => error.status === 400);
});

test('friend invitations are private, refreshed without duplication and recipient-controlled', async t => {
  let now = 100000;
  const f = await fixture(t, { clock: () => now }), host = await f.user('InviteHost'), friend = await f.user('InviteFriend'), stranger = await f.user('Stranger');
  f.friend(host, friend);
  await f.rooms.create(host, { visibility: 'friends', difficulty: 'hard' });
  assert.throws(() => f.rooms.invite(host, { userId: host.id }), error => error.status === 400);
  assert.throws(() => f.rooms.invite(host, { userId: stranger.id }), error => error.status === 403);
  assert.throws(() => f.rooms.invite(friend, { userId: host.id }), /Nur der Host/);
  assert.deepEqual(f.rooms.invite(host, { userId: friend.id }), { ok: true });
  const first = f.rooms.invitations(friend)[0]; safe(first); assert.equal(first.from.id, host.id); assert.equal(first.difficulty, 'hard');
  assert.deepEqual(f.rooms.invitations(host), []); assert.deepEqual(f.rooms.invitations(stranger), []);
  now += 100; f.rooms.invite(host, { userId: friend.id });
  const refreshed = f.rooms.invitations(friend); assert.equal(refreshed.length, 1); assert.equal(refreshed[0].id, first.id); assert.equal(refreshed[0].expiresAt, now + 120000);
  await assert.rejects(f.rooms.respondInvitation(stranger, { invitationId: first.id, accept: false }), error => error.status === 404);
  await assert.rejects(f.rooms.respondInvitation(friend, { invitationId: first.id, accept: 'true' }), error => error.status === 400);
  assert.equal(f.rooms.invitations(friend).length, 1);
  assert.deepEqual(await f.rooms.respondInvitation(friend, { invitationId: first.id, accept: false }), { ok: true });
  assert.deepEqual(f.rooms.invitations(friend), []);
  await assert.rejects(f.rooms.respondInvitation(friend, { invitationId: first.id, accept: true }), error => error.status === 404);
});

test('acceptance reserves only one place, returns a valid account ticket and invalidates competing invites', async t => {
  const f = await fixture(t), host = await f.user('RaceHost'), first = await f.user('RaceOne'), second = await f.user('RaceTwo');
  f.friend(host, first); f.friend(host, second);
  const room = await f.rooms.create(host, { visibility: 'friends' }); await f.connect(room);
  f.rooms.invite(host, { userId: first.id }); f.rooms.invite(host, { userId: second.id });
  await f.store.action(first.id, { kind: 'economy', action: 'storeAll', args: [] });
  const a = f.rooms.invitations(first)[0], b = f.rooms.invitations(second)[0];
  const attempts = await Promise.allSettled([
    f.rooms.respondInvitation(first, { invitationId: a.id, accept: true }),
    f.rooms.respondInvitation(second, { invitationId: b.id, accept: true }),
  ]);
  assert.deepEqual(attempts.map(value => value.status), ['fulfilled', 'rejected']);
  const connected = await f.connect(attempts[0].value);
  assert.equal(f.runtime(room).session.players.get(connected.id).name, first.username);
  assert.equal(f.rooms.publicStatus(host.id).playerCount, 2); assert.equal(f.rooms.publicStatus(host.id).joinable, false);
  assert.deepEqual(f.rooms.invitations(second), []);
  assert.equal(f.rooms.status(second.id), null);
  f.rooms.leave(first);
  await assert.rejects(f.rooms.respondInvitation(second, { invitationId: b.id, accept: true }), error => error.status === 404);
  assert.deepEqual(f.rooms.invitations(second), [], 'A full lobby invalidation must not revive when a slot later opens');
});

test('expired, revoked, closed and started-room invitations disappear without leaving account locks', async t => {
  let now = 100000;
  const f = await fixture(t, { clock: () => now }), host = await f.user('ExpiryHost'), friend = await f.user('ExpiryFriend');
  f.friend(host, friend); const room = await f.rooms.create(host); const hc = await f.connect(room);
  f.rooms.invite(host, { userId: friend.id }); now += 120001;
  assert.deepEqual(f.rooms.invitations(friend), []);
  f.rooms.invite(host, { userId: friend.id }); f.store.removeFriend(host.id, friend.id);
  assert.deepEqual(f.rooms.invitations(friend), []);
  f.friend(host, friend); f.rooms.invite(host, { userId: friend.id });
  const target = f.rooms.invitations(friend)[0];
  const guest = await f.rooms.respondInvitation(friend, { invitationId: target.id, accept: true }), gc = await f.connect(guest);
  const runtime = f.runtime(room); runtime.session.ready(hc.id, true); runtime.session.ready(gc.id, true); runtime.session.start(hc.id);
  assert.deepEqual(f.rooms.invitations(friend), []); assert.equal(f.rooms.publicStatus(host.id).phase, 'raid'); assert.equal(f.rooms.list(friend).rooms.length, 0);
  safe(f.rooms.publicStatus(host.id));
  await assert.rejects(f.rooms.respondInvitation(friend, { invitationId: target.id, accept: true }), error => error.status === 404);
  f.rooms.leave(host); f.rooms.leave(friend);
  await new Promise(resolve => setTimeout(resolve, 20));
  const next = await f.rooms.create(host); await f.connect(next); f.rooms.invite(host, { userId: friend.id });
  f.rooms.leave(host); assert.deepEqual(f.rooms.invitations(friend), []);
  await f.store.action(friend.id, { kind: 'economy', action: 'storeAll', args: [] });
});

test('host migration applies the new owner friendship rules and old owner cannot send further invites', async t => {
  const f = await fixture(t), host = await f.user('OldHost'), next = await f.user('NewHost'), oldFriend = await f.user('OldHostFriend');
  f.friend(host, next); f.friend(host, oldFriend);
  const room = await f.rooms.create(host, { visibility: 'friends' }); await f.connect(room);
  f.rooms.invite(host, { userId: oldFriend.id });
  const joined = await f.rooms.join(next, { roomId: room.roomId }); const nc = await f.connect(joined);
  f.rooms.leave(host);
  assert.equal(f.runtime(room).session.hostId, nc.id); assert.equal(f.rooms.publicStatus(next.id).host.id, next.id);
  assert.deepEqual(f.rooms.invitations(oldFriend), []);
  await assert.rejects(f.rooms.join(oldFriend, { invite: room.invite }), error => error.status === 403);
  assert.throws(() => f.rooms.invite(host, { userId: oldFriend.id }), /Nur der Host/);
  f.friend(next, oldFriend); f.rooms.invite(next, { userId: oldFriend.id });
  assert.equal(f.rooms.invitations(oldFriend)[0].from.id, next.id);
  const accepted = await f.rooms.respondInvitation(oldFriend, { invitationId: f.rooms.invitations(oldFriend)[0].id, accept: true });
  assert.equal(accepted.roomId, room.roomId);
});

test('ephemeral invitations remain bounded at 100; duplicate refresh and expired cleanup free no extra reservations', async t => {
  let now = 100000;
  const f = await fixture(t, { clock: () => now }), host = await f.user('BoundedHost');
  await f.rooms.create(host);
  const targets = Array.from({ length: 101 }, (_, index) => ({ id: (index + 1).toString(16).padStart(32, '0'), username: `Friend${index}` }));
  // Isolate the independent ephemeral queue limit from the store's separately tested friendship limit.
  f.store.areFriends = () => true;
  for (const target of targets.slice(0, 100)) f.rooms.invite(host, { userId: target.id });
  assert.throws(() => f.rooms.invite(host, { userId: targets[100].id }), error => error.status === 429);
  const before = f.rooms.invitations(targets[0])[0]; now += 100;
  f.rooms.invite(host, { userId: targets[0].id }); assert.equal(f.rooms.invitations(targets[0])[0].id, before.id);
  now += 120001; assert.deepEqual(f.rooms.invitations(targets[0]), []);
  f.rooms.invite(host, { userId: targets[100].id }); assert.equal(f.rooms.invitations(targets[100]).length, 1);
  assert.equal(f.rooms.publicStatus(host.id).playerCount, 1, 'Notifications never reserve raid slots');
});

test('1.13 rooms explicitly admit published 1.12 clients, reject other versions and retain the protocol check', async t => {
  const f = await fixture(t), host = await f.user('PreviousClient'), guest = await f.user('CurrentClient');
  const room = await f.rooms.create(host), hc = await f.connect(room, { version: '1.12.0' });
  assert.equal(hc.received.find(message => message.type === 'welcome').version, '1.13.0');
  const admission = await f.rooms.join(guest, { invite: room.invite });
  const wrongVersion = await f.connect(admission, { version: '1.11.0' }, true);
  assert.match(wrongVersion.received.find(message => message.type === 'error').message, /Spielversion/);
  const wrongProtocol = await f.connect(admission, { version: '1.12.0', protocol: 2 }, true);
  assert.match(wrongProtocol.received.find(message => message.type === 'error').message, /Protokoll/);
  const gc = await f.connect(admission);
  const runtime = f.runtime(room); runtime.session.ready(hc.id, true); runtime.session.ready(gc.id, true); runtime.session.start(hc.id);
  assert.equal(runtime.session.phase, 'raid'); assert.equal(runtime.session.players.size, 2);
  const strict = await createCoopServer({ version: '1.13.0' }); t.after(() => strict.close());
  const socket = new WebSocket(`ws://127.0.0.1:${strict.port}/coop?token=${strict.token}`); socket.on('error', () => {}); t.after(() => socket.terminate());
  await once(socket, 'open');
  const response = once(socket, 'message'); socket.send(JSON.stringify({ type: 'join', protocol: 1, version: '1.12.0' }));
  assert.match(JSON.parse((await response)[0]).message, /Spielversion/, 'Unconfigured runtimes retain exact version matching');
});

for (const duringInitialization of [false, true]) test(`friends-only admission rechecks removal ${duringInitialization ? 'during world initialization' : 'after reservation before ticket use'} and releases the rejected reservation`, async t => {
  const f = await fixture(t), host = await f.user('RecheckHost'), formerFriend = await f.user('RecheckFriend');
  f.friend(host, formerFriend);
  const room = await f.rooms.create(host, { visibility: 'friends' }); await f.connect(room);
  const admission = await f.rooms.join(formerFriend, { roomId: room.roomId });
  if (duringInitialization) {
    const original = f.store.getProfile;
    f.store.getProfile = id => {
      const profile = original(id);
      if (id === formerFriend.id) queueMicrotask(() => f.store.removeFriend(host.id, formerFriend.id));
      return profile;
    };
  } else f.store.removeFriend(host.id, formerFriend.id);
  const rejected = await f.connect(admission, {}, true);
  assert.equal(rejected.id, undefined); assert.equal(rejected.received.some(message => message.type === 'welcome'), false);
  assert.equal(f.rooms.status(formerFriend.id), null);
  await f.store.action(formerFriend.id, { kind: 'economy', action: 'storeAll', args: [] });
  assert.equal(f.rooms.publicStatus(host.id).playerCount, 1);
  assert.equal(f.runtime(room).session.players.size, 1);
});
