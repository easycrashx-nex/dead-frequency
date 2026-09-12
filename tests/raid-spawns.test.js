import test from 'node:test';
import assert from 'node:assert/strict';
import { RAID_SPAWNS, getRaidSpawn, getRaidSpawnPositions, selectRaidSpawn } from '../src/raid-spawns.js';
import { createGame, isWalkable } from '../src/simulation.js';
import { createCoopSession } from '../src/coop-session.js';
import { EXTRACTIONS, WORLD_SIZE } from '../src/layout.js';
import { getGroundHeight, isWater, isTerrainWalkable } from '../src/terrain.js';

test('sixteen surveyed entrances cover the map with clear paired positions and safe initial patrol/extraction separation', async t => {
  assert.equal(RAID_SPAWNS.length, 16); assert.equal(new Set(RAID_SPAWNS.map(s => s.id)).size, 16);
  assert.ok(Math.max(...RAID_SPAWNS.map(s => s.x)) - Math.min(...RAID_SPAWNS.map(s => s.x)) > 1200);
  assert.ok(Math.max(...RAID_SPAWNS.map(s => s.z)) - Math.min(...RAID_SPAWNS.map(s => s.z)) > 1200);
  const game = await createGame(null, { externalAI: true }); t.after(() => game.dispose());
  game.startRaid({ seed: 123, spawnId: 'arrival' });
  for (const spawn of RAID_SPAWNS) {
    const positions = getRaidSpawnPositions(spawn);
    assert.ok(Math.hypot(positions[0].x - positions[1].x, positions[0].z - positions[1].z) >= 2.3);
    assert.ok(-Math.sin(spawn.yaw) * -spawn.x + -Math.cos(spawn.yaw) * -spawn.z > 0, `${spawn.id}: face inward`);
    for (const point of positions) {
      assert.ok(Math.abs(point.x) < WORLD_SIZE / 2 - 50 && Math.abs(point.z) < WORLD_SIZE / 2 - 50);
      assert.equal(point.y, getGroundHeight(point.x, point.z));
      for (let index = 0; index < 17; index++) {
        const a = index * Math.PI / 8, r = index === 16 ? 0 : 4;
        const x = point.x + Math.cos(a) * r, z = point.z + Math.sin(a) * r;
        assert.ok(!isWater(x, z) && isTerrainWalkable(x, z) && isWalkable(x, z, .5, getGroundHeight(x, z)), `${spawn.id}: clear ground around both players`);
      }
      assert.ok(Math.min(...game.state.enemies.map(e => Math.hypot(e.x - point.x, e.z - point.z))) > 90, `${spawn.id}: patrol buffer`);
      assert.ok(Math.min(...EXTRACTIONS.map(e => Math.hypot(e.x - point.x, e.z - point.z))) > 85, `${spawn.id}: extraction buffer`);
    }
  }
});

test('independent deterministic seed selection covers all entries and excludes previous teammate spawns', () => {
  const counts = new Map();
  for (let seed = 0; seed < 1000; seed++) {
    const spawn = selectRaidSpawn(seed); counts.set(spawn.id, (counts.get(spawn.id) ?? 0) + 1);
    assert.deepEqual(selectRaidSpawn(seed), spawn);
    assert.notEqual(selectRaidSpawn(seed, spawn.id).id, spawn.id);
    const previous = [spawn.id, RAID_SPAWNS[(seed + 1) % RAID_SPAWNS.length].id];
    assert.ok(!previous.includes(selectRaidSpawn(seed, previous).id));
  }
  assert.equal(counts.size, RAID_SPAWNS.length); assert.ok([...counts.values()].every(count => count >= 35));
  assert.throws(() => getRaidSpawn('not-an-entry'), /Unbekannter/);
});

test('every entry supports real Rapier spawning, settling and inward movement for both team slots', async t => {
  const game = await createGame(null, { externalAI: true }); t.after(() => game.dispose());
  for (const spawn of RAID_SPAWNS) for (const position of getRaidSpawnPositions(spawn)) {
    game.returnToHub(); assert.equal(game.startRaid({ seed: 444, spawnId: spawn.id }), true);
    assert.deepEqual(game.state.raid.spawn, spawn);
    assert.equal(game.teleport(position.x, position.z, position.y + .02), true);
    for (let i = 0; i < 30; i++) game.update(1 / 60, {});
    assert.ok(Math.abs(game.state.player.y - getGroundHeight(game.state.player.x, game.state.player.z)) < .08, `${spawn.id}: grounded after settling`);
    const before = { ...game.state.player };
    for (let i = 0; i < 90; i++) game.update(1 / 60, { forward: 1, yaw: spawn.yaw });
    const player = game.state.player;
    assert.ok(Math.hypot(player.x - before.x, player.z - before.z) > 3, `${spawn.id}: usable inward approach`);
    assert.ok(!isWater(player.x, player.z) && Math.abs(player.y - getGroundHeight(player.x, player.z)) < .15, `${spawn.id}: no fall through terrain`);
  }
});

