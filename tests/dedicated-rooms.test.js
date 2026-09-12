import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { createRoomService } from '../server/rooms.js';
import { createCoopServer } from '../server/coop-server.js';
import { createAccountStore } from '../server/account-store.js';
import { createAccountApi } from '../server/account-api.js';
import { EXTRACTIONS } from '../src/layout.js';
import { resolveLoadout } from '../src/loadouts.js';
import { ownedProfile } from './loadout-helpers.js';

const version = '1.12.0';
const preset = presetId => ({ mode: 'preset', presetId });
const advance = (runtime, seconds) => { for (let i = 0; i < seconds * 60; i++) runtime.session.update(1 / 60); };
async function fixture(t, options = {}) {
  const store = createAccountStore({ path: ':memory:' }), runtimes = new Map(), clients = [], errors = [];
  const http = createServer((req, res) => { api(req, res).then(handled => { if (!handled) { res.statusCode = 404; res.end(); } }); });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${http.address().port}`;
  const rooms = createRoomService({ store, publicOrigin: origin, version, onError: error => errors.push(error), ...options,
    async createRuntime(configuration) { const runtime = await createCoopServer(configuration); runtimes.set(configuration.token, runtime); return runtime; } });
  const api = createAccountApi({ store, rooms, version });
  http.on('upgrade', rooms.handleUpgrade);
  t.after(async () => { for (const ws of clients) ws.terminate(); await rooms.close(); await new Promise(resolve => http.close(resolve)); store.close(); });
  async function connect(admission, fields = {}) {
    const ws = new WebSocket(admission.url); clients.push(ws);
    const queue = [], waiters = [], received = [];
    ws.on('error', () => {});
    ws.on('message', data => {
      const message = JSON.parse(data), index = waiters.findIndex(waiter => waiter.predicate(message)); received.push(message);
      if (index === -1) queue.push(message);
      else { const waiter = waiters.splice(index, 1)[0]; clearTimeout(waiter.timeout); waiter.resolve(message); }
    });
    const client = { ws, received, send: value => ws.send(JSON.stringify(value)),
      wait(predicate) {
        const index = queue.findIndex(predicate);
        if (index !== -1) return Promise.resolve(queue.splice(index, 1)[0]);
        return new Promise((resolve, reject) => {
          const waiter = { predicate, resolve, timeout: setTimeout(() => { waiters.splice(waiters.indexOf(waiter), 1); reject(new Error('Timed out waiting for dedicated snapshot')); }, 6000) };
          waiters.push(waiter);
        });
      } };
    await once(ws, 'open');
    client.send({ type: 'join', protocol: 1, version, ticket: admission.ticket, ...fields });
    return client;
  }
  const account = async name => store.register(name, 'a-password-only-for-tests');
  const runtimeFor = admission => runtimes.get(new URL(admission.url).searchParams.get('token'));
  return { store, rooms, account, connect, runtimeFor, errors, origin };
}

test('room tickets enforce authenticated server profiles and cannot be reused or replaced by a shared invite', async t => {
  const f = await fixture(t), account = await f.account('RealOperator');
  const room = await f.rooms.create(account.user, { mode: 'coop' });
  await assert.rejects(f.rooms.create(null, {}), /Anmeldung/);
  const forged = await f.connect({ ...room, ticket: undefined }, { name: 'Admin', profile: { credits: 999999 } });
  await once(forged.ws, 'close');
  assert.equal(f.runtimeFor(room).session.players.size, 0);
  const good = await f.connect(room, { name: 'Admin', profile: { credits: 999999, upgrades: { armor: 3 } } });
  const welcome = await good.wait(m => m.type === 'welcome'), snapshot = await good.wait(m => m.type === 'snapshot');
  assert.equal(snapshot.state.profile.credits, account.profile.credits);
  assert.deepEqual(snapshot.state.profile.upgrades, account.profile.upgrades);
  assert.equal(f.runtimeFor(room).session.players.get(welcome.id).name, 'RealOperator');
  const replay = await f.connect(room); await once(replay.ws, 'close');
  assert.equal(f.runtimeFor(room).session.players.size, 1);
  await assert.rejects(f.store.action(account.user.id, { kind: 'game', action: 'selectLoadout', args: [preset('scout')] }), /bereits/);
  assert.deepEqual(f.errors, []);
});

test('solo raid commits loadout before acknowledgment and disconnect durably loses equipped items once', async t => {
  const f = await fixture(t), account = await f.account('SoloOperator');
  const owned = ownedProfile({ weapon: 'RV-6', gear: ['pack-day'], credits: 5000 });
  f.store.acquireRoom(account.user.id, 'fixture'); f.store.commitRaidStart('fixture', [{ accountId: account.user.id, profile: owned }]);
  f.store.settleRaid(account.user.id, 'fixture', owned, 'extracted');
  const before = f.store.getProfile(account.user.id), cost = resolveLoadout(before).cost;
  const room = await f.rooms.create(account.user, { mode: 'solo' }), client = await f.connect(room);
  const welcome = await client.wait(m => m.type === 'welcome');
  client.send({ type: 'ready', ready: true }); await client.wait(m => m.type === 'lobby' && m.players[0]?.ready);
  client.send({ type: 'start', difficulty: 'hard' });
  const started = await client.wait(m => m.type === 'snapshot' && m.state.phase === 'raid');
  const spent = f.store.getProfile(account.user.id);
  assert.equal(spent.credits, before.credits - cost); assert.equal(spent.raids, before.raids + 1);
  assert.equal(spent.stash.filter(i => ['weapon', 'backpack'].includes(i.kind)).length, 0);
  assert.equal(started.state.raid.difficulty, 'normal', 'HTTP room settings cannot be changed by a forged WS start');
  const runtime = f.runtimeFor(room);
  runtime.session.players.get(welcome.id).game.receiveDamage(999999, { x: 0, z: 0 });
  runtime.session.update(1 / 60);
  assert.equal(runtime.session.players.get(welcome.id).game.state.player.downed, false, 'solo has no unrevivable downed state');
  await client.wait(m => m.type === 'snapshot' && m.state.phase === 'dead');
  const after = f.store.getProfile(account.user.id);
  assert.equal(after.credits, spent.credits); assert.equal(after.intake.length, 0);
  assert.equal(f.store.settleRaid(account.user.id, room.roomId, before, 'extracted'), false, 'late duplicate settlement cannot restore lost gear');
  client.ws.close(); await once(client.ws, 'close');
  assert.equal(f.store.getProfile(account.user.id).raids, before.raids + 1);
  assert.deepEqual(f.errors, []);
});

test('solo extraction is saved exactly once before the result, with loot and XP surviving subsequent disconnect', async t => {
  const f = await fixture(t), account = await f.account('Extractor');
  const room = await f.rooms.create(account.user, { mode: 'solo', loadout: preset('assault') });
  const client = await f.connect(room); const { id } = await client.wait(m => m.type === 'welcome');
  client.send({ type: 'ready', ready: true }); await client.wait(m => m.type === 'lobby' && m.players[0]?.ready);
  client.send({ type: 'start' }); await client.wait(m => m.type === 'snapshot' && m.state.phase === 'raid');
  const runtime = f.runtimeFor(room), game = runtime.session.players.get(id).game;
  game.state.enemies.splice(0);
  const container = game.state.containers.find(value => value.id === 'arrival-tools');
  game.teleport(container.x, container.z + container.d / 2 + .9); advance(runtime, .2);
  runtime.session.action(id, 'interact'); advance(runtime, 1.7);
  const item = container.items.find(value => !['ammo', 'medkit'].includes(value.kind));
  assert.ok(item); runtime.session.action(id, 'take', item.id, container.id); advance(runtime, .2);
  assert.equal(game.state.raid.loot.length, 1); game.closeContainer();
  const exit = EXTRACTIONS[0]; game.teleport(exit.x, exit.z); advance(runtime, .2);
  runtime.session.action(id, 'interact'); advance(runtime, 8.2);
  const result = await client.wait(m => m.type === 'snapshot' && m.state.phase === 'extracted');
  const saved = f.store.getProfile(account.user.id);
  assert.equal(saved.extracts, account.profile.extracts + 1);
  assert.equal(saved.progression.xp, result.state.profile.progression.xp);
  assert.equal(saved.credits, result.state.profile.credits);
  assert.equal(saved.intake.length, 1); assert.equal(saved.intake[0].name, item.name);
  assert.ok(saved.progression.xp > account.profile.progression.xp);
  client.ws.close(); await once(client.ws, 'close');
  assert.equal(f.store.getProfile(account.user.id).extracts, saved.extracts);
  assert.deepEqual(f.errors, []);
});

test('coop creator stays host if guest joins first; shared raid persists both entries and disconnect settles only that player', async t => {
  const f = await fixture(t), a = await f.account('Creator'), b = await f.account('Partner');
  const room = await f.rooms.create(a.user, { mode: 'coop' }), invitation = await f.rooms.join(b.user, { invite: room.invite });
  const cb = await f.connect(invitation); const bid = (await cb.wait(m => m.type === 'welcome')).id;
  const ca = await f.connect(room); const aid = (await ca.wait(m => m.type === 'welcome')).id;
  assert.equal(f.runtimeFor(room).session.hostId, aid);
  ca.send({ type: 'ready', ready: true }); cb.send({ type: 'ready', ready: true });
  await ca.wait(m => m.type === 'lobby' && m.players.length === 2 && m.players.every(p => p.ready));
  cb.send({ type: 'start' }); assert.match((await cb.wait(m => m.type === 'error')).message, /Host/);
  ca.send({ type: 'start' }); await ca.wait(m => m.type === 'snapshot' && m.state.phase === 'raid');
  await cb.wait(m => m.type === 'snapshot' && m.state.phase === 'raid');
  const runtime = f.runtimeFor(room), ga = runtime.session.players.get(aid).game, gb = runtime.session.players.get(bid).game;
  assert.equal(ga.state.enemies, gb.state.enemies); assert.equal(ga.state.containers, gb.state.containers);
  assert.equal(f.store.getProfile(a.user.id).raids, a.profile.raids + 1);
  assert.equal(f.store.getProfile(b.user.id).raids, b.profile.raids + 1);
  ga.state.enemies.splice(0);
  ca.ws.close(); await once(ca.ws, 'close');
  const survivor = await cb.wait(m => m.type === 'snapshot' && m.state.teammates[0]?.phase === 'disconnected');
  assert.equal(survivor.state.phase, 'raid');
  await f.store.action(a.user.id, { kind: 'economy', action: 'storeAll', args: [] });
  await assert.rejects(f.store.action(b.user.id, { kind: 'economy', action: 'storeAll', args: [] }), /bereits/);
  cb.ws.close(); await once(cb.ws, 'close');
  await new Promise(resolve => setTimeout(resolve, 50));
  await f.store.action(b.user.id, { kind: 'economy', action: 'storeAll', args: [] });
  assert.deepEqual(f.errors, []);
});

test('capacity, short ticket expiry and lobby TTL release reservations without spending profile', async t => {
  let now = 100000;
  const f = await fixture(t, { maxRooms: 1, clock: () => now, ticketTtlMs: 1000, lobbyTtlMs: 3000 });
  const a = await f.account('Reserved'), b = await f.account('Waiting');
  const first = await f.rooms.create(a.user, { mode: 'solo' });
  await assert.rejects(f.rooms.create(b.user, { mode: 'solo' }), /belegt/);
  await assert.rejects(f.rooms.join(b.user, { invite: first.invite }), /verfügbar/);
  now += 1001; await f.rooms.sweep(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.rooms.status(a.user.id), null); assert.equal(f.rooms.size, 0);
  assert.equal(f.store.getProfile(a.user.id).raids, a.profile.raids);
  const second = await f.rooms.create(b.user, { mode: 'solo' }), client = await f.connect(second);
  await client.wait(m => m.type === 'welcome');
  now += 3001; const disconnected = once(client.ws, 'close'); await f.rooms.sweep(); await disconnected;
  assert.equal(f.rooms.size, 0); assert.equal(f.store.getProfile(b.user.id).raids, b.profile.raids);
  assert.deepEqual(f.errors, []);
});

test('invalid client selection cannot leave an account locked, and expired tickets cannot admit a player', async t => {
  let now = 100000;
  const f = await fixture(t, { clock: () => now, ticketTtlMs: 1000 }), a = await f.account('InvalidLoadout');
  await assert.rejects(f.rooms.create(a.user, { mode: 'solo', loadout: { mode: 'custom', custom: { weapon: 'invented-item' } } }), /Waffe|Lager/);
  assert.equal(f.rooms.status(a.user.id), null);
  const room = await f.rooms.create(a.user, { mode: 'solo' });
  now += 1001;
  const client = await f.connect(room); await once(client.ws, 'close');
  assert.equal(f.runtimeFor(room).session.players.size, 0);
  f.rooms.leave(a.user); assert.equal(f.store.getProfile(a.user.id).raids, a.profile.raids);
});

test('HTTP room endpoints require sessions, reject profile injection and return usable one-time tickets', async t => {
  const f = await fixture(t), a = await f.account('ApiOperator');
  const post = (path, body, token) => fetch(f.origin + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  assert.equal((await post('/api/rooms/create', { mode: 'solo' })).status, 401);
  assert.equal((await post('/api/rooms/create', { mode: 'solo', profile: { credits: 999999 } }, a.token)).status, 400);
  const response = await post('/api/rooms/create', { mode: 'solo' }, a.token); assert.equal(response.status, 200);
  const room = await response.json(), client = await f.connect(room);
  await client.wait(m => m.type === 'welcome');
  const status = await fetch(f.origin + '/api/rooms', { headers: { authorization: `Bearer ${a.token}` } }).then(r => r.json());
  assert.equal(status.room.roomId, room.roomId); assert.equal(status.room.mode, 'solo');
  assert.equal((await post('/api/rooms/leave', {}, a.token)).status, 200);
  assert.equal(f.rooms.status(a.user.id), null);
});

for (const abortFails of [false, true]) test(`failed extraction write never publishes an uncommitted result; ${abortFails ? 'temporary abort failure remains visible and retries' : 'spent state unlocks immediately'}`, async t => {
  const f = await fixture(t), account = await f.account('WriteFailure'), other = await f.account('HealthyRoom');
  const room = await f.rooms.create(account.user, { mode: 'solo', loadout: preset('assault') });
  await f.rooms.create(other.user, { mode: 'solo' });
  const client = await f.connect(room), { id } = await client.wait(m => m.type === 'welcome');
  client.send({ type: 'ready', ready: true }); await client.wait(m => m.type === 'lobby' && m.players[0]?.ready);
  client.send({ type: 'start' }); await client.wait(m => m.type === 'snapshot' && m.state.phase === 'raid');
  const spent = f.store.getProfile(account.user.id), originalSettle = f.store.settleRaid, originalAbort = f.store.abortRoom;
  f.store.settleRaid = () => { throw new Error('Injected result write failure'); };
  if (abortFails) f.store.abortRoom = () => { throw new Error('Injected temporary database unavailability'); };
  const runtime = f.runtimeFor(room), game = runtime.session.players.get(id).game, exit = EXTRACTIONS[0];
  game.state.enemies.splice(0); game.teleport(exit.x, exit.z); advance(runtime, .2);
  game.interact(); game.state.raid.extractionDuration = .01;
  const closed = once(client.ws, 'close');
  const notice = await client.wait(m => m.type === 'closed'); assert.match(notice.message, /nicht speichern/);
  await closed; await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(client.received.some(m => m.type === 'snapshot' && m.state.phase === 'extracted'), false);
  assert.equal(client.received.some(m => m.type === 'snapshot' && m.events?.some(e => e.type === 'extract')), false);
  assert.equal(f.store.getProfile(account.user.id).extracts, spent.extracts);
  assert.equal(f.store.getProfile(account.user.id).credits, spent.credits);
  if (abortFails) {
    assert.equal(f.rooms.status(account.user.id).phase, 'error', 'a retained lock always has a visible failed room');
    await assert.rejects(f.store.action(account.user.id, { kind: 'economy', action: 'storeAll', args: [] }), /bereits/);
    f.store.abortRoom = originalAbort; await f.rooms.sweep();
  }
  assert.equal(f.rooms.status(account.user.id), null);
  await f.store.action(account.user.id, { kind: 'economy', action: 'storeAll', args: [] });
  await assert.rejects(f.store.action(other.user.id, { kind: 'economy', action: 'storeAll', args: [] }), /bereits/);
  assert.equal(originalSettle(account.user.id, room.roomId, { ...spent, credits: 999999 }, 'extracted'), false);
  f.store.settleRaid = originalSettle;
});
