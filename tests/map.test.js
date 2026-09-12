import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, findPath, isWalkable, RAID_SECONDS } from '../src/simulation.js';
import { WORLD_SIZE, OBSTACLES, SPAWN, POIS, EXTRACTIONS } from '../src/layout.js';
import { storeAll, listItem } from '../src/economy.js';
import { takeFirstContainerItem } from './container-helpers.js';

async function setup(t, saved) {
  const game = await createGame(saved); t.after(() => game.dispose()); return game;
}
const run = (game, seconds, input = {}) => { for (let i = 0; i < Math.ceil(seconds * 60); i++) game.update(1 / 60, input); };
const quiet = game => { game.state.enemies = []; };

test('expanded map has connected outer districts, exits, loot and patrols', async t => {
  const game = await setup(t); game.startRaid({ seed: 300 });
  assert.equal(WORLD_SIZE, 1500); assert.equal(RAID_SECONDS, 1800);
  assert.equal(game.state.raid.timeLeft, 1800);
  assert.ok(OBSTACLES.length >= 100); assert.ok(POIS.length >= 14); assert.ok(EXTRACTIONS.length >= 4);
  assert.equal(game.state.loot.length, 0);
  assert.ok(game.state.containers.flatMap(container => container.items).filter(item => !item.kind).length >= 100);
  assert.ok(game.state.enemies.length >= 30);
  for (const target of [...POIS, ...EXTRACTIONS, ...game.state.loot, ...game.state.enemies]) {
    assert.ok(findPath(SPAWN, target).length, `No route to ${target.name ?? target.id}`);
    if (!POIS.includes(target)) assert.equal(isWalkable(target.x, target.z, .25, target.y), true, `Spawned inside geometry: ${target.name ?? target.id}`);
  }
  for (const container of game.state.containers) assert.ok(findPath(SPAWN, {...container,x:container.x+1.6}).length, `No route to ${container.id}`);
  for (const exit of EXTRACTIONS) {
    assert.equal(game.teleport(exit.x, exit.z), true);
    assert.ok(game.state.prompt?.kind === 'extract');
  }
});

test('physics crosses former world edges and stops at the actual expanded boundary', async t => {
  const game = await setup(t); game.startRaid({ seed: 301 }); quiet(game);
  assert.equal(game.teleport(57, 0), true); run(game, 3, { right: 1, yaw: 0 });
  assert.ok(game.state.player.x > 69, 'Old +60 physics wall remains');
  assert.ok(game.state.player.y < .1 && game.state.player.grounded);
  assert.equal(game.teleport(144, 0), true); run(game, 3, { right: 1, yaw: 0 });
  assert.ok(game.state.player.x>155,'Old +150 boundary remains');
  const edge=WORLD_SIZE/2-6,coordinates=Array.from({length:141},(_,i)=>-700+i*10);
  const eastZ=coordinates.find(z=>[0,1,2,3,4].every(dx=>isWalkable(edge+dx,z)));assert.notEqual(eastZ,undefined);
  assert.equal(game.teleport(edge,eastZ),true);run(game,3,{right:1,yaw:0});
  assert.ok(game.state.player.x < WORLD_SIZE / 2 - .7);
  assert.ok(game.state.player.x > WORLD_SIZE / 2 - 1.5);
  const southX=coordinates.find(x=>[0,1,2,3,4].every(dz=>isWalkable(x,edge+dz)));assert.notEqual(southX,undefined);
  assert.equal(game.teleport(southX,edge),true);run(game,3,{forward:-1,yaw:0});
  assert.ok(game.state.player.z < WORLD_SIZE / 2 - .7);
  assert.ok(game.state.player.grounded);
});

test('v1 saves migrate with credits intact and v2 item IDs survive multiple raids and reloads', async t => {
  const game = await setup(t, { version: 1, profile: { credits: 2400, raids: 8, extracts: 3, upgrades: { armor: 1 } } });
  assert.equal(game.state.profile.credits, 2400);
  assert.deepEqual(game.state.profile.intake, []); assert.deepEqual(game.state.profile.stash, []);
  game.startRaid({ seed: 302 }); quiet(game);
  takeFirstContainerItem(game);
  const exit = EXTRACTIONS[0]; game.teleport(exit.x, exit.z); game.interact(); run(game, 8.1);
  const extractedId = game.state.profile.intake[0].id;
  assert.equal(game.state.profile.credits, 2400);
  const restored = await setup(t, game.getSave());
  assert.equal(restored.state.profile.intake[0].id, extractedId);
  assert.equal(restored.startRaid({ seed: 303 }), false);
  storeAll(restored.state.profile); restored.startRaid({ seed: 303 }); quiet(restored);
  takeFirstContainerItem(restored);
  restored.teleport(exit.x, exit.z); restored.interact(); run(restored, 8.1);
  assert.notEqual(restored.state.profile.intake[0].id, extractedId);
  assert.equal(restored.state.profile.stash[0].id, extractedId);
  assert.equal(restored.state.profile.credits, 2400);
});

test('save is isolated from nested intake, stash, listings and mailbox objects', async t => {
  const item = { id: 'item-1', name: 'Sensor', value: 300, rarity: 'rare' };
  const game = await setup(t, { profile: { credits: 1.2e10, stash: [item], intake: [{ ...item, id: 'item-2' }],
    mailbox: [{ id: 'mail-4', type: 'return', item: { ...item, id: 'item-3' }, createdAt: 1000 }] } });
  assert.equal(game.state.profile.credits, 1.2e10);
  listItem(game.state.profile, 'item-1', 400, 5, 1000);
  const saved = game.getSave();
  saved.profile.intake[0].name = 'changed'; saved.profile.listings[0].item.value = 1;
  saved.profile.mailbox[0].item.name = 'changed'; saved.profile.stash.push(item);
  assert.equal(game.state.profile.intake[0].name, 'Sensor');
  assert.equal(game.state.profile.listings[0].item.value, 300);
  assert.equal(game.state.profile.mailbox[0].item.name, 'Sensor');
  assert.equal(game.state.profile.stash.length, 0);
});
