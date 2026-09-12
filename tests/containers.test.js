import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTAINER_TYPES, NEW_ITEMS, LEGACY_ITEMS, ITEM_CATALOG, ITEM_POOLS, CONTAINER_SEARCH_SECONDS } from '../src/loot-catalog.js';
import { CONTAINER_SPOTS, COLLIDERS, INTERIORS } from '../src/layout.js';
import { createGame, isWalkable, hasLineOfSight, traceObstacle } from '../src/simulation.js';
import { approachContainer, openContainer, takeFirstContainerItem } from './container-helpers.js';

const step = (game, seconds, input = {}) => { for (let i = 0; i < Math.ceil(seconds * 60); i++) game.update(1 / 60, input); };
async function setup(t, seed = 1600) {
  const game = await createGame(); t.after(() => game.dispose());
  game.startRaid({ seed }); game.state.enemies = []; return game;
}

test('catalog contains exactly 100 new named trade goods, nine unchanged originals and seven complete thematic pools', () => {
  assert.equal(NEW_ITEMS.length, 100); assert.equal(LEGACY_ITEMS.length, 9); assert.equal(ITEM_CATALOG.length, 109);
  assert.equal(CONTAINER_TYPES.length, 7); assert.equal(Object.keys(ITEM_POOLS).length, 7);
  assert.equal(new Set(ITEM_CATALOG.map(item => item.id)).size, 109);
  assert.equal(new Set(ITEM_CATALOG.map(item => item.name)).size, 109);
  assert.deepEqual(CONTAINER_TYPES.map(type => type.id), ['tools', 'electronics', 'medical', 'ammo', 'provisions', 'industrial', 'security']);
  for (const type of CONTAINER_TYPES) {
    assert.ok(type.name && /^#[\da-f]{6}$/i.test(type.color));
    assert.ok(ITEM_POOLS[type.id].length >= 14);
    for (const item of ITEM_POOLS[type.id]) assert.equal(item.type, type.id);
  }
  for (const item of NEW_ITEMS) {
    assert.ok(item.name.length > 4 && item.name.length < 80 && !item.kind);
    assert.ok(Number.isFinite(item.value) && item.value > 0);
    assert.ok(['common', 'rare', 'epic'].includes(item.rarity));
    assert.ok(ITEM_POOLS[item.type].includes(item));
  }
  assert.deepEqual(LEGACY_ITEMS.map(({ name, value }) => [name, value]), [
    ['Kupferspulen', 120], ['Werkzeugset', 160], ['Industriefilter', 140], ['Militärsensor', 290], ['Funkmodul', 340], ['Titanlegierung', 270],
    ['Verschlüsselter Datenträger', 650], ['Quantenprozessor', 780], ['Prototyp-Optik', 590],
  ]);
});

test('physical containers occupy clear believable footprints and leave every interior center lane open', () => {
  assert.equal(CONTAINER_SPOTS.length, 37);
  assert.equal(new Set(CONTAINER_SPOTS.map(spot => spot.id)).size, CONTAINER_SPOTS.length);
  for (const spot of CONTAINER_SPOTS) {
    assert.equal(spot.rotation, 0); assert.ok(ITEM_POOLS[spot.type]);
    assert.equal(isWalkable(spot.x, spot.z, .34), false);
    const collider = COLLIDERS.find(value => value.id === spot.id);
    assert.ok(collider && collider.y === spot.h / 2);
    for (const other of COLLIDERS) {
      if (other === collider || other.y - other.h / 2 >= spot.h) continue;
      assert.equal(Math.abs(spot.x - other.x) < (spot.w + other.w) / 2 && Math.abs(spot.z - other.z) < (spot.d + other.d) / 2, false, `${spot.id} overlaps ${other.id}`);
    }
    assert.ok(traceObstacle({ x: spot.x, y: spot.h / 2, z: spot.z + spot.d / 2 + .5 }, { x: 0, y: 0, z: -1 }, 2) <= .501);
  }
  for (const room of INTERIORS) {
    assert.ok(CONTAINER_SPOTS.some(spot => spot.interiorId === room.id));
    for (let z = room.doors[0].z - 1; z <= room.doors[1].z + 1; z += .25) assert.ok(isWalkable(room.x, z, .34));
  }
});

test('seeded contents are created once per raid with short unique IDs and no static ground loot', async t => {
  const a = await setup(t), b = await setup(t), different = await setup(t, 1601);
  assert.deepEqual(a.state.loot, []); assert.equal(a.state.activeContainerId, null); assert.equal(a.state.containerSearchRemaining, 0);
  assert.deepEqual(a.state.containers, b.state.containers);
  assert.notDeepEqual(a.state.containers.map(c => c.items), different.state.containers.map(c => c.items));
  const items = a.state.containers.flatMap(container => container.items);
  assert.equal(new Set(items.map(item => item.id)).size, items.length);
  assert.ok(items.every(item => item.id.length <= 100 && !item.taken));
  assert.ok(a.state.containers.every(container => !container.opened && !container.searched && container.items.length >= 3 && container.items.length <= 6));
  for (const container of a.state.containers) for (const item of container.items.filter(item => !item.kind)) assert.ok(ITEM_POOLS[container.type].some(entry => entry.name === item.name));
});

test('search takes 1.5 seconds, repeated interaction never resets it, and reopening never rerolls or replenishes items', async t => {
  const game = await setup(t), container = game.state.containers[0], items = structuredClone(container.items);
  approachContainer(game, container); assert.equal(game.interact(), true);
  assert.equal(container.opened, true); assert.equal(container.searched, false);
  assert.equal(game.state.containerSearchRemaining, CONTAINER_SEARCH_SECONDS);
  assert.equal(game.takeContainerItem(container.id, items[0].id), false);
  step(game, .6); const remaining = game.state.containerSearchRemaining;
  assert.equal(game.interact(), true); assert.equal(game.state.containerSearchRemaining, remaining);
  game.closeContainer(); assert.equal(game.state.containerSearchRemaining, 0);
  assert.equal(game.interact(), true); assert.equal(game.state.containerSearchRemaining, CONTAINER_SEARCH_SECONDS);
  step(game, 1.45); assert.equal(container.searched, false);
  step(game, .06); assert.equal(container.searched, true);
  assert.equal(game.takeContainerItem(container.id, items[0].id), true);
  game.closeContainer(); game.interact();
  assert.equal(game.state.containerSearchRemaining, 0);
  assert.deepEqual(container.items, items.map((item, index) => ({ ...item, taken: index === 0, ...(index === 0 ? { xpClaimed: true } : {}) })));
  assert.equal(game.takeContainerItem(container.id, items[0].id), false);
  const events = game.drainEvents();
  assert.ok(events.some(event => event.type === 'containerOpen' && event.containerId === container.id));
  assert.equal(events.filter(event => event.type === 'containerSearched').length, 1);
});

test('take-all honors capacity, consumes supplies without slots and cannot steal items from another container', async t => {
  const game = await setup(t), container = openContainer(game, game.state.containers.find(value => value.type === 'ammo'));
  game.state.raid.capacity = 2;
  const before = game.state.player.reserve;
  assert.equal(game.takeContainerItem(container.id, game.state.containers[0].items[0].id), false);
  assert.equal(game.takeContainerItem('x'.repeat(101), container.items[0].id), false);
  assert.equal(game.takeAllContainerItems(container.id), 3);
  assert.equal(game.state.raid.loot.length, 2); assert.equal(game.state.player.reserve, before + 36);
  assert.equal(container.items.filter(item => item.taken).length, 3);
  const value = game.state.raid.value;
  assert.equal(game.takeAllContainerItems(container.id), 0); assert.equal(game.state.raid.value, value);
  const first = game.state.raid.loot[0];
  assert.equal(game.dropItem(first.id), true);
  assert.equal(container.items.find(item => item.id === first.id).taken, true);
  assert.equal(game.state.prompt.kind, 'loot', 'Dropped goods need priority over the nearby container');
  assert.equal(game.interact(), true); assert.equal(game.state.raid.value, value);
  assert.equal(game.state.loot.filter(item => item.id === first.id).length, 1);
});

test('wall, range and phase checks protect container search and claims', async t => {
  const game = await setup(t), container = game.state.containers.find(value => value.id === 'booth-records');
  openContainer(game, container);
  assert.ok(game.teleport(5.85, 41.2));
  assert.ok(Math.hypot(game.state.player.x - container.x, game.state.player.z - container.z) < 3);
  assert.equal(hasLineOfSight({ ...game.state.player, y: 1.65 }, { ...container, y: container.h + .08 }), false);
  assert.equal(game.state.activeContainerId, null);
  assert.notEqual(game.state.prompt?.id, container.id);
  game.state.activeContainerId = container.id;
  assert.equal(game.takeContainerItem(container.id, container.items[0].id), false);
  approachContainer(game, container); game.interact();
  game.teleport(0, 50); assert.equal(game.state.activeContainerId, null);
  openContainer(game, container); game.pause();
  assert.equal(game.state.activeContainerId, null); assert.equal(game.takeAllContainerItems(container.id), 0);
  game.pause(false); openContainer(game, container); game.endRaid();
  assert.equal(game.state.activeContainerId, null); assert.equal(game.state.containerSearchRemaining, 0);
  assert.equal(game.takeContainerItem(container.id, container.items[0].id), false);
});

test('every placed container can actually be approached, searched and looted through normal interaction', async t => {
  const game = await setup(t); game.state.raid.capacity = 100;
  for (const container of game.state.containers) takeFirstContainerItem(game, container);
  assert.equal(game.state.raid.loot.length, CONTAINER_SPOTS.length);
  assert.equal(game.state.loot.length, 0);
});