test('changing only the spawn leaves seeded loot and initial AI identical while local consecutive raids avoid repeats', async t => {
  const a = await createGame(null, { externalAI: true }), b = await createGame(null, { externalAI: true }); t.after(() => { a.dispose(); b.dispose(); });
  a.startRaid({ seed: 972, spawnId: RAID_SPAWNS[0].id }); b.startRaid({ seed: 972, spawnId: RAID_SPAWNS[8].id });
  assert.deepEqual(a.state.containers, b.state.containers); assert.deepEqual(a.state.enemies, b.state.enemies);
  assert.notDeepEqual(a.state.player.x, b.state.player.x);
  a.returnToHub(); a.startRaid({ seed: 122 }); const previous = a.state.raid.spawn.id;
  a.returnToHub(); a.startRaid({ seed: 122 }); assert.notEqual(a.state.raid.spawn.id, previous);
  a.returnToHub(); const before = structuredClone(a.state.profile);
  assert.throws(() => a.startRaid({ seed: 1, spawnId: 'invalid' }), /Unbekannter/); assert.deepEqual(a.state.profile, before);
});

test('a cooperative team shares one chosen spawn, safe distinct positions and common snapshot metadata', async t => {
  for (const spawn of RAID_SPAWNS) {
    let committed;
    const session = createCoopSession({ seed: 573, spawnId: spawn.id, onRaidStart(players, metadata) { committed = metadata.spawn; } });
    try {
      const a = await session.join(), b = await session.join(); session.ready(a, true); session.ready(b, true); session.start(a);
      const ga = session.players.get(a).game, gb = session.players.get(b).game;
      assert.equal(ga.state.raid.spawn.id, spawn.id); assert.deepEqual(ga.state.raid.spawn, gb.state.raid.spawn); assert.deepEqual(committed, spawn);
      assert.ok(Math.hypot(ga.state.player.x - gb.state.player.x, ga.state.player.z - gb.state.player.z) > 2.3);
      assert.equal(ga.state.player.yaw, gb.state.player.yaw); assert.equal(ga.state.raid.seed, gb.state.raid.seed);
      ga.state.enemies.splice(0);
      for (let i = 0; i < 60; i++) session.update(1 / 60);
      for (const id of [a, b]) { const snapshot = session.snapshot(id); assert.equal(snapshot.state.raid.spawn.id, spawn.id); assert.equal(snapshot.state.player.hp, 100); }
    } finally { session.close(); }
  }
  const avoided = selectRaidSpawn(573).id;
  const previous = [];
  const session = createCoopSession({ seed: 573, previousSpawnId: () => previous, minPlayers: 1, maxPlayers: 1 }); t.after(() => session.close());
  previous.push(avoided, RAID_SPAWNS[3].id);
  const id = await session.join(); session.ready(id, true); session.start(id);
  assert.ok(!previous.includes(session.snapshot(id).state.raid.spawn.id));
});

test('trusted transient admin flags bypass damage and stamina drain, reset each raid and cannot be enabled through client input', async t => {
  const session = createCoopSession({ spawnId: 'arrival', minPlayers: 1, maxPlayers: 1 }); t.after(() => session.close());
  const id = await session.join(); session.ready(id, true); session.start(id);
  const game = session.players.get(id).game; game.state.enemies.splice(0);
  session.input(id, 1, { adminGodmode: true, adminStamina: true }); session.update(1 / 60);
  assert.equal(game.state.player.adminGodmode, false); assert.equal(game.state.player.adminStamina, false);
  game.state.player.adminGodmode = true; const hp = game.state.player.hp, armor = game.state.player.armor;
  game.receiveDamage(999999, { x: 0, z: 0 }); assert.equal(game.state.player.hp, hp); assert.equal(game.state.player.armor, armor);
  game.state.player.adminStamina = true; game.state.player.stamina = 0; game.state.player.sprintExhausted = true;
  game.teleport(-52, 0);
  for (let i = 0; i < 180; i++) game.update(1 / 60, { forward: 1, sprint: true, jump: i === 20 });
  assert.equal(game.state.player.stamina, game.state.player.maxStamina); assert.equal(game.state.player.sprintExhausted, false);
  game.state.player.adminStamina = false; game.update(1 / 60, { forward: 1, sprint: true }); assert.ok(game.state.player.stamina < game.state.player.maxStamina);
  game.state.player.adminGodmode = false; game.receiveDamage(10, { x: 0, z: 0 }); assert.ok(game.state.player.hp < hp || game.state.player.armor < armor);
  game.returnToHub(); game.startRaid({ spawnId: 'arrival' });
  assert.equal(game.state.player.adminGodmode, false); assert.equal(game.state.player.adminStamina, false);
  assert.equal(game.getSave().profile.adminGodmode, undefined); assert.equal(game.getSave().profile.adminStamina, undefined);
});
