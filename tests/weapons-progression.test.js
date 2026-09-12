import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, validateProfile, KIT_COSTS } from '../src/simulation.js';
import { WEAPONS, getWeapon } from '../src/weapons.js';
import { SKILL_BRANCHES, SKILL_NODES, getProgression, getSkillEffects, canUnlockSkill } from '../src/progression.js';
import { EXTRACTIONS } from '../src/layout.js';
import { approachContainer, openContainer } from './container-helpers.js';
import { ownedProfile } from './loadout-helpers.js';
import { resolveLoadout } from '../src/loadouts.js';

const run = (game, seconds, input = {}) => { for (let i = 0; i < Math.ceil(seconds * 60); i++) game.update(1 / 60, input); };
async function setup(t, saved = {}, weapon = 'VX-9') {
  const profile = weapon === 'VX-9' ? {credits:10000,...saved} : ownedProfile({credits:10000,...saved,weapon,gear:['pack-sling','carrier-web','plate-fiber','helmet-bump']});
  const game = await createGame(profile, { externalAI: true }); t.after(() => game.dispose());
  assert.equal(game.startRaid({ seed: 1701 }), true); game.state.enemies = []; return game;
}
const aim = (game, x, z, y = 1.1) => ({ x: x - game.state.player.x, y: y - game.state.player.y - 1.65, z: z - game.state.player.z });
const enemy = (id, x, z, hp = 95, kind = 'guard') => ({ id, x, z, hp, kind, dead: false, fireTimer: 100, alert: 0, pathTimer: 0 });
const allSkills = { xp: 10000, unlocked: SKILL_NODES.map(node => node.id) };

test('32 unique weapons retain the original eight profiles and provide nine receiver families', () => {
  assert.equal(WEAPONS.length,32);
  assert.deepEqual(WEAPONS.slice(0,8).map(weapon => weapon.id), ['VX-9', 'AR-4', 'BR-12', 'SG-8', 'DMR-7', 'SR-90', 'MG-60', 'RV-6']);
  assert.equal(new Set(WEAPONS.map(weapon => weapon.model)).size, 9);
  assert.equal(getWeapon('invalid'), null);
  for (const weapon of WEAPONS) {
    assert.equal(getWeapon(weapon.id), weapon);
    for (const key of ['damage', 'magSize', 'reserve', 'fireInterval', 'reloadSeconds', 'pellets', 'range']) assert.ok(weapon[key] > 0, `${weapon.id}.${key}`);
    for (const key of ['spread', 'cost', 'recoilPitch', 'recoilYaw']) assert.ok(Number.isFinite(weapon[key]) && weapon[key] >= 0);
    assert.equal(typeof weapon.automatic, 'boolean'); assert.ok(weapon.category && weapon.description && weapon.sound);
  }
  assert.equal(getWeapon('VX-9').recoilPitch, .005); assert.equal(getWeapon('AR-4').recoilPitch, .0066);
});

test('separate weapon selection persists and raid costs are validated before mutation', async t => {
  const game = await createGame(); t.after(() => game.dispose());
  assert.equal(game.state.profile.selectedWeapon, null);
  assert.equal(game.startRaid({ kit: 'assault' }), true); assert.equal(game.state.player.weapon, 'AR-4');
  assert.equal(game.state.profile.credits, 400); assert.equal(game.selectWeapon('RV-6'), false);
  game.returnToHub(); assert.equal(game.selectWeapon('SR-90'), false);
  assert.equal(game.purchaseEquipment('SR-90'),false);
  game.state.profile.credits = 10000;
  assert.equal(game.purchaseEquipment('SR-90'),true);assert.equal(game.selectWeapon('SR-90'),true);
  assert.equal(game.getSave().profile.selectedWeapon, 'SR-90');
  const raids = game.state.profile.raids, purchasedCredits = game.state.profile.credits;
  assert.equal(game.startRaid({ weapon: 'NO-GUN' }), false);
  assert.equal(game.state.profile.raids,raids);assert.equal(game.state.profile.credits,purchasedCredits);
  const supplyCost = resolveLoadout(game.state.profile).cost;
  assert.equal(game.startRaid(), true);assert.equal(game.state.player.weapon,'SR-90');
  assert.equal(game.startRaid(),false);assert.equal(game.state.profile.credits,purchasedCredits - supplyCost);
  for (const weapon of WEAPONS) {
    const equipped = await setup(t, {}, weapon.id), p = equipped.state.player;
    assert.equal(p.ammo, weapon.magSize); assert.equal(p.reserve, weapon.reserve); assert.equal(p.reloadDuration, weapon.reloadSeconds);
    assert.equal(equipped.state.profile.credits, weapon.id === 'VX-9' ? 10000 : 10000 - weapon.purchaseCost - 1060 - weapon.ammoCost - 50);
  }
});

