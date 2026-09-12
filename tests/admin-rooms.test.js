import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { createRoomService } from '../server/rooms.js';
import { createCoopServer } from '../server/coop-server.js';
import { createAccountStore } from '../server/account-store.js';
import { RAID_SPAWNS } from '../src/raid-spawns.js';
import { getSupportHeight } from '../src/layout.js';
import { isWalkable } from '../src/simulation.js';

const version = '1.14.0';
const storeAction = { kind: 'economy', action: 'storeAll', args: [] };
const advance = (runtime, seconds) => { for (let i = 0; i < seconds * 60; i++) runtime.session.update(1 / 60); };
async function fixture(t) {
  const store = createAccountStore({ path: ':memory:' }), runtimes = new Map(), clients = [], errors = [];
  const http = createServer((req, res) => { res.statusCode = 404; res.end(); });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const rooms = createRoomService({ store, publicOrigin: `http://127.0.0.1:${http.address().port}`, version,
    onError: error => errors.push(error),
    async createRuntime(configuration) {
      // Repeat the same world seed to prove room history, rather than chance, changes entrances.
      const runtime = await createCoopServer({ ...configuration, sessionOptions: { ...configuration.sessionOptions, seed: 882 } });
      runtimes.set(configuration.token, runtime); return runtime;
    } });
  http.on('upgrade', rooms.handleUpgrade);
  t.after(async () => { for (const client of clients) client.ws.terminate(); await rooms.close(); await new Promise(resolve => http.close(resolve)); store.close(); });
  async function connect(admission) {
    const ws = new WebSocket(admission.url), queue = [], waiters = [];
    const client = { ws, send: message => ws.send(JSON.stringify(message)), wait(predicate) {
      const index = queue.findIndex(predicate);
      if (index !== -1) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, timer: setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1); reject(new Error('Timed out waiting for admin room snapshot'));
        }, 6000) }; waiters.push(waiter);
      });
    } };
    clients.push(client); ws.on('error', () => {});
    ws.on('message', data => {
      const message = JSON.parse(data), index = waiters.findIndex(waiter => waiter.predicate(message));
      if (index === -1) queue.push(message);
      else { const waiter = waiters.splice(index, 1)[0]; clearTimeout(waiter.timer); waiter.resolve(message); }
    });
    await once(ws, 'open'); client.send({ type: 'join', protocol: 1, version, ticket: admission.ticket });
    client.id = (await client.wait(message => message.type === 'welcome')).id; return client;
  }
  async function raid(accounts) {
    const admission = await rooms.create(accounts[0].user, { mode: accounts.length === 1 ? 'solo' : 'coop' });
    const group = [await connect(admission)];
    for (const account of accounts.slice(1)) group.push(await connect(await rooms.join(account.user, { roomId: admission.roomId })));
    for (const client of group) client.send({ type: 'ready', ready: true });
    await group[0].wait(message => message.type === 'lobby' && message.players.length === group.length && message.players.every(player => player.ready));
    group[0].send({ type: 'start' });
    const snapshots = await Promise.all(group.map(client => client.wait(message => message.type === 'snapshot' && message.state.phase === 'raid')));
    const runtime = runtimes.get(new URL(admission.url).searchParams.get('token'));
    return { ...admission, clients: group, snapshots, runtime, games: group.map(client => runtime.session.players.get(client.id).game) };
  }
  return { store, rooms, raid, errors, account: name => store.register(name, 'a-password-only-for-tests') };
}

