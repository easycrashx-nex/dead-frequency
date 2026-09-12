import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, validateProfile, findPath, isWalkable, hasLineOfSight, UPGRADE_COSTS } from '../src/simulation.js';
import { SPAWN, EXTRACTIONS, RELAY, POIS } from '../src/layout.js';
import { storeAll } from '../src/economy.js';

const economyDefaults = { stash: [], intake: [], listings: [], mailbox: [], nextItemId: 1, marketTime: 0 };

const run = (game, seconds, input = {}) => {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) game.update(1 / 60, input);
};
const quiet = game => { for (const enemy of game.state.enemies) enemy.dead = true; };
async function gameFor(t, saved) { const game = await createGame(saved); t.after(() => game.dispose()); return game; }
function aimAt(game, enemy, y = 1.69) {
  const p = game.state.player, dx = enemy.x - p.x, dy = y - (p.y + 1.65), dz = enemy.z - p.z;
  const length = Math.hypot(dx, dy, dz); return { x: dx / length, y: dy / length, z: dz / length };
}

test('saved profiles reject non-finite numbers and clamp progression', () => {
  assert.deepEqual(validateProfile(null), { credits: 750, raids: 0, extracts: 0, best: 0, upgrades: { armor: 0, backpack: 0, weapon: 0 }, ...economyDefaults });
  assert.deepEqual(validateProfile({ credits: -300, raids: 2.8, extracts: 900, best: NaN, upgrades: { armor: 50, backpack: -4, weapon: '3' } }),
    { credits: 0, raids: 2, extracts: 2, best: 0, upgrades: { armor: 3, backpack: 0, weapon: 0 }, ...economyDefaults });
  assert.equal(validateProfile({ profile: { credits: Infinity } }).credits, 750);
});

test('seeded raids reproduce patrols and loot, and the free kit never softlocks', async t => {
  const a = await gameFor(t, { credits: 0 }), b = await gameFor(t, { credits: 0 });
  assert.equal(a.startRaid({ kit: 'assault' }), false);
  assert.equal(a.startRaid({ kit: 'scout', seed: 712 }), true);
  assert.equal(b.startRaid({ kit: 'scout', seed: 712 }), true);
  assert.deepEqual(a.state.enemies, b.state.enemies);
  assert.deepEqual(a.state.loot, b.state.loot);
  assert.equal(a.state.profile.credits, 0);
  assert.equal(a.startRaid({ kit: 'scout' }), false);
  assert.equal(a.state.profile.raids, 1);
  run(a, 0.5); assert.equal(a.state.player.hp, 100);
});

test('navigation connects spawn, both exits, relay and accessible POI approaches', () => {
  const targets = [...EXTRACTIONS, RELAY, ...POIS];
  for (const target of targets) {
    const path = findPath(SPAWN, target);
    assert.ok(path.length > 0, `No route to ${target.name ?? 'relay'}`);
    for (const point of path) assert.equal(isWalkable(point.x, point.z), true);
  }
  assert.equal(hasLineOfSight({ x: -25, z: 0 }, { x: -25, z: -35 }), false);
  assert.equal(hasLineOfSight({ x: -50, z: 40 }, { x: -50, z: -40 }), true);
});

test('Rapier blocks solid barriers and permits lateral sliding, diagonal speed stays normalized', async t => {
  const game = await gameFor(t); game.startRaid({ seed: 1 }); quiet(game);
  run(game, 3, { forward: 1, yaw: 0 });
  assert.ok(game.state.player.z > 37.85, `Passed through barrier: z=${game.state.player.z}`);
  const oldX = game.state.player.x;
  run(game, 0.5, { forward: 1, right: 1, yaw: 0 });
  assert.ok(game.state.player.x > oldX + 1);
  assert.equal(game.teleport(-50, 0), true);
  const before = { ...game.state.player }; run(game, 1, { forward: 1, right: 1, yaw: 0 });
  assert.ok(Math.hypot(game.state.player.x - before.x, game.state.player.z - before.z) < 4.5);
  assert.equal(game.teleport(-25, -15), false);
  assert.equal(game.teleport(500, 0), false);
});

