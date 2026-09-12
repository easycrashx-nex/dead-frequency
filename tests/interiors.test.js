import test from 'node:test';
import assert from 'node:assert/strict';
import { INTERIORS, COLLIDERS, OBSTACLES, SPAWN, layout } from '../src/layout.js';
import { createGame, findPath, hasLineOfSight, isWalkable, traceObstacle } from '../src/simulation.js';
import { takeFirstContainerItem } from './container-helpers.js';

async function setup(t, externalAI = false) {
  const game = await createGame(null, { externalAI }); t.after(() => game.dispose());
  game.startRaid({ seed: 1500 }); if (!externalAI) game.state.enemies = [];
  return game;
}
const run = (game, seconds, input) => { for (let i = 0; i < Math.ceil(seconds * 60); i++) game.update(1 / 60, input); };
function checkRoute(from, path, label) {
  assert.ok(path.length, `Missing route: ${label}`);
  for (const next of path) {
    for (let step = 0; step <= 10; step++) {
      const fraction = step / 10;
      assert.ok(isWalkable(from.x + (next.x - from.x) * fraction, from.z + (next.z - from.z) * fraction, .38), `Route crosses a wall: ${label}`);
    }
    from = next;
  }
}

test('five original footprints expose two unobstructed doors and height-aware shared solids', () => {
  assert.equal(INTERIORS.length, 5); assert.equal(layout.interiors, INTERIORS); assert.equal(layout.colliders, COLLIDERS);
  assert.equal(new Set(COLLIDERS.map(solid => solid.id)).size, COLLIDERS.length);
  for (const room of INTERIORS) {
    const footprint = OBSTACLES.find(obstacle => obstacle.id === room.id);
    for (const key of ['x', 'z', 'w', 'd', 'h']) assert.equal(room[key], footprint[key]);
    assert.equal(COLLIDERS.some(solid => solid.id === room.id), false);
    assert.deepEqual(room.doors.map(door => door.side), ['north', 'south']);
    for (const solid of room.solids) {
      assert.ok(COLLIDERS.includes(solid));
      assert.ok(solid.w > 0 && solid.h > 0 && solid.d > 0 && solid.y - solid.h / 2 >= 0);
    }
    assert.ok(isWalkable(room.x, room.z), `${room.name} ceiling blocks navigation`);
    assert.equal(isWalkable(room.x, room.z, .34, room.ceilingHeight), false, 'Elevated bodies must collide with the roof');
    for (const door of room.doors) {
      assert.ok(door.width >= 3.2 && door.height >= 2.8);
      for (const position of [door.outside, door, door.inside]) assert.ok(isWalkable(position.x, position.z), `${room.name}/${door.side} blocked`);
      assert.ok(hasLineOfSight({ ...door.outside, y: 1.65 }, { ...door.inside, y: 1.65 }));
    }
    const ceilingDistance = traceObstacle({ x: room.x, y: 1.65, z: room.z }, { x: 0, y: 1, z: 0 }, 20);
    assert.ok(Math.abs(ceilingDistance - (room.ceilingHeight - 1.65)) < 1e-8);
  }
});

test('Rapier traverses every room south to north and back without a floor or invisible doorway blocker', async t => {
  const game = await setup(t);
  for (const room of INTERIORS) {
    const [north, south] = room.doors;
    assert.ok(game.teleport(south.outside.x, south.outside.z));
    run(game, (room.d + 4) / 4.4 + .1, { forward: 1, yaw: 0 });
    assert.ok(game.state.player.z < north.z - 1, `${room.name}: north exit not reached`);
    assert.ok(game.state.player.y < .08 && game.state.player.grounded);
    assert.ok(game.teleport(north.outside.x, north.outside.z));
    run(game, (room.d + 4) / 4.4 + .1, { forward: -1, yaw: 0 });
    assert.ok(game.state.player.z > south.z + 1, `${room.name}: south exit not reached`);
    assert.ok(game.state.player.y < .08 && game.state.player.grounded);
  }
});

test('solid wall sections block movement, sight and hitscan while door openings stay clear', async t => {
  const game = await setup(t);
  for (const room of INTERIORS) {
    const south = room.doors[1], x = south.x + south.width / 2 + .9;
    const from = { x, y: 1.65, z: south.z + 1.2 }, to = { x, y: 1.65, z: south.z - 1.2 };
    assert.equal(hasLineOfSight(from, to), false, room.name);
    assert.ok(traceObstacle(from, { x: 0, y: 0, z: -1 }, 5) < 1.3);
    assert.ok(game.teleport(x, from.z));
    run(game, 1, { forward: 1, yaw: 0 });
    assert.ok(game.state.player.z > south.z + .3, `${room.name}: walked through wall`);
    assert.equal(game.teleport(x, south.z - .18), false);
    const enemy = { id: `target-${room.id}`, x, z: to.z, hp: 95, dead: false, fireTimer: 100, alert: 0, pathTimer: 1 };
    game.state.enemies = [enemy];
    assert.equal(game.fire({ x: 0, y: 0, z: -1 }), true);
    assert.equal(enemy.hp, 95, `${room.name}: gunfire passed through wall`);
    game.state.enemies = []; run(game, .12, {});
    enemy.x = south.x; enemy.z = south.inside.z; game.state.enemies = [enemy];
    assert.ok(game.teleport(south.outside.x, south.outside.z));
    assert.equal(game.fire({ x: 0, y: 0, z: -1 }), true);
    assert.ok(enemy.hp < 95, `${room.name}: doorway blocked gunfire`);
    game.state.enemies = []; run(game, .12, {});
    // The lintel and overhead volume block high rays, but not standing eyes.
    assert.equal(hasLineOfSight({ ...south.outside, y: 3.2 }, { ...south.inside, y: 3.2 }), false);
  }
});