test('room history excludes both teammates previous entries across fresh solo and shared rooms with the same seed', async t => {
  const f = await fixture(t), a = await f.account('SpawnOwner'), b = await f.account('SpawnPartner');
  const first = await f.raid([a]); const aFirst = first.games[0].state.raid.spawn.id;
  await f.rooms.adminAction('room-close', { roomId: first.roomId });
  const second = await f.raid([b]); const bPrevious = second.games[0].state.raid.spawn.id;
  assert.equal(bPrevious, aFirst, 'identical seed without history chooses identical entry');
  await f.rooms.adminAction('room-close', { roomId: second.roomId });
  const third = await f.raid([a]); const aPrevious = third.games[0].state.raid.spawn.id;
  assert.notEqual(aPrevious, aFirst); await f.rooms.adminAction('room-close', { roomId: third.roomId });
  const shared = await f.raid([b, a]), [ga, gb] = shared.games;
  assert.ok(![aPrevious, bPrevious].includes(ga.state.raid.spawn.id));
  assert.deepEqual(ga.state.raid.spawn, gb.state.raid.spawn);
  assert.deepEqual(shared.snapshots[0].state.raid.spawn, shared.snapshots[1].state.raid.spawn);
  assert.equal(ga.state.enemies, gb.state.enemies); assert.equal(ga.state.containers, gb.state.containers);
  assert.ok(Math.hypot(ga.state.player.x - gb.state.player.x, ga.state.player.z - gb.state.player.z) >= 2.3);
  const previousShared = ga.state.raid.spawn.id;
  await f.rooms.adminAction('room-close', { roomId: shared.roomId });
  const last = await f.raid([a]); assert.notEqual(last.games[0].state.raid.spawn.id, previousShared);
  assert.deepEqual(f.errors, []);
});

test('live heal, refill, revive and transient admin switches change authoritative state and snapshots', async t => {
  const f = await fixture(t), a = await f.account('AdminTarget'), b = await f.account('AdminPartner');
  const room = await f.raid([a, b]), game = room.games[0], p = game.state.player;
  game.state.enemies.splice(0);
  game.receiveDamage(35, { x: p.x, z: p.z }); assert.ok(p.hp < p.maxHp && p.armor < p.maxArmor);
  await f.rooms.adminAction('heal', { userId: a.user.id }); assert.equal(p.hp, p.maxHp); assert.equal(p.armor, p.maxArmor);
  p.ammo = p.reserve = p.medkits = 0; p.reload = 2;
  await f.rooms.adminAction('refill', { userId: a.user.id });
  assert.equal(p.ammo, p.magSize); assert.ok(p.reserve >= p.weaponStats.reserve); assert.equal(p.medkits, 4); assert.equal(p.reload, 0);
  game.receiveDamage(9999, { x: p.x, z: p.z }); assert.equal(p.downed, true);
  await f.rooms.adminAction('revive', { userId: a.user.id }); assert.equal(p.downed, false); assert.equal(p.hp, 35);
  await assert.rejects(f.rooms.adminAction('revive', { userId: a.user.id }), /genockt/);
  await f.rooms.adminAction('heal', { userId: a.user.id });
  await f.rooms.adminAction('godmode', { userId: a.user.id, enabled: true });
  p.reviveProtection = 0; const armor = p.armor;
  game.receiveDamage(99999, { x: p.x, z: p.z }); assert.equal(p.hp, p.maxHp); assert.equal(p.armor, armor);
  p.stamina = 0; p.sprintExhausted = true;
  await f.rooms.adminAction('stamina', { userId: a.user.id, enabled: true }); advance(room.runtime, .1);
  assert.equal(p.stamina, p.maxStamina); assert.equal(p.sprintExhausted, false);
  const snapshot = await room.clients[0].wait(message => message.type === 'snapshot' && message.state.player.adminGodmode && message.state.player.adminStamina);
  assert.equal(snapshot.state.player.hp, p.maxHp); assert.equal(snapshot.state.player.ammo, p.magSize);
  const overview = f.rooms.adminOverview(), player = overview.rooms[0].players.find(value => value.userId === a.user.id);
  assert.equal(player.godmode, true); assert.equal(player.staminaUnlimited, true);
  assert.equal(overview.spawns.length, 16); assert.equal(overview.rooms[0].roomId, room.roomId);
  assert.equal(JSON.stringify(overview).includes(room.ticket), false); assert.equal(JSON.stringify(overview).includes(room.invite), false);
  await f.rooms.adminAction('godmode', { userId: a.user.id, enabled: false });
  await f.rooms.adminAction('stamina', { userId: a.user.id, enabled: false });
  game.receiveDamage(10, { x: p.x, z: p.z }); assert.ok(p.hp < p.maxHp || p.armor < armor);
  await assert.rejects(f.rooms.adminAction('godmode', { userId: a.user.id, enabled: 'true' }), /Wahrheitswert/);
  assert.deepEqual(f.errors, []);
});