test('jumping rises and lands, sprint consumes stamina, pause freezes all raid timers', async t => {
  const game = await gameFor(t); game.startRaid({ seed: 2 }); quiet(game);
  game.update(1 / 60, { jump: true }); run(game, 0.15);
  assert.ok(game.state.player.y > 0.5);
  run(game, 1); assert.ok(game.state.player.y < 0.05); assert.equal(game.state.player.grounded, true);
  game.teleport(-52, 0); run(game, 1, { forward: 1, sprint: true });
  assert.ok(game.state.player.stamina < 85);
  game.state.player.ammo = 0; assert.equal(game.reload(), true);
  game.pause(true); const snapshot = JSON.stringify(game.state);
  run(game, 3, { forward: 1 }); assert.equal(JSON.stringify(game.state), snapshot);
  assert.equal(game.fire({ x: 0, y: 0, z: -1 }), false);
  game.pause(false); run(game, 2); assert.equal(game.state.player.ammo, 24);
});

test('hitscan respects cover, head damage and cooldown; reload conserves ammunition', async t => {
  const game = await gameFor(t); game.startRaid({ seed: 3 }); quiet(game);
  const enemy = game.state.enemies[0];
  Object.assign(enemy, { x: -7, z: 42, hp: 95, dead: false, fireTimer: 100 });
  const before = game.state.player.ammo;
  assert.equal(game.fire(aimAt(game, enemy)), true);
  assert.ok(enemy.hp < 20 && enemy.hp > 0);
  assert.equal(game.fire(aimAt(game, enemy)), false);
  assert.equal(game.state.player.ammo, before - 1);
  run(game, 0.12); assert.equal(game.fire(aimAt(game, enemy)), true);
  assert.equal(enemy.dead, true); assert.equal(game.state.raid.kills, 1);
  assert.ok(game.drainEvents().some(e => e.type === 'kill' && e.headshot));
  game.teleport(-25, 1);
  Object.assign(enemy, { x: -25, z: -32, hp: 95, dead: false, fireTimer: 100 });
  run(game, 0.12); game.fire(aimAt(game, enemy)); assert.equal(enemy.hp, 95);
  enemy.dead = true;
  game.state.player.ammo = 3; game.state.player.reserve = 9;
  assert.equal(game.reload(), true); assert.equal(game.reload(), false);
  assert.equal(game.fire({ x: 0, y: 0, z: -1 }), false);
  run(game, 1.8); assert.equal(game.state.player.ammo, 12); assert.equal(game.state.player.reserve, 0);
});

test('medkits commit once on completion; firing cancels without consuming one', async t => {
  const game = await gameFor(t); game.startRaid({ seed: 4 }); quiet(game);
  game.state.player.hp = 20;
  assert.equal(game.heal(), true); run(game, 1);
  game.fire({ x: 0, y: 0, z: -1 }); assert.equal(game.state.player.heal, 0);
  assert.equal(game.state.player.medkits, 2); assert.equal(game.state.player.hp, 20);
  assert.equal(game.heal(), true); run(game, 2.3);
  assert.equal(game.state.player.medkits, 1); assert.equal(game.state.player.hp, 75);
  run(game, 3); assert.equal(game.state.player.medkits, 1);
});

test('loot cannot be duplicated, capacity is enforced and supplies use no slots', async t => {
  const game = await gameFor(t); game.startRaid({ seed: 5 }); quiet(game);
  const first = game.state.loot[0]; game.teleport(first.x, first.z);
  assert.equal(game.interact(), true); assert.equal(game.interact(), false);
  assert.equal(game.state.raid.value, first.value); assert.equal(game.state.raid.loot.length, 1);
  game.state.raid.capacity = 1;
  const second = game.state.loot[1]; game.teleport(second.x, second.z);
  assert.equal(game.interact(), false); assert.equal(second.taken, false);
  const supply = game.state.loot.find(item => item.kind === 'ammo'); game.teleport(supply.x, supply.z);
  const reserve = game.state.player.reserve;
  assert.equal(game.interact(), true); assert.equal(game.state.player.reserve, reserve + 36);
  assert.equal(game.state.raid.loot.length, 1);
});