test('automatic weapons repeat while every semi, pump, bolt and revolver requires a new trigger', async t => {
  for (const weapon of WEAPONS) {
    const game = await setup(t, {}, weapon.id), p = game.state.player;
    assert.equal(game.fire({ x: 0, y: .1, z: -1 }, { triggerPressed: true }), true);
    assert.equal(p.shotTimer, weapon.fireInterval); assert.equal(p.cycleDuration, weapon.fireInterval);
    assert.equal(game.fire({ x: 0, y: .1, z: -1 }, { triggerPressed: true }), false);
    run(game, weapon.fireInterval + .02);
    assert.equal(game.fire({ x: 0, y: .1, z: -1 }, { triggerPressed: false }), weapon.automatic, weapon.id);
    if (!weapon.automatic) assert.equal(game.fire({ x: 0, y: .1, z: -1 }), true, 'Direct call means a single fresh trigger');
    assert.equal(p.ammo, weapon.magSize - 2);
    game.state.activeContainerId = 'open-panel'; run(game, weapon.fireInterval + .02);
    game.state.activeContainerId = 'open-panel';
    assert.equal(game.fire({ x: 0, y: .1, z: -1 }), false, 'Container UI blocks even a queued trigger');
    game.state.activeContainerId = null; p.ammo = 1; p.reserve = 3;
    assert.equal(game.reload(), true); run(game, weapon.reloadSeconds + .02);
    assert.equal(p.ammo, Math.min(4,p.magSize)); assert.equal(p.reserve, 4 - Math.min(4,p.magSize));
  }
});

test('shotgun traces ten pellets once, keeps cover authoritative and awards one kill', async t => {
  const game = await setup(t, {}, 'SG-8');
  const target = enemy('shotgun-target', -7, 44); game.state.enemies = [target];
  game.drainEvents(); assert.equal(game.fire(aim(game, target.x, target.z)), true);
  const events = game.drainEvents();
  assert.equal(events.filter(event => event.type === 'shot').length, 1);
  assert.equal(events.find(event => event.type === 'shot').pelletEnds.length, 10);
  assert.equal(events.filter(event => event.type === 'kill').length, 1); assert.equal(target.dead, true);
  assert.equal(game.state.player.ammo, 7); assert.equal(game.state.profile.progression.xp, 50);
  game.teleport(-44, 34); game.state.enemies = [enemy('covered', -44, 9)]; run(game, .9);
  game.fire(aim(game, -40, 9)); assert.equal(game.state.enemies[0].hp, 95);
});

test('weapon range rejects targets beyond its hitscan reach', async t => {
  const game = await setup(t, {}, 'RV-6'); game.teleport(-140, 130);
  const target = enemy('distant', -140, 45); game.state.enemies = [target];
  game.fire(aim(game, target.x, target.z)); assert.equal(target.hp, 95);
  game.returnToHub();assert.equal(game.purchaseEquipment('SR-90'),true);assert.equal(game.selectWeapon('SR-90'),true);
  game.startRaid({ seed: 1701 }); game.teleport(-140, 130); game.state.enemies = [target];
  game.fire(aim(game, target.x, target.z)); assert.ok(target.hp < 95);
});

test('24-node tree has four actual forks and gated capstones; point spending cannot duplicate', async t => {
  assert.equal(SKILL_BRANCHES.length, 4); assert.equal(SKILL_NODES.length, 24); assert.equal(new Set(SKILL_NODES.map(node => node.id)).size, 24);
  for (const branch of SKILL_BRANCHES) {
    const nodes = SKILL_NODES.filter(node => node.branch === branch.id); assert.equal(nodes.length, 6);
    const root = nodes.find(node => !node.requires.length), cap = nodes.find(node => node.cost === 2);
    assert.equal(nodes.filter(node => node.requires.includes(root.id)).length, 2); assert.equal(cap.requires.length, 2);
    for (const node of nodes) assert.ok(Object.keys(node.effects).length > 0);
  }
  const game = await createGame(); t.after(() => game.dispose());
  assert.equal(getProgression(game.state.profile).availablePoints, 3);
  assert.equal(canUnlockSkill(game.state.profile, 'combat-master'), false);
  assert.equal(game.unlockSkill('weapon-2'), false); assert.equal(game.unlockSkill('invalid'), false);
  assert.equal(game.unlockSkill('weapon-1'), true); assert.equal(game.unlockSkill('weapon-1'), false);
  assert.equal(game.unlockSkill('reload-drill'), true); assert.equal(game.unlockSkill('steady-hands'), true);
  assert.equal(getProgression(game.state.profile).availablePoints, 0); assert.equal(game.unlockSkill('armor-1'), false);
  game.state.profile.progression.xp = 249; assert.equal(getProgression(game.state.profile).availablePoints, 0);
  game.state.profile.progression.xp = 250;
  assert.deepEqual(getProgression(game.state.profile), { level: 2, xp: 250, xpIntoLevel: 0, xpToNext: 250, availablePoints: 1, spentPoints: 3, unlocked: ['weapon-1', 'reload-drill', 'steady-hands'] });
  game.startRaid(); assert.equal(game.unlockSkill('armor-1'), false); game.pause(); assert.equal(game.unlockSkill('armor-1'), false);
});