test('admin teleport uses surveyed ground, separates teammates and publishes a fresh snap sequence', async t => {
  const f = await fixture(t), a = await f.account('TeleportOwner'), b = await f.account('TeleportPartner'), c = await f.account('OtherRaid');
  const room = await f.raid([a, b]), other = await f.raid([c]), game = room.games[0], p = game.state.player;
  game.state.enemies.splice(0); other.games[0].state.enemies.splice(0);
  const spawn = RAID_SPAWNS.find(value => value.id !== game.state.raid.spawn.id);
  room.runtime.session.input(room.clients[0].id, 50, { forward: 1, fire: true, jump: true, yaw: p.yaw, pitch: p.pitch });
  await f.rooms.adminAction('teleport-spawn', { userId: a.user.id, spawnId: spawn.id });
  assert.equal(p.x, spawn.x); assert.equal(p.z, spawn.z); assert.ok(Math.abs(p.y - spawn.y) < .05);
  assert.equal(p.adminTeleportSequence, 1); assert.equal(isWalkable(p.x, p.z, .48, p.y), true);
  const participant = room.runtime.session.players.get(room.clients[0].id);
  assert.equal(participant.input.forward, 0); assert.equal(participant.fireQueued, false); assert.equal(participant.jumpQueued, false);
  const snap = await room.clients[0].wait(message => message.type === 'snapshot' && message.state.player.adminTeleportSequence === 1);
  assert.ok(Math.hypot(snap.state.player.x - spawn.x, snap.state.player.z - spawn.z) < .05);
  await f.rooms.adminAction('teleport-spawn', { userId: b.user.id, spawnId: spawn.id });
  const partner = room.games[1].state.player;
  assert.ok(Math.hypot(p.x - partner.x, p.z - partner.z) > 2.3, 'occupied first spawn uses paired position');
  await f.rooms.adminAction('teleport-player', { userId: a.user.id, targetUserId: b.user.id });
  assert.equal(p.adminTeleportSequence, 2); assert.ok(Math.abs(Math.hypot(p.x - partner.x, p.z - partner.z) - 2.4) < .001);
  assert.ok(Math.abs(p.y - getSupportHeight(p.x, p.z, p.y)) < .08);
  const before = { x: p.x, y: p.y, z: p.z, sequence: p.adminTeleportSequence };
  await assert.rejects(f.rooms.adminAction('teleport-player', { userId: a.user.id, targetUserId: c.user.id }), /selben Raid/);
  await assert.rejects(f.rooms.adminAction('teleport-player', { userId: a.user.id, targetUserId: a.user.id }), /anderen/);
  await assert.rejects(f.rooms.adminAction('teleport-spawn', { userId: a.user.id, spawnId: 'forged' }), /Unbekannter/);
  assert.deepEqual({ x: p.x, y: p.y, z: p.z, sequence: p.adminTeleportSequence }, before);
  assert.deepEqual(f.errors, []);
});

test('unknown admin actions and inactive players are rejected without spending or mutating a lobby', async t => {
  const f = await fixture(t), a = await f.account('LobbyOnly');
  const room = await f.rooms.create(a.user, { mode: 'solo' }), before = f.store.getProfile(a.user.id);
  await assert.rejects(f.rooms.adminAction('invent-credits', { userId: a.user.id }), error => error.status === 400 && /Unbekannte/.test(error.message));
  await assert.rejects(f.rooms.adminAction('heal', []), error => error.status === 400);
  await assert.rejects(f.rooms.adminAction('heal', { userId: a.user.id }), /aktiven Raid/);
  await assert.rejects(f.rooms.adminAction('enemies-clear', { roomId: room.roomId }), /aktiver Raid/);
  await assert.rejects(f.rooms.adminAction('room-close', { roomId: 'missing' }), error => error.status === 404);
  assert.deepEqual(f.store.getProfile(a.user.id), before);
  await f.rooms.adminAction('kick', { userId: a.user.id });
  assert.equal(f.rooms.status(a.user.id), null); await f.store.action(a.user.id, storeAction);
});