test('extraction requires continuous presence and transfers unsold goods exactly once', async t => {
  const game = await gameFor(t); game.startRaid({ seed: 6 }); quiet(game);
  const first = game.state.loot[0]; game.teleport(first.x, first.z); game.interact();
  const bank = game.state.profile.credits, exit = EXTRACTIONS[0];
  game.teleport(exit.x, exit.z); run(game, 9); assert.equal(game.state.phase, 'raid');
  assert.equal(game.interact(), true); run(game, 3); assert.ok(game.state.raid.extractionProgress > 2.9);
  game.teleport(exit.x + 6, exit.z); run(game, 0.1);
  assert.equal(game.state.raid.extractionProgress, 0);
  game.teleport(exit.x, exit.z); game.interact(); run(game, 8.1);
  assert.equal(game.state.phase, 'extracted'); assert.equal(game.state.profile.credits, bank);
  assert.equal(game.state.profile.extracts, 1); assert.equal(game.state.result.total, 0);
  assert.equal(game.state.result.value, first.value); assert.equal(game.state.result.itemCount, 1);
  assert.deepEqual(game.state.profile.intake, [{ id: 'item-1', name: first.name, value: first.value, rarity: first.rarity }]);
  assert.equal(game.state.profile.stash.length, 0);
  run(game, 60); game.interact(); assert.equal(game.state.profile.credits, bank);
  assert.equal(game.state.profile.intake.length, 1);
  const persisted = game.getSave(); persisted.profile.credits = -1;
  persisted.profile.intake[0].value = 1;
  assert.equal(game.state.profile.credits, bank);
  assert.equal(game.state.profile.intake[0].value, first.value);
  assert.equal(persisted.version, 2);
  game.returnToHub();
  const raids = game.state.profile.raids;
  assert.equal(game.startRaid({ kit: 'assault' }), false);
  assert.equal(game.state.profile.raids, raids); assert.equal(game.state.profile.credits, bank);
  assert.ok(game.drainEvents().some(event => event.text?.includes('einlagern')));
  assert.equal(storeAll(game.state.profile), true);
  assert.equal(game.startRaid({ kit: 'scout', seed: 612 }), true);
});

test('dropping and picking up keeps one world instance and does not duplicate value', async t => {
  const game = await gameFor(t); game.startRaid({ seed: 605 }); quiet(game);
  const first = game.state.loot[0]; game.teleport(first.x, first.z); game.interact();
  assert.equal(game.state.raid.value, first.value);
  game.teleport(-7, 38.2); game.state.player.yaw = 0;
  assert.equal(game.dropItem(first.id), true);
  assert.equal(game.dropItem(first.id), false);
  assert.equal(game.state.raid.loot.length, 0); assert.equal(game.state.raid.value, 0);
  const dropped = game.state.loot.find(item => item.id === first.id);
  assert.equal(dropped.taken, false);
  assert.equal(isWalkable(dropped.x, dropped.z, .28), true);
  assert.ok(Math.hypot(dropped.x - game.state.player.x, dropped.z - game.state.player.z) < 2.7);
  assert.equal(game.state.loot.filter(item => item.id === first.id).length, 1);
  assert.equal(game.interact(), true);
  assert.equal(game.interact(), false);
  assert.equal(game.state.raid.loot[0].id, first.id); assert.equal(game.state.raid.value, first.value);
  game.pause(true); assert.equal(game.dropItem(first.id), false);
  game.pause(false); assert.equal(game.dropItem(first.id), true);
  assert.equal(game.interact(), true); assert.equal(game.state.raid.value, first.value);
  game.returnToHub(); assert.equal(game.dropItem(first.id), false);
  assert.equal(game.state.profile.intake.length, 0);
});

test('relay is optional and awards its bonus only after successful extraction', async t => {
  const game = await gameFor(t); game.startRaid({ seed: 7 }); quiet(game);
  const bank = game.state.profile.credits;
  game.teleport(RELAY.x, RELAY.z); assert.equal(game.interact(), true);
  assert.equal(game.state.raid.objectiveComplete, true); assert.equal(game.state.profile.credits, bank);
  assert.equal(game.interact(), false); quiet(game);
  game.state.raid.kills = 2;
  const exit = EXTRACTIONS[1]; game.teleport(exit.x, exit.z); game.interact(); run(game, 8.1);
  assert.equal(game.state.result.bonus, 530); assert.equal(game.state.profile.credits, bank + 530);
});