test('grid routes reach every entrance and container approach without cutting through thin wall segments', () => {
  for (const room of INTERIORS) {
    for (const door of room.doors) checkRoute(SPAWN, findPath(SPAWN, door.inside), `${room.name}/${door.side}`);
    const west = { x: room.x - room.w / 2 - 2, z: room.z };
    checkRoute(west, findPath(west, room), `${room.name}/west approach`);
    for (const spot of layout.containers.filter(container => container.interiorId === room.id)) {
      const route = findPath(room.doors[1].outside, spot);
      checkRoute(room.doors[1].outside, route, `${room.name}/loot`);
      assert.ok(hasLineOfSight({ ...route.at(-1), y: 1.65 }, { ...spot, y: spot.h + .08 }), `${room.name}: container hidden from its reachable grid cell`);
    }
  }
});

test('live guards follow search routes around exterior walls and enter all five rooms', async t => {
  const game = await setup(t, true), guard = game.state.enemies[0];
  game.state.enemies = [guard];
  const distant = { id: null, state: { phase: 'raid', player: { x: 140, y: 0, z: 140, hp: 100 } }, damage() {} };
  for (const room of INTERIORS) {
    delete guard.ai;
    Object.assign(guard, { x: room.x - room.w / 2 - 2, z: room.z, alert: 60, lastSeen: { x: room.x, z: room.z }, path: [], pathTimer: 0, mode: 'search' });
    let closest = Infinity;
    for (let i = 0; i < 1200; i++) {
      const previous = { x: guard.x, z: guard.z };
      game.advanceEnemies(1 / 60, [distant]);
      checkRoute(previous, [{ x: guard.x, z: guard.z }], `${room.name}/live guard`);
      closest = Math.min(closest, Math.hypot(guard.x - room.x, guard.z - room.z));
    }
    // A guard may already be sweeping nearby rooms at the final timestamp.
    assert.ok(closest < 1.6, `${room.name}: guard never investigated the interior (${closest}m)`);
  }
});

test('off-grid agents and targets beside a thin wall connect to the grid on the reachable side', async t => {
  const outside = { x: -33, z: -26.95 }, inside = { x: -25, z: -15 };
  assert.ok(isWalkable(outside.x, outside.z, .38));
  const incoming = findPath(outside, inside), outgoing = findPath(inside, outside);
  checkRoute(outside, incoming, 'close-wall entry');
  checkRoute(inside, outgoing, 'close-wall exit');
  checkRoute(outgoing.at(-1), [outside], 'close-wall target connection');
  assert.ok(incoming[0].z < -26.95, 'First waypoint must move away from the north wall');
  const game = await setup(t, true), guard = game.state.enemies[0];
  game.state.enemies = [guard];
  Object.assign(guard, { ...outside, alert: 60, lastSeen: inside, path: [], pathTimer: 0, mode: 'search' });
  const distant = { id: null, state: { phase: 'raid', player: { x: 140, y: 0, z: 140, hp: 100 } }, damage() {} };
  let closest = Infinity;
  for (let i = 0; i < 1200; i++) {
    const previous = { x: guard.x, z: guard.z };
    game.advanceEnemies(1 / 60, [distant]);
    checkRoute(previous, [{ x: guard.x, z: guard.z }], 'off-grid/live guard');
    closest = Math.min(closest, Math.hypot(guard.x - inside.x, guard.z - inside.z));
  }
  assert.ok(closest < 1.6, `Guard never reached the interior after the thin-wall detour (${closest}m)`);
});

test('all ten interior containers replace ground treasures and offer reachable contents', async t => {
  const game = await setup(t); game.state.raid.capacity = 30;
  assert.deepEqual(game.state.loot, []);
  for (const room of INTERIORS) {
    const containers = game.state.containers.filter(container => container.interiorId === room.id);
    assert.ok(containers.length);
    for (const container of containers) takeFirstContainerItem(game, container);
  }
  assert.equal(game.state.raid.loot.length, 10);
});

test('loot cannot be collected through thin walls or dropped across them', async t => {
  const game = await setup(t); game.state.loot = [];
  for (const room of INTERIORS) {
    const left = room.x - room.w / 2, z = room.z + room.d / 2 - 1.4;
    const item = { id: `wall-test-${room.id}`, name: 'Prüfbeute', rarity: 'common', value: 10, x: left + .8, z, taken: false };
    game.state.loot.push(item);
    assert.ok(game.teleport(left - .8, z));
    game.state.prompt = { kind: 'loot', id: item.id };
    assert.equal(game.interact(), false); assert.equal(item.taken, false);
    assert.ok(game.teleport(left + .8, z));
    assert.equal(game.interact(), true);
    game.state.player.yaw = Math.PI / 2;
    assert.equal(game.dropItem(item.id), true);
    assert.ok(item.x > left + .36 && item.x < room.x + room.w / 2 - .36, `${room.name}: drop crossed exterior wall`);
    assert.ok(hasLineOfSight({ ...game.state.player, y: 1.1 }, { ...item, y: .55 }));
    assert.equal(game.interact(), true);
  }
});