test('teleporting beside an airborne teammate finds actual support or refuses the unsafe destination', async t => {
  const f = await fixture(t), a = await f.account('GroundedTeleport'), b = await f.account('JumpingTarget');
  const room = await f.raid([a, b]), [game, target] = room.games;
  game.state.enemies.splice(0); assert.equal(target.teleport(-52, 0), true);
  for (let i = 0; i < 20; i++) target.update(1 / 60, {});
  for (let i = 0; i < 15; i++) target.update(1 / 60, { jump: i === 0 });
  assert.ok(target.state.player.y > .8 && !target.state.player.grounded, 'target is airborne from a real jump');
  const before = { x: game.state.player.x, y: game.state.player.y, z: game.state.player.z };
  let rejection;
  try { await f.rooms.adminAction('teleport-player', { userId: a.user.id, targetUserId: b.user.id }); } catch (error) { rejection = error; }
  const p = game.state.player;
  if (rejection) {
    assert.match(rejection.message, /sicherer Platz/);
    assert.deepEqual({ x: p.x, y: p.y, z: p.z }, before);
  } else {
    assert.ok(Math.abs(p.y - getSupportHeight(p.x, p.z, p.y)) < .08, 'arrival has real ground/floor support rather than copying airborne height');
  }
  assert.deepEqual(f.errors, []);
});

test('admin enemy clear affects the shared world; kick and close settle durable losses and release only intended locks', async t => {
  const f = await fixture(t), a = await f.account('KickOwner'), b = await f.account('KickPartner'), c = await f.account('UntouchedRoom');
  const room = await f.raid([a, b]); const other = await f.rooms.create(c.user, { mode: 'solo' });
  const [ga, gb] = room.games, spentA = f.store.getProfile(a.user.id), spentB = f.store.getProfile(b.user.id);
  const count = ga.state.enemies.filter(enemy => !enemy.dead).length;
  const result = await f.rooms.adminAction('enemies-clear', { roomId: room.roomId });
  assert.equal(result.removed, count); assert.ok(gb.state.enemies.every(enemy => enemy.dead && enemy.hp === 0));
  assert.equal(ga.state.raid.kills, 0); assert.equal(gb.state.raid.kills, 0);
  const kicked = once(room.clients[0].ws, 'close');
  assert.deepEqual(await f.rooms.adminAction('kick', { userId: a.user.id }), { kicked: true }); await kicked;
  assert.equal(f.rooms.status(a.user.id), null); assert.equal(gb.state.phase, 'raid');
  assert.equal(f.store.getProfile(a.user.id).credits, spentA.credits); assert.equal(f.store.getProfile(a.user.id).raids, spentA.raids);
  await f.store.action(a.user.id, storeAction);
  await assert.rejects(f.store.action(b.user.id, storeAction), /bereits/);
  await assert.rejects(f.store.action(c.user.id, storeAction), /bereits/);
  await f.rooms.adminAction('room-close', { roomId: room.roomId });
  assert.equal(f.rooms.status(b.user.id), null); assert.equal(f.rooms.size, 1);
  assert.equal(f.store.getProfile(b.user.id).credits, spentB.credits); assert.equal(f.store.getProfile(b.user.id).raids, spentB.raids);
  await f.store.action(b.user.id, storeAction);
  assert.equal(f.store.settleRaid(a.user.id, room.roomId, { ...spentA, credits: 999999 }, 'extracted'), false);
  assert.equal(f.store.settleRaid(b.user.id, room.roomId, { ...spentB, credits: 999999 }, 'extracted'), false);
  assert.equal(f.rooms.status(c.user.id).roomId, other.roomId);
  await assert.rejects(f.store.action(c.user.id, storeAction), /bereits/);
  assert.deepEqual(await f.rooms.adminAction('kick', { userId: a.user.id }), { kicked: false });
  assert.deepEqual(f.errors, []);
});