test('timeout and abandoning a paused raid lose carried value without charging twice', async t => {
  const game = await gameFor(t); game.startRaid({ kit: 'assault', seed: 8 }); quiet(game);
  const bank = game.state.profile.credits; assert.equal(bank, 400);
  const first = game.state.loot[0]; game.teleport(first.x, first.z); game.interact();
  game.state.raid.timeLeft = 0.02; run(game, 0.1);
  assert.equal(game.state.phase, 'dead'); assert.equal(game.state.result.total, 0); assert.equal(game.state.profile.credits, bank);
  game.returnToHub(); assert.equal(game.state.phase, 'hub');
  game.startRaid({ seed: 9 }); quiet(game); game.teleport(first.x, first.z); game.interact();
  game.pause(true); game.returnToHub(); assert.equal(game.state.phase, 'hub');
  assert.equal(game.state.profile.credits, bank); assert.equal(game.state.profile.raids, 2); assert.equal(game.state.profile.extracts, 0);
});

test('upgrades have increasing costs, a hard cap and apply on the next raid', async t => {
  const game = await gameFor(t, { credits: 10000 });
  assert.equal(game.buyUpgrade('bogus'), false);
  for (let i = 0; i < 3; i++) assert.equal(game.buyUpgrade('armor'), true);
  assert.equal(game.buyUpgrade('armor'), false);
  assert.equal(game.buyUpgrade('backpack'), true);
  assert.equal(game.state.profile.credits, 10000 - UPGRADE_COSTS.armor.reduce((a, b) => a + b) - 500);
  game.startRaid({ seed: 10 }); assert.equal(game.state.player.armor, 90); assert.equal(game.state.raid.capacity, 10);
  assert.equal(game.buyUpgrade('weapon'), false);
});

test('a live guard acquires a visible target and inflicts damage after its reaction delay', async t => {
  const game = await gameFor(t); game.startRaid({ seed: 1201 });
  game.teleport(-52, 40);
  const guard = game.state.enemies[1];
  Object.assign(guard, { x: -52, z: 25, yaw: Math.PI, home: { x: -52, z: 25 },
    flank: false, alert: 0, fireTimer: 0, path: [], pathTimer: 0 });
  game.state.enemies = [guard]; game.drainEvents();
  run(game, 0.4);
  assert.equal(game.state.player.hp, 100);
  assert.equal(game.state.player.armor, 30);
  assert.equal(guard.mode, 'attack');
  assert.ok(guard.alert > 0);
  // Accuracy includes seeded misses; allow a bounded engagement, stopping at the first hit.
  for (let i = 0; i < 12 * 60 && game.state.player.hp === 100; i++) game.update(1 / 60);
  const events = game.drainEvents();
  assert.ok(events.some(e => e.type === 'enemyShot'));
  assert.ok(events.some(e => e.type === 'damage'));
  assert.ok(game.state.player.hp < 100);
  assert.ok(game.state.player.armor < 30);
});

test('solid cover blocks guard fire while gunshots trigger an obstacle-safe search route', async t => {
  const game = await gameFor(t); game.startRaid({ seed: 1202 });
  game.teleport(-10, -15);
  const guard = game.state.enemies[1];
  Object.assign(guard, { x: -39, z: -15, yaw: -Math.PI / 2, home: { x: -39, z: -15 },
    flank: false, alert: 0, fireTimer: 0, patrol: { x: -39, z: -15 }, path: [], pathTimer: 0 });
  game.state.enemies = [guard]; game.drainEvents();
  assert.ok(Math.hypot(guard.x - game.state.player.x, guard.z - game.state.player.z) < 30);
  assert.equal(hasLineOfSight(guard, game.state.player), false);
  assert.equal(game.fire({ x: 0, y: 0, z: 1 }), true);
  assert.ok(guard.alert >= 7, 'Gunshot was not heard through nearby cover');
  assert.deepEqual(guard.lastSeen, { x: game.state.player.x, z: game.state.player.z });
  const original = { x: guard.x, z: guard.z };
  const routeBefore = findPath(guard, game.state.player).length;
  for (let i = 0; i < 240; i++) {
    game.update(1 / 60);
    assert.equal(isWalkable(guard.x, guard.z, 0.38), true, 'Searching guard entered a solid obstacle');
  }
  assert.equal(guard.mode, 'search');
  assert.ok(Math.hypot(guard.x - original.x, guard.z - original.z) > 5, 'Guard failed to investigate the sound');
  assert.ok(findPath(guard, game.state.player).length < routeBefore, 'Guard did not make progress along its route');
  assert.equal(hasLineOfSight(guard, game.state.player), false);
  assert.equal(game.state.player.hp, 100);
  assert.equal(game.state.player.armor, 30);
  const events = game.drainEvents();
  assert.equal(events.some(e => e.type === 'enemyShot' || e.type === 'damage'), false);
});
