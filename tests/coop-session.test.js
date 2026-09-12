import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoopSession, sanitizeCoopInput } from '../src/coop-session.js';
import { EXTRACTIONS, RELAY } from '../src/layout.js';
import { approachContainer } from './container-helpers.js';

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
  const container = game.state.containers.find(value => value.items.includes(item));
  if (container) {
    approachContainer(game, container); session.action(id, 'interact'); step(session, 1.6);
    session.action(id, 'take', item.id, container.id); step(session, .1);
  } else { game.teleport(item.x, item.z); session.action(id, 'interact'); step(session, .1); }
}

test('weapon lobby choices validate combined costs and freeze skills before entering the raid', async t => {
  const { session, a, b, ga, gb } = await setup(t, false);
  assert.equal(ga.unlockSkill('weapon-1'), false); assert.equal(ga.selectWeapon('DMR-7'), false);
  assert.throws(() => session.ready(a, true, 'assault', 'SR-90'), /verfügbar/);
  assert.equal(session.players.get(a).ready, false); assert.equal(session.players.get(a).kit, 'scout');
  session.ready(a, true, 'scout', 'SG-8'); session.ready(b, true, 'assault', 'SR-90');
  assert.deepEqual(session.lobby().players.map(player => player.weapon), ['SG-8', 'SR-90']);
  session.start(a); quiet(ga);
  assert.equal(ga.state.player.weapon, 'SG-8'); assert.equal(gb.state.player.weapon, 'SR-90');
  assert.equal(ga.state.profile.credits, 575); assert.equal(gb.state.profile.credits, 600);
  const snapshot = session.snapshot(a);
  assert.equal(snapshot.state.player.cycleDuration, .82); assert.equal(snapshot.state.teammates[0].weapon, 'SR-90');
  assert.equal(snapshot.state.teammates[0].reloadDuration, 3.1); assert.equal(snapshot.state.profile.progression.xp, 0);
  assert.equal(snapshot.state.teammates[0].progression, undefined);
});

test('server preserves short clicks and legacy fire edges without repeating a held semi trigger', async t => {
  const { session, a, b, ga } = await setup(t, false);
  session.ready(a, true, 'scout', 'RV-6'); session.ready(b, true); session.start(a); quiet(ga);
  session.input(a, 1, { fire: false, firePressed: true }); session.input(a, 2, { fire: false, firePressed: false });
  session.update(1 / 60); assert.equal(ga.state.player.ammo, 5, 'Mouse down/up between network frames must still shoot once');
  step(session, .5); assert.equal(ga.state.player.ammo, 5);
  session.input(a, 3, { fire: true }); session.update(1 / 60); assert.equal(ga.state.player.ammo, 4);
  // Keep refreshing input beyond the cadence to distinguish trigger gating from stale-input release.
  for (let seq = 4; seq < 14; seq++) { session.input(a, seq, { fire: true }); step(session, .1); }
  assert.equal(ga.state.player.ammo, 4);
  session.input(a, 14, { fire: false }); session.input(a, 15, { fire: true }); session.input(a, 16, { fire: false });
  session.update(1 / 60); assert.equal(ga.state.player.ammo, 3);
  session.input(a, 17, { firePressed: true }); session.update(1 / 60); step(session, .6);
  assert.equal(ga.state.player.ammo, 3, 'Click during the cooldown expires instead of firing late');
  assert.equal(sanitizeCoopInput({ firePressed: 'true' }, ga.state.player).firePressed, false);
  const events = session.snapshot(b).events.filter(event => event.type === 'teammateShot');
  assert.equal(events.length, 3); assert.ok(events.every(event => event.weapon === 'RV-6'));
});

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
  assert.equal(ga.state.containers, gb.state.containers);
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
  const container = ga.state.containers[0], item = container.items[0];
  approachContainer(ga, container); approachContainer(gb, container);
  session.action(a, 'interact'); session.action(b, 'interact'); step(session, 1.6);
  session.action(a, 'take', item.id, container.id); session.action(b, 'take', item.id, container.id); step(session, .1);
  assert.equal(ga.state.raid.loot.length, 1); assert.equal(gb.state.raid.loot.length, 0);
  assert.equal(ga.state.raid.value + gb.state.raid.value, item.value);
  assert.equal(ga.state.profile.progression.xp, 10); assert.equal(gb.state.profile.progression.xp, 0);
  assert.equal(session.action(b, 'drop', item.id), true); step(session, .1);
  assert.equal(item.taken, true, 'A partner cannot drop another player’s item');
  session.action(a, 'drop', item.id); step(session, .1);
  const dropped = ga.state.loot.find(value => value.id === item.id);
  assert.equal(dropped.taken, false); assert.equal(item.taken, true); assert.equal(ga.state.raid.value, 0);
  session.action(b, 'interact'); step(session, .1);
  assert.equal(ga.state.raid.loot.length, 0); assert.equal(gb.state.raid.loot[0].id, item.id);
  assert.equal(ga.state.loot.filter(value => value.id === item.id).length, 1);
  assert.equal(ga.state.profile.progression.xp, 10); assert.equal(gb.state.profile.progression.xp, 0, 'Passing loot cannot create another first-claim XP reward');
});