test('legacy ranks retain every paid effect without double application or extra spendable points', async t => {
  const legacy = { upgrades: { armor: 3, backpack: 3, weapon: 3 } };
  const profile = validateProfile(legacy), effects = getSkillEffects(profile);
  assert.equal(getProgression(profile).availablePoints, 3); assert.equal(getProgression(profile).spentPoints, 9);
  assert.equal(profile.progression.legacyPoints, 9); assert.equal(effects.armorBonus, 60); assert.equal(effects.capacityBonus, 6);
  assert.ok(Math.abs(effects.damageBonus - .3) < 1e-9); assert.deepEqual(validateProfile(profile), profile);
  const malformed = validateProfile({ ...legacy, progression: { xp: NaN, unlocked: SKILL_NODES.map(node => node.id) } });
  for (const kind of ['armor', 'backpack', 'weapon']) for (let i = 1; i <= 3; i++) assert.ok(malformed.progression.unlocked.includes(`${kind}-${i}`));
  assert.ok(getProgression(malformed).availablePoints >= 0);
  const game = await setup(t, legacy); assert.equal(game.state.player.armor, 90); assert.equal(game.state.raid.capacity, 14);
  const target = enemy('legacy-damage', -7, 44, 1000); game.state.enemies = [target];
  game.fire(aim(game, target.x, target.z)); assert.ok(Math.abs(1000 - target.hp - 28 * 1.3) < 1e-6);
});

test('skill effects change supply, healing, damage, movement, stamina, search and extraction', async t => {
  const game = await setup(t, { progression: allSkills }), base = await setup(t);
  const p = game.state.player, effect = getSkillEffects(game.state.profile);
  assert.equal(p.maxHp, 120); assert.equal(p.hp, 120); assert.equal(p.maxStamina, 130); assert.equal(p.stamina, 130);
  assert.equal(p.armor, 90); assert.equal(p.medkits, 3); assert.equal(p.reserve, Math.round(72 * 1.2));
  assert.equal(p.recoilMultiplier, .85); assert.equal(game.state.raid.capacity, 14); assert.equal(game.state.raid.extractionDuration, 7);
  p.ammo = 0; game.reload(); assert.ok(Math.abs(p.reloadDuration - 1.7 * .88 * .93) < 1e-9); run(game, p.reloadDuration + .02);
  p.hp = 20; p.armor = 0; game.heal(); assert.equal(p.healDuration, 2.2 * .82); run(game, p.healDuration + .02); assert.equal(p.hp, 85);
  game.receiveDamage(10, { x: 0, z: 0 }); assert.equal(p.hp, 75.6);
  game.teleport(-140, 130); base.teleport(-140, 130); const oldZ = p.z;
  run(game, 1, { forward: 1 }); run(base, 1, { forward: 1 });
  assert.ok((oldZ - p.z) / (oldZ - base.state.player.z) > 1.055);
  p.stamina = 50; run(game, 1); assert.ok(Math.abs(p.stamina - 68) < .01);
  run(game, 1, { forward: 1, sprint: true }); assert.ok(Math.abs(p.stamina - (68 - 23 * .82)) < .01);
  const container = game.state.containers[0]; approachContainer(game, container); assert.equal(game.interact(), true);
  assert.equal(game.state.containerSearchRemaining, 1.5 * effect.searchMultiplier); run(game, 1.21); assert.equal(container.searched, true);
  const exit = EXTRACTIONS[0]; game.teleport(exit.x, exit.z); game.interact(); run(game, 7.01);
  assert.equal(game.state.phase, 'extracted'); assert.equal(game.state.result.bonus, 50); assert.equal(game.state.result.xpEarned, 150);
});

test('XP commits once for successful trade claims, kills and extraction and survives death', async t => {
  const game = await setup(t); const container = openContainer(game), item = container.items.find(item => !item.kind);
  game.state.raid.capacity = 0; assert.equal(game.takeContainerItem(container.id, item.id), false); assert.equal(game.state.profile.progression.xp, 0);
  game.state.raid.capacity = 8; assert.equal(game.takeContainerItem(container.id, item.id), true); assert.equal(game.state.profile.progression.xp, 10);
  game.closeContainer(); game.teleport(-140, 130);
  for (let i = 0; i < 3; i++) { assert.equal(game.dropItem(item.id), true); assert.equal(game.interact(), true); }
  assert.equal(game.state.profile.progression.xp, 10);
  const elite = enemy('elite-xp', -140, 126, 1, 'elite'); game.state.enemies = [elite];
  game.fire(aim(game, elite.x, elite.z)); assert.equal(game.state.profile.progression.xp, 110);
  run(game, .2); game.fire(aim(game, elite.x, elite.z)); assert.equal(game.state.profile.progression.xp, 110);
  game.endRaid(); assert.equal(game.state.result.xpEarned, 110); assert.equal(game.getSave().profile.progression.xp, 110);
  game.endRaid(); assert.equal(game.state.profile.progression.xp, 110);
  game.returnToHub(); game.startRaid(); game.state.enemies = [];
  const exit = EXTRACTIONS[0]; game.teleport(exit.x, exit.z); game.interact(); run(game, 8.01);
  assert.equal(game.state.profile.progression.xp, 260); assert.equal(game.state.result.xpEarned, 150);
  run(game, 10); game.interact(); assert.equal(game.state.profile.progression.xp, 260);
});
