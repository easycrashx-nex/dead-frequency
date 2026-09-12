import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoopSession, sanitizeCoopInput } from '../src/coop-session.js';
import { EXTRACTIONS, RELAY } from '../src/layout.js';

const step = (session, seconds) => { for (let i = 0; i < Math.ceil(seconds * 60); i++) session.update(1 / 60); };
async function setup(t, started = true) {
  const session = createCoopSession({ seed: 414 }); t.after(() => session.close());
  const a = await session.join({ name: 'Alpha', profile: { credits: 750, raids: 2 }, kit: 'scout' });
  const b = await session.join({ name: 'Bravo', profile: { credits: 1500, raids: 8 }, kit: 'assault' });
  if (started) { session.ready(a, true); session.ready(b, true); session.start(a); }
  return { session, a, b, ga: session.players.get(a).game, gb: session.players.get(b).game };
}
const quiet = game => { game.state.enemies.splice(0); };
function angle(game, enemy) {
  const p = game.state.player, dx = enemy.x - p.x, dz = enemy.z - p.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(1.69 - p.y - 1.65, Math.hypot(dx, dz)) };
}
function take(session, id, game, item) {
  game.teleport(item.x, item.z); session.action(id, 'interact'); step(session, .1);
}

test('lobby reserves exactly two slots, requires both ready and starts kits only once', async t => {
  const { session, a, b, ga, gb } = await setup(t, false);
  await assert.rejects(session.join({ name: 'Third' }), /voll/);
  assert.throws(() => session.start(a), /bereit/);
  session.ready(a, true); session.ready(b, true);
  assert.throws(() => session.start(b), /Host/);
  assert.equal(session.start(a), true);
  assert.equal(ga.state.profile.credits, 750); assert.equal(gb.state.profile.credits, 1150);
  assert.equal(ga.state.profile.raids, 3); assert.equal(gb.state.profile.raids, 9);
  assert.equal(ga.state.enemies, gb.state.enemies); assert.equal(ga.state.loot, gb.state.loot);
  assert.throws(() => session.start(a), /bereits/);
  assert.equal(gb.state.profile.credits, 1150);
  assert.ok(Math.hypot(ga.state.player.x - gb.state.player.x, ga.state.player.z - gb.state.player.z) > 2);
});

test('inputs clamp movement, reject stale sequences and never accept position, ammo or damage', async t => {
  const { session, a, ga } = await setup(t); quiet(ga);
  assert.equal(session.input(a, 1, { forward: 100, x: 999, y: 100, hp: 1, ammo: 999, damage: 9999, fire: 'true' }), true);
  step(session, .1);
  assert.ok(ga.state.player.z > 47 && ga.state.player.z < 48);
  assert.ok(Math.abs(ga.state.player.x + 7) < .02); assert.equal(ga.state.player.hp, 100); assert.equal(ga.state.player.ammo, 24);
  assert.equal(session.input(a, 1, { forward: -1 }), false);
  assert.equal(session.input(a, 0, { fire: true }), false);
  assert.equal(session.input(a, 2, { yaw: Infinity }), false);
  assert.equal(sanitizeCoopInput([], ga.state.player), null);
  step(session, .4); const stopped = ga.state.player.z; step(session, .4);
  assert.ok(Math.abs(ga.state.player.z - stopped) < .02, 'Stale network input must release movement');
  assert.equal(session.snapshot(a).ack, 1);
});

test('shared damage and death occur once while teammates cannot hurt each other', async t => {
  const { session, a, b, ga, gb } = await setup(t);
  const enemy = ga.state.enemies[1]; Object.assign(enemy, { x: -7, z: 42, hp: 95, fireTimer: 100, dead: false });
  ga.state.enemies.splice(0, ga.state.enemies.length, enemy);
  ga.teleport(-7, 48); gb.teleport(-7, 45);
  session.input(a, 1, { ...angle(ga, enemy), fire: true }); session.update(1 / 60);
  assert.ok(enemy.hp > 0 && enemy.hp < 20); assert.equal(gb.state.player.hp, 100);
  assert.equal(ga.state.player.ammo, 23); assert.equal(gb.state.player.ammo, 30);
  session.input(a, 2, { fire: false }); session.input(b, 1, { ...angle(gb, enemy), fire: true }); session.update(1 / 60);
  assert.equal(enemy.dead, true); assert.equal(ga.state.raid.kills, 0); assert.equal(gb.state.raid.kills, 1);
  assert.equal(ga.state.loot.filter(item => item.id === `drop-${enemy.id}`).length, 1);
  assert.equal(ga.state.player.hp, 100); assert.equal(gb.state.player.hp, 100);
  const left = session.snapshot(a), right = session.snapshot(b);
  assert.ok(left.events.some(e => e.type === 'teammateShot' && e.playerId === b));
  assert.ok(right.events.some(e => e.type === 'kill'));
  assert.equal(left.state.enemies[0].dead, true); assert.equal(right.state.enemies[0].dead, true);
});