test('each player extracts personal goods and bonus independently; the other raid continues', async t => {
  const { session, a, b, ga, gb } = await setup(t); quiet(ga);
  const [first, second] = ga.state.containers[0].items;
  take(session, a, ga, first); take(session, b, gb, second);
  ga.state.raid.kills = 2;
  const exit = EXTRACTIONS[0]; ga.teleport(exit.x, exit.z); session.action(a, 'interact'); step(session, 8.2);
  assert.equal(ga.state.phase, 'extracted'); assert.equal(gb.state.phase, 'raid'); assert.equal(session.phase, 'raid');
  assert.equal(ga.state.profile.intake.length, 1); assert.equal(ga.state.profile.intake[0].name, first.name);
  assert.equal(ga.state.profile.credits, 780); assert.equal(gb.state.profile.credits, 1150);
  assert.equal(ga.state.profile.progression.xp, 160); assert.equal(gb.state.profile.progression.xp, 10);
  const remaining = gb.state.raid.timeLeft; step(session, 1); assert.ok(gb.state.raid.timeLeft < remaining);
  gb.teleport(exit.x, exit.z); session.action(b, 'interact'); step(session, 8.2);
  assert.equal(session.phase, 'finished'); assert.equal(gb.state.phase, 'extracted');
  assert.equal(gb.state.profile.intake.length, 1); assert.equal(gb.state.profile.intake[0].name, second.name);
  assert.equal(gb.state.profile.progression.xp, 160); assert.equal(gb.state.result.xpEarned, 160);
  assert.equal(ga.state.profile.intake.length, 1); assert.equal(ga.state.profile.credits, 780);
  const frozen = ga.state.profile.credits; step(session, 60); assert.equal(ga.state.profile.credits, frozen);
  assert.equal(session.snapshot(a).state.teammates[0].phase, 'extracted');
});

test('disconnect loses carried loot and releases it for the surviving partner', async t => {
  const { session, a, b, ga, gb } = await setup(t); quiet(ga);
  const item = ga.state.containers[0].items[0]; take(session, a, ga, item);
  assert.equal(session.leave(a), true); assert.equal(session.leave(a), false);
  assert.equal(ga.state.phase, 'dead'); assert.equal(ga.state.profile.intake.length, 0);
  const dropped = ga.state.loot.find(value => value.id === item.id);
  assert.equal(ga.state.raid.loot.length, 0); assert.equal(item.taken, true); assert.equal(dropped.taken, false);
  assert.equal(session.phase, 'raid'); assert.equal(gb.state.phase, 'raid');
  take(session, b, gb, dropped); assert.equal(gb.state.raid.loot.length, 1);
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
  snap.state.player.hp = 0; snap.state.profile.credits = 9999; snap.state.containers[0].items[0].taken = true;
  assert.equal(ga.state.player.hp, 100); assert.equal(ga.state.profile.credits, 750); assert.equal(ga.state.containers[0].items[0].taken, false);
  assert.deepEqual(session.snapshot(a).events, []);
});

test('container search belongs to each player while opened contents are shared and close preserves queued claims', async t => {
  const { session, a, b, ga, gb } = await setup(t); quiet(ga);
  const container = ga.state.containers[0], item = container.items[0];
  approachContainer(ga, container); approachContainer(gb, container);
  session.action(a, 'interact'); step(session, .5);
  assert.equal(session.snapshot(a).state.activeContainerId, container.id);
  assert.ok(session.snapshot(a).state.containerSearchRemaining > .9);
  assert.equal(session.snapshot(b).state.activeContainerId, null);
  assert.equal(session.snapshot(b).state.containerSearchRemaining, 0);
  assert.equal(session.snapshot(b).state.containers[0].opened, true);
  assert.equal(ga.takeContainerItem(container.id, item.id), false);
  step(session, 1.1);
  assert.equal(container.searched, true);
  assert.equal(session.action(a, 'take', item.id, container.id), true);
  assert.equal(session.action(a, 'closeContainer'), true, 'Close must bypass the claim cadence');
  step(session, .1);
  assert.equal(ga.state.activeContainerId, null); assert.equal(ga.state.raid.loot[0].id, item.id);
  assert.equal(gb.state.raid.loot.length, 0);
  assert.equal(session.action(b, 'interact'), true); step(session, .1);
  assert.equal(gb.state.containerSearchRemaining, 0);
  assert.equal(session.action(b, 'takeAll', undefined, container.id), true); step(session, .1);
  assert.equal(gb.state.raid.loot.length, container.items.length - 1);
  assert.equal(new Set([...ga.state.raid.loot, ...gb.state.raid.loot].map(value => value.id)).size, container.items.length);
});

test('death creates a recoverable ground instance for a container item exactly once', async t => {
  const { session, a, b, ga, gb } = await setup(t); quiet(ga);
  const item = ga.state.containers[0].items[0]; take(session, a, ga, item);
  ga.receiveDamage(1000, { x: 0, z: 0 }); step(session, .1);
  assert.equal(ga.state.phase, 'dead'); assert.equal(ga.state.activeContainerId, null);
  const dropped = ga.state.loot.find(value => value.id === item.id);
  assert.ok(dropped && !dropped.taken); assert.equal(item.taken, true);
  assert.equal(ga.state.loot.filter(value => value.id === item.id).length, 1);
  session.leave(a); step(session, .1);
  assert.equal(ga.state.loot.filter(value => value.id === item.id).length, 1);
  take(session, b, gb, dropped); assert.equal(gb.state.raid.loot[0].id, item.id);
});