test('simultaneous looting has one owner and a dropped item can be passed to the partner', async t => {
  const { session, a, b, ga, gb } = await setup(t); quiet(ga);
  const item = ga.state.loot[0]; ga.teleport(item.x, item.z); gb.teleport(item.x, item.z);
  session.action(a, 'interact'); session.action(b, 'interact'); step(session, .1);
  assert.equal(ga.state.raid.loot.length, 1); assert.equal(gb.state.raid.loot.length, 0);
  assert.equal(ga.state.raid.value + gb.state.raid.value, item.value);
  assert.equal(session.action(b, 'drop', item.id), true); step(session, .1);
  assert.equal(item.taken, true, 'A partner cannot drop another player’s item');
  session.action(a, 'drop', item.id); step(session, .1);
  assert.equal(item.taken, false); assert.equal(ga.state.raid.value, 0);
  session.action(b, 'interact'); step(session, .1);
  assert.equal(ga.state.raid.loot.length, 0); assert.equal(gb.state.raid.loot[0].id, item.id);
  assert.equal(ga.state.loot.filter(value => value.id === item.id).length, 1);
});

test('each player extracts personal goods and bonus independently; the other raid continues', async t => {
  const { session, a, b, ga, gb } = await setup(t); quiet(ga);
  const [first, second] = ga.state.loot;
  take(session, a, ga, first); take(session, b, gb, second);
  ga.state.raid.kills = 2;
  const exit = EXTRACTIONS[0]; ga.teleport(exit.x, exit.z); session.action(a, 'interact'); step(session, 8.2);
  assert.equal(ga.state.phase, 'extracted'); assert.equal(gb.state.phase, 'raid'); assert.equal(session.phase, 'raid');
  assert.equal(ga.state.profile.intake.length, 1); assert.equal(ga.state.profile.intake[0].name, first.name);
  assert.equal(ga.state.profile.credits, 830); assert.equal(gb.state.profile.credits, 1150);
  const remaining = gb.state.raid.timeLeft; step(session, 1); assert.ok(gb.state.raid.timeLeft < remaining);
  gb.teleport(exit.x, exit.z); session.action(b, 'interact'); step(session, 8.2);
  assert.equal(session.phase, 'finished'); assert.equal(gb.state.phase, 'extracted');
  assert.equal(gb.state.profile.intake.length, 1); assert.equal(gb.state.profile.intake[0].name, second.name);
  assert.equal(ga.state.profile.intake.length, 1); assert.equal(ga.state.profile.credits, 830);
  const frozen = ga.state.profile.credits; step(session, 60); assert.equal(ga.state.profile.credits, frozen);
  assert.equal(session.snapshot(a).state.teammates[0].phase, 'extracted');
});

test('disconnect loses carried loot and releases it for the surviving partner', async t => {
  const { session, a, b, ga, gb } = await setup(t); quiet(ga);
  const item = ga.state.loot[0]; take(session, a, ga, item);
  assert.equal(session.leave(a), true); assert.equal(session.leave(a), false);
  assert.equal(ga.state.phase, 'dead'); assert.equal(ga.state.profile.intake.length, 0);
  assert.equal(ga.state.raid.loot.length, 0); assert.equal(item.taken, false);
  assert.equal(session.phase, 'raid'); assert.equal(gb.state.phase, 'raid');
  take(session, b, gb, item); assert.equal(gb.state.raid.loot.length, 1);
  assert.equal(session.snapshot(b).state.teammates[0].phase, 'disconnected');
});

test('one relay activation is shared and spawns one reinforcement', async t => {
  const { session, a, b, ga, gb } = await setup(t); quiet(ga);
  ga.teleport(RELAY.x, RELAY.z); gb.teleport(RELAY.x, RELAY.z);
  session.action(a, 'interact'); session.action(b, 'interact'); session.update(1 / 60);
  assert.equal(ga.state.raid.objectiveComplete, true); assert.equal(gb.state.raid.objectiveComplete, true);
  assert.equal(ga.state.enemies.length, 1);
});

test('AI damages either player and remains active after the first player is eliminated', async t => {
  const { session, a, ga, gb } = await setup(t);
  const template = structuredClone(ga.state.enemies[1]);
  ga.state.enemies.splice(0, ga.state.enemies.length,
    { ...structuredClone(template), id: 'guard-left', x: -52, z: 25, home: { x: -52, z: 25 }, yaw: Math.PI, alert: 8, fireTimer: 0, flank: false },
    { ...structuredClone(template), id: 'guard-right', x: 52, z: 25, home: { x: 52, z: 25 }, yaw: Math.PI, alert: 8, fireTimer: 0, flank: false });
  ga.teleport(-52, 40); gb.teleport(52, 40);
  for (let i = 0; i < 12 * 60 && (ga.state.player.hp === 100 || gb.state.player.hp === 100); i++) session.update(1 / 60);
  assert.ok(ga.state.player.hp < 100); assert.ok(gb.state.player.hp < 100);
  session.leave(a); const hp = gb.state.player.hp;
  for (let i = 0; i < 8 * 60 && gb.state.player.hp === hp; i++) session.update(1 / 60);
  assert.ok(gb.state.player.hp < hp, 'AI stopped when the host player stopped playing');
});

test('snapshots expose only own profile and copies cannot mutate authoritative state', async t => {
  const { session, a, ga } = await setup(t); quiet(ga);
  const snap = session.snapshot(a);
  assert.equal(snap.state.multiplayer, true); assert.equal(snap.state.playerId, a);
  assert.equal('profile' in snap.state.teammates[0], false);
  snap.state.player.hp = 0; snap.state.profile.credits = 9999; snap.state.loot[0].taken = true;
  assert.equal(ga.state.player.hp, 100); assert.equal(ga.state.profile.credits, 750); assert.equal(ga.state.loot[0].taken, false);
  assert.deepEqual(session.snapshot(a).events, []);
});
