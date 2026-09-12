import RAPIER from '@dimforge/rapier3d-compat';
import { layout, COLLIDERS, CONTAINER_SPOTS, SPAWN, EXTRACTIONS, RELAY, WORLD_SIZE } from './layout.js';
import { validateEconomy, createItem, ECONOMY_BALANCE } from './economy.js';
import { CONTAINER_TYPES, CONTAINER_SEARCH_SECONDS, LEGACY_ITEMS, rollContainerItems } from './loot-catalog.js';
import { getWeapon } from './weapons.js';
import { PRESET_KITS, GEAR_SLOTS, LOADOUT_SLOTS, resolveLoadout, validateLoadout, deriveWeapon, deriveGear, getEquipment, cleanLoadoutItem,
  purchaseEquipment as purchaseOwned, equipLoadout as selectOwned, mountAttachment as mountOwned } from './loadouts.js';
import { validateProgression, getSkillEffects, canUnlockSkill } from './progression.js';
import { createEnemyAI } from './enemy-ai.js';
export { ITEM_CATALOG } from './loot-catalog.js';

export const KIT_COSTS = Object.fromEntries(PRESET_KITS.map(kit => [kit.id,kit.cost]));
export const UPGRADE_COSTS = {
  armor: [600, 1100, 1800], backpack: [500, 900, 1500], weapon: [700, 1300, 2000],
};
export const RAID_SECONDS = 720;
const PLAYER_RADIUS = 0.34;
const PLAYER_CENTER = 0.86;
const WALK_COLLIDERS = COLLIDERS.filter(o => o.y - o.h / 2 < PLAYER_CENTER * 2 && o.y + o.h / 2 > .02);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const integer = (value, fallback = 0, max = 1e9) => Number.isFinite(value) ? clamp(Math.floor(value), 0, max) : fallback;
let initialization;

export function validateProfile(saved) {
  const src = saved && typeof saved === 'object' ? saved.profile ?? saved : {};
  const upgrades = {};
  for (const key of Object.keys(UPGRADE_COSTS)) upgrades[key] = integer(src.upgrades?.[key], 0, 3);
  const raids = integer(src.raids);
  const profile = { credits: integer(src.credits, 750, 1e12), raids, extracts: Math.min(raids, integer(src.extracts)),
    best: integer(src.best), upgrades, progression: validateProgression(src.progression, upgrades),
    selectedWeapon: getWeapon(src.selectedWeapon)?.id ?? null, ...validateEconomy(src) };
  profile.loadout = validateLoadout(profile,src.loadout);
  return profile;
}

export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function rayBox(origin, direction, min, max) {
  let near = 0, far = Infinity;
  for (const axis of ['x', 'y', 'z']) {
    if (Math.abs(direction[axis]) < 1e-8) {
      if (origin[axis] < min[axis] || origin[axis] > max[axis]) return Infinity;
    } else {
      let first = (min[axis] - origin[axis]) / direction[axis];
      let second = (max[axis] - origin[axis]) / direction[axis];
      if (first > second) [first, second] = [second, first];
      near = Math.max(near, first); far = Math.min(far, second);
      if (near > far) return Infinity;
    }
  }
  return far < 0 ? Infinity : near;
}

export function traceObstacle(origin, direction, maxDistance = 160) {
  let nearest = maxDistance;
  for (const o of COLLIDERS) {
    const t = rayBox(origin, direction,
      { x: o.x - o.w / 2, y: o.y - o.h / 2, z: o.z - o.d / 2 },
      { x: o.x + o.w / 2, y: o.y + o.h / 2, z: o.z + o.d / 2 });
    nearest = Math.min(nearest, t);
  }
  if (direction.y < -1e-6) nearest = Math.min(nearest, -origin.y / direction.y);
  return nearest;
}

export function hasLineOfSight(a, b) {
  const d = { x: b.x - a.x, y: (b.y ?? 1.35) - (a.y ?? 1.35), z: b.z - a.z };
  const length = Math.hypot(d.x, d.y, d.z);
  if (length < 0.001) return true;
  d.x /= length; d.y /= length; d.z /= length;
  return traceObstacle({ x: a.x, y: a.y ?? 1.35, z: a.z }, d, length) >= length - 0.02;
}

export function isWalkable(x, z, radius = 0.48, y = 0) {
  if (![x, z, radius, y].every(Number.isFinite) || radius < 0) return false;
  if (Math.abs(x) > WORLD_SIZE / 2 - 1 || Math.abs(z) > WORLD_SIZE / 2 - 1) return false;
  return !(y === 0 ? WALK_COLLIDERS : COLLIDERS).some(o => o.y - o.h / 2 < y + PLAYER_CENTER * 2 && o.y + o.h / 2 > y + .02
    && Math.abs(x - o.x) < o.w / 2 + radius && Math.abs(z - o.z) < o.d / 2 + radius);
}

// Thin walls can lie between two free grid cells. Test the swept agent radius
// as well as cell occupancy; cache both directions for later patrol routes.
function walkSegmentClear(from, to, radius) {
  const dx = to.x - from.x, dz = to.z - from.z;
  for (const o of WALK_COLLIDERS) {
    const minX = o.x - o.w / 2 - radius, maxX = o.x + o.w / 2 + radius;
    const minZ = o.z - o.d / 2 - radius, maxZ = o.z + o.d / 2 + radius;
    let near = 0, far = 1;
    if (Math.abs(dx) < 1e-8) { if (from.x < minX || from.x > maxX) continue; }
    else { const a = (minX - from.x) / dx, b = (maxX - from.x) / dx; near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b)); }
    if (Math.abs(dz) < 1e-8) { if (from.z < minZ || from.z > maxZ) continue; }
    else { const a = (minZ - from.z) / dz, b = (maxZ - from.z) / dz; near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b)); }
    if (near <= far) return false;
  }
  return true;
}

// A shared navigation grid connects streets and the accessible ground floors.
const CELL = 2, GRID_SIZE = Math.ceil(WORLD_SIZE / CELL), GRID_ORIGIN = -WORLD_SIZE / 2 + CELL / 2;
const gridPoint = id => ({ x: (id % GRID_SIZE) * CELL + GRID_ORIGIN, z: Math.floor(id / GRID_SIZE) * CELL + GRID_ORIGIN });
const grid = Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, id) => {
  const p = gridPoint(id); return isWalkable(p.x, p.z, 0.58);
});
const checkedEdges = new Uint16Array(grid.length), clearEdges = new Uint16Array(grid.length);
function clearGridEdge(id, next, dx, dz) {
  const bit = 1 << ((dz + 1) * 3 + dx + 1);
  if (!(checkedEdges[id] & bit)) {
    const reverse = 1 << ((1 - dz) * 3 + 1 - dx);
    checkedEdges[id] |= bit; checkedEdges[next] |= reverse;
    if (walkSegmentClear(gridPoint(id), gridPoint(next), .58)) { clearEdges[id] |= bit; clearEdges[next] |= reverse; }
  }
  return !!(clearEdges[id] & bit);
}
function gridId(p) { return clamp(Math.round((p.x - GRID_ORIGIN) / CELL), 0, GRID_SIZE - 1) + clamp(Math.round((p.z - GRID_ORIGIN) / CELL), 0, GRID_SIZE - 1) * GRID_SIZE; }
function closestFree(p, connectionRadius = null) {
  const original = gridId(p);
  const reachable = candidate => connectionRadius === null || walkSegmentClear(p, candidate, connectionRadius);
  if (grid[original] && reachable(gridPoint(original))) return original;
  const cx = original % GRID_SIZE, cz = Math.floor(original / GRID_SIZE);
  let chosen = original, best = Infinity;
  for (let radius = 1; radius < 10; radius++) {
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx, z = cz + dz, id = x + z * GRID_SIZE;
      if (x < 0 || x >= GRID_SIZE || z < 0 || z >= GRID_SIZE || !grid[id]) continue;
      const candidate = gridPoint(id), dist = distance(p, candidate);
      if (dist < best && reachable(candidate)) { best = dist; chosen = id; }
    }
    if (best < Infinity) return chosen;
  }
  return connectionRadius === null ? chosen : -1;
}

export function findPath(from, to) {
  // Agents can stand closer to a wall than the conservative 2 m grid allows.
  // Attach such positions on their own side of the wall. Blocked POI centers
  // retain the existing nearest-free destination semantics.
  const start = closestFree(from, isWalkable(from.x, from.z, .38) ? .38 : null);
  const end = closestFree(to, isWalkable(to.x, to.z, PLAYER_RADIUS) ? PLAYER_RADIUS : null);
  if (start < 0 || end < 0) return [];
  if (start === end) return [gridPoint(end)];
  const costs = new Float32Array(grid.length).fill(Infinity);
  const previous = new Int32Array(grid.length).fill(-1);
  const closed = new Uint8Array(grid.length);
  const frontier = []; costs[start] = 0;
  const ex = end % GRID_SIZE, ez = Math.floor(end / GRID_SIZE);
  const heuristic = id => {
    const dx = Math.abs(id % GRID_SIZE - ex), dz = Math.abs(Math.floor(id / GRID_SIZE) - ez);
    return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz);
  };
  // Heap priority queue keeps cross-map routes fast as the grid grows.
  function push(id, score) {
    const entry = { id, score }; let i = frontier.length; frontier.push(entry);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (frontier[parent].score <= score) break;
      frontier[i] = frontier[parent]; i = parent;
    }
    frontier[i] = entry;
  }
  function pop() {
    const first = frontier[0], tail = frontier.pop();
    if (frontier.length) {
      let i = 0;
      while (i * 2 + 1 < frontier.length) {
        let child = i * 2 + 1;
        if (child + 1 < frontier.length && frontier[child + 1].score < frontier[child].score) child++;
        if (frontier[child].score >= tail.score) break;
        frontier[i] = frontier[child]; i = child;
      }
      frontier[i] = tail;
    }
    return first.id;
  }
  push(start, heuristic(start));
  let found = false;
  while (frontier.length) {
    const current = pop();
    if (closed[current]) continue;
    if (current === end) { found = true; break; }
    closed[current] = 1;
    const cx = current % GRID_SIZE, cz = Math.floor(current / GRID_SIZE);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dz) || cx + dx < 0 || cx + dx >= GRID_SIZE || cz + dz < 0 || cz + dz >= GRID_SIZE) continue;
      const next = current + dx + dz * GRID_SIZE;
      if (!grid[next] || closed[next]) continue;
      if (dx && dz && (!grid[current + dx] || !grid[current + dz * GRID_SIZE])) continue;
      if (!clearGridEdge(current, next, dx, dz)) continue;
      const cost = costs[current] + (dx && dz ? 1.414214 : 1);
      if (cost >= costs[next]) continue;
      costs[next] = cost; previous[next] = current;
      push(next, cost + heuristic(next));
    }
  }
  if (!found) return [];
  const path = []; let cursor = end;
  while (cursor !== start && cursor !== -1) { path.push(gridPoint(cursor)); cursor = previous[cursor]; }
  path.reverse();
  const entry = gridPoint(start);
  if (distance(from, entry) > .001 && !walkSegmentClear(from, path[0], .38)) path.unshift(entry);
  return path;
}

export const TREASURES = ['common', 'rare', 'epic'].map(rarity => LEGACY_ITEMS.filter(item => item.rarity === rarity).map(({ name, value }) => ({ name, value })));
const containerNames = Object.fromEntries(CONTAINER_TYPES.map(type => [type.id, type.name]));
const PATROLS = [
  [-26, 19], [10, 17], [43, 33], [-41, -2], [-7, -4], [28, 1],
  [7, -29], [18, -20], [-41, -38], [21, -43], [44, -27],
  [-105, -83], [-81, -91], [-120, -117],
  [-104, 80], [-115, 107], [-82, 94],
  [-18, -108], [11, -102], [-37, -116],
  [98, -86], [114, -108], [73, -96],
  [106, 26], [113, 54], [90, 22],
  [74, 98], [107, 120], [100, 85],
  [-15, 113], [-37, 123], [-109, -4], [-106, -23],
];

function emptyRaid() {
  return { timeLeft: RAID_SECONDS, kills: 0, loot: [], value: 0, capacity: 8,
    extractionProgress: 0, extractionDuration: 8, extractionName: '', objectiveComplete: false,
    seed: 0, difficulty: 'normal', xpEarned: 0 };
}
function emptyPlayer() {
  return { ...SPAWN, y: 0.02, pitch: 0, hp: 100, armor: 30, stamina: 100, ammo: 24, reserve: 72,
    magSize: 24, weapon: 'VX-9', medkits: 2, reload: 0, heal: 0, maxHp: 100, maxStamina: 100,
    reloadDuration: 1.7, healDuration: 2.2, recoilMultiplier: 1, shotTimer: 0, cycleDuration: .095,
    maxArmor:30,bonusArmor:0,weaponInstance:null,attachments:{},weaponStats:deriveWeapon('VX-9'),equipment:{},gearSpeedMultiplier:1,damageReduction:0,adsSeconds:.19,adsZoom:1.35,
    grounded: true, moving: false, sprinting: false, sprintExhausted: false, crouching: false };
}

export async function createGame(saved = null, options = {}) {
  initialization ??= RAPIER.init();
  await initialization;
  const world = new RAPIER.World({ x: 0, y: -19, z: 0 });
  const halfWorld = WORLD_SIZE / 2;
  world.createCollider(RAPIER.ColliderDesc.cuboid(halfWorld, 0.25, halfWorld).setTranslation(0, -0.25, 0));
  for (const o of COLLIDERS) world.createCollider(RAPIER.ColliderDesc.cuboid(o.w / 2, o.h / 2, o.d / 2).setTranslation(o.x, o.y, o.z));
  for (const [x, z, w, d] of [[-halfWorld, 0, 1, WORLD_SIZE], [halfWorld, 0, 1, WORLD_SIZE], [0, -halfWorld, WORLD_SIZE, 1], [0, halfWorld, WORLD_SIZE, 1]]) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, 10, d / 2).setTranslation(x, 5, z));
  }
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(SPAWN.x, PLAYER_CENTER + 0.02, SPAWN.z));
  const collider = world.createCollider(RAPIER.ColliderDesc.capsule(0.52, PLAYER_RADIUS), body);
  const controller = world.createCharacterController(0.02);
  controller.enableAutostep(0.25, 0.2, false);
  controller.enableSnapToGround(0.3);
  world.timestep = 1 / 60; world.step();
  const state = { phase: 'hub', profile: validateProfile(saved), player: emptyPlayer(), raid: emptyRaid(), enemies: [], loot: [], containers: [], activeContainerId: null, containerSearchRemaining: 0, prompt: null, result: null };
  let events = [], random = seededRandom(1), cooldown = 0, velocityY = 0, jumpHeld = false;
  let extraction = null, raidSerial = 0, disposed = false, lowTimeWarned = false, sprintNeedsRelease = false;
  let skillEffects = getSkillEffects(state.profile);
  const ownerNamespace = String(options.playerId ?? 'solo').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,30);
  const emit = event => events.push(event);
  const notice = text => emit({ type: 'notice', text });
  const alive = () => !disposed && state.phase === 'raid';
  const eye = () => ({ x: state.player.x, y: state.player.y + (state.player.crouching ? 1.17 : 1.65), z: state.player.z });
  const enemyAI = createEnemyAI({ isWalkable, findPath, hasLineOfSight, walkSegmentClear, colliders: COLLIDERS, random: () => random(), shoot: shootEnemy });
  function grantXP(amount, reason) {
    if (!alive()) return;
    const before = state.profile.progression.xp;
    state.profile.progression.xp = Math.min(1e9, before + amount);
    const earned = state.profile.progression.xp - before;
    state.raid.xpEarned += earned;
    if (earned > 0) emit({ type: 'xp', amount: earned, reason });
  }

  function spawnEnemy(x, z, index, kind = 'guard') {
    const home = isWalkable(x, z) ? { x, z } : gridPoint(closestFree({ x, z }));
    return { id: `enemy-${index}`, ...home, y: 0, yaw: random() * Math.PI * 2, hp: kind === 'elite' ? 150 : 95,
      kind, mode: 'patrol', attackFlash: 0, hitFlash: 0, dead: false, home: { ...home },
      patrol: null, path: [], pathTimer: random(), fireTimer: 1.2 + random(), alert: 0, lastSeen: null,
      flank: index % 3 === 0, side: index % 2 ? 1 : -1, phase: random() * 6.28 };
  }

  function startRaid(options = {}) {
    if (disposed || state.phase === 'raid' || state.phase === 'paused') return false;
    if (state.profile.intake.length > 0) { notice('Zuerst die zurückgebrachte Beute zuhause einlagern.'); return false; }
    const difficulty = options.difficulty === 'hard' ? 'hard' : 'normal';
    const resolved = resolveLoadout(state.profile,options);
    if (!resolved.valid) { notice(resolved.reason); return false; }
    const {weapon,cost,gearStats} = resolved;
    if (state.profile.credits < cost) { notice('Nicht genug Credits für dieses Loadout. Das Notfallkit ist kostenlos.'); return false; }
    state.profile.credits -= cost; state.profile.raids++;
    // Explicit seeds support reproducible QA/replays; regular raids get fresh seeds.
    const seed = Number.isFinite(options.seed) ? options.seed >>> 0 : ((Date.now() ^ ++raidSerial * 2654435761) >>> 0);
    state.profile.loadout = structuredClone(resolved.selection);
    const transfer = item => {
      if (!item) return null;
      const copy = structuredClone(item); copy.xpClaimed = true;
      copy.id = `r${seed}-${ownerNamespace}-${item.id}`;
      if (item.attachments) copy.attachments = Object.fromEntries(Object.entries(item.attachments).map(([slot,part]) => [slot,transfer(part)]));
      return copy;
    };
    if (!resolved.issued) {
      const carriedIds = new Set(LOADOUT_SLOTS.map(slot => resolved.selection.custom[slot]).filter(Boolean));
      state.profile.stash = state.profile.stash.filter(item => !carriedIds.has(item.id));
      for (const slot of LOADOUT_SLOTS) state.profile.loadout.custom[slot] = null;
    }
    const weaponInstance = transfer(resolved.weaponInstance);
    const equipment = Object.fromEntries(Object.entries(resolved.equipment).map(([slot,item]) => [slot,transfer(item)]));
    random = seededRandom(seed);
    enemyAI.reset();
    skillEffects = getSkillEffects(state.profile);
    state.player = { ...emptyPlayer(), armor: gearStats.armor + skillEffects.armorBonus,
      weapon: weapon.id, ammo: weapon.magSize, magSize: weapon.magSize, reserve: Math.round(weapon.reserve * skillEffects.reserveMultiplier),
      weaponInstance,weaponStats:weapon,attachments:weapon.attachments,equipment,maxArmor:gearStats.maxArmor + skillEffects.armorBonus,bonusArmor:skillEffects.armorBonus,
      gearSpeedMultiplier:gearStats.speedMultiplier,damageReduction:gearStats.damageReduction,adsSeconds:weapon.adsSeconds,adsZoom:weapon.adsZoom,
      hp: 100 + skillEffects.maxHpBonus, maxHp: 100 + skillEffects.maxHpBonus,
      stamina: 100 + skillEffects.staminaBonus, maxStamina: 100 + skillEffects.staminaBonus, medkits: resolved.medkits + skillEffects.extraMedkits,
      recoilMultiplier: skillEffects.recoilMultiplier, reloadDuration: weapon.reloadSeconds * skillEffects.reloadMultiplier,
      healDuration: 2.2 * skillEffects.healDurationMultiplier, cycleDuration: weapon.fireInterval };
    state.raid = { ...emptyRaid(), capacity: gearStats.capacity + skillEffects.capacityBonus, extractionDuration: 8 * skillEffects.extractionMultiplier, difficulty, seed,loadoutMode:resolved.selection.mode,equipmentSpilled:false };
    state.result = null; state.prompt = null; cooldown = 0; velocityY = 0; jumpHeld = false; extraction = null; lowTimeWarned = false; sprintNeedsRelease = false;
    body.setTranslation({ x: SPAWN.x, y: PLAYER_CENTER + 0.02, z: SPAWN.z }, true);
    body.setNextKinematicTranslation({ x: SPAWN.x, y: PLAYER_CENTER + 0.02, z: SPAWN.z });
    world.step();
    state.enemies = PATROLS.map(([x, z], i) => spawnEnemy(x, z, i, (difficulty === 'hard' && i % 3 === 0) || i === 9 ? 'elite' : 'guard'));
    state.loot = [];
    state.containers = CONTAINER_SPOTS.map(spot => ({ ...spot, opened: false, searched: false, items: rollContainerItems(spot, random, state.profile.raids, difficulty) }));
    closeContainer();
    events = []; state.phase = 'raid';
    notice('Beute sichern. Lebend extrahieren. Das Relais ist optional.');
    updatePrompt();
    return true;
  }

  function finish(success, reason) {
    if (!alive()) return;
    closeContainer();
    const bonus = success ? state.raid.kills * ECONOMY_BALANCE.killBonus + (state.raid.objectiveComplete ? ECONOMY_BALANCE.relayBonus : 0) + skillEffects.extractionBonus : 0;
    const total = bonus;
    const itemCount = state.raid.loot.length;
    let equipmentCount = 0;
    if (success) {
      grantXP(150, 'extraction');
      state.profile.credits += total; state.profile.extracts++;
      state.profile.intake.push(...state.raid.loot.filter(item => !item.issued).map(item => createItem(state.profile, item)));
      for (const slot of LOADOUT_SLOTS) {
        const carried = slot === 'weapon' ? state.player.weaponInstance : state.player.equipment[slot];
        if (!carried || carried.issued) continue;
        const recovered = createItem(state.profile,carried);
        state.profile.intake.push(recovered); equipmentCount++;
        if (state.raid.loadoutMode === 'custom') state.profile.loadout.custom[slot] = recovered.id;
      }
      state.profile.best = Math.max(state.profile.best, state.raid.value + bonus);
    }
    state.result = { success, value: state.raid.value, kills: state.raid.kills, reason, bonus, total, itemCount,equipmentCount, xpEarned: state.raid.xpEarned };
    state.phase = success ? 'extracted' : 'dead'; state.prompt = null;
    state.player.moving = false; state.player.sprinting = false;
    emit({ type: success ? 'extract' : 'death', ...state.result });
  }

  function applyDamage(amount, enemy) {
    if (!alive() || !Number.isFinite(amount) || amount <= 0) return;
    const p = state.player;
    amount *= (1 - skillEffects.damageReduction) * (1 - (p.damageReduction ?? 0));
    const absorbed = Math.min(p.armor, amount * 0.7);
    p.armor -= absorbed; p.hp = Math.max(0, p.hp - (amount - absorbed));
    let wear = absorbed;
    const skillAbsorbed = Math.min(p.bonusArmor,wear); p.bonusArmor -= skillAbsorbed; wear -= skillAbsorbed;
    const intact = GEAR_SLOTS.map(slot => p.equipment[slot]).filter(item => item && getEquipment(item.catalogId)?.armor > 0);
    const durabilityArmor = intact.reduce((sum,item) => sum + getEquipment(item.catalogId).armor * item.condition,0);
    if (durabilityArmor > 0) for (const item of intact) item.condition = Math.max(0,item.condition * (1 - wear / durabilityArmor));
    p.damageReduction = deriveGear(p.equipment).damageReduction;
    emit({ type: 'damage', amount: amount - absorbed, x: enemy.x, z: enemy.z });
    if (p.hp <= 0) finish(false, 'Im Einsatz gefallen');
  }

  function updatePrompt() {
    state.prompt = null;
    if (!alive()) return;
    const p = state.player;
    if (!state.raid.objectiveComplete && distance(p, RELAY) < 3) {
      state.prompt = { kind: 'relay', id: 'relay', text: `Relais aktivieren · +${ECONOMY_BALANCE.relayBonus} Credits bei Extraktion` }; return;
    }
    let closest, near = 2.7;
    for (const item of state.loot) {
      const d = distance(p, item);
      if (!item.taken && d < near && hasLineOfSight({ ...p, y: p.y + 1.1 }, { ...item, y: 0.55 })) { closest = item; near = d; }
    }
    if (closest) {
      state.prompt = { kind: 'loot', id: closest.id,
        text: closest.kind ? closest.name : state.raid.loot.length >= state.raid.capacity ? 'Rucksack voll · Tab zum Aussortieren' : `${closest.name} · ${closest.value} CR` }; return;
    }
    let container, containerDistance = 3;
    for (const candidate of state.containers) {
      const d = distance(p, candidate);
      if (d <= containerDistance && canReachContainer(candidate)) { container = candidate; containerDistance = d; }
    }
    if (container) {
      const empty = container.searched && container.items.every(item => item.taken);
      state.prompt = { kind: 'container', id: container.id, text: `${containerNames[container.type]} · ${empty ? 'Leer' : container.searched ? 'Öffnen' : 'Durchsuchen'}` }; return;
    }
    const zone = EXTRACTIONS.find(ex => distance(p, ex) <= ex.radius);
    if (zone && !extraction) state.prompt = { kind: 'extract', id: zone.id, text: `${zone.name} · Extraktion anfordern (${state.raid.extractionDuration} s)` };
  }

  function interact() {
    if (!alive()) return false;
    updatePrompt(); const prompt = state.prompt;
    if (!prompt) return false;
    if (prompt.kind === 'loot') {
      const item = state.loot.find(it => it.id === prompt.id && !it.taken);
      if (!item) return false;
      if (!collectItem(item)) return false;
    } else if (prompt.kind === 'container') {
      const container = state.containers.find(value => value.id === prompt.id);
      if (!container || !canReachContainer(container)) return false;
      if (state.activeContainerId === container.id) return true;
      state.activeContainerId = container.id;
      state.containerSearchRemaining = container.searched ? 0 : CONTAINER_SEARCH_SECONDS * skillEffects.searchMultiplier;
      container.opened = true;
      emit({ type: 'containerOpen', containerId: container.id, x: container.x, z: container.z });
    } else if (prompt.kind === 'relay') {
      state.raid.objectiveComplete = true;
      emit({ type: 'relay', x: RELAY.x, z: RELAY.z });
      notice(`Relais gesichert. Verstärkung unterwegs. Extrahiere für +${ECONOMY_BALANCE.relayBonus} CR.`);
      enemyAI.hear(state.enemies, RELAY, { kind: 'alarm', radius: 36 });
      const reinforcements = spawnEnemy(21, -49, 100 + state.enemies.length, 'elite');
      enemyAI.hear([reinforcements], RELAY, { kind: 'alarm', radius: 80 });
      state.enemies.push(reinforcements);
    } else {
      extraction = EXTRACTIONS.find(ex => ex.id === prompt.id);
      state.raid.extractionName = extraction.name; state.raid.extractionProgress = 0;
      notice(`Signal gesendet. Bleibe ${state.raid.extractionDuration} Sekunden in der Extraktionszone.`);
      enemyAI.hear(state.enemies, extraction, { kind: 'alarm', radius: 35 });
    }
    updatePrompt(); return true;
  }

  function canReachContainer(container) {
    const p = state.player;
    return Math.hypot(p.x - container.x, p.z - container.z, p.y) <= 3
      && hasLineOfSight(eye(), { x: container.x, y: container.h + .08, z: container.z });
  }
  function closeContainer() { state.activeContainerId = null; state.containerSearchRemaining = 0; return true; }
  function collectItem(item) {
    if (!item || item.taken) return false;
    if (item.kind === 'ammo') {
      if (!state.player.weaponStats) {notice('Rüste zuerst eine Waffe aus, um Reservemunition aufzunehmen.');return false;}
      state.player.reserve += item.amount;
    }
    else if (item.kind === 'medkit') state.player.medkits += item.amount;
    else {
      if (state.raid.loot.length >= state.raid.capacity) { notice('Rucksack voll. Öffne mit Tab den Rucksack und wirf etwas ab.'); return false; }
      if (!item.xpClaimed) { grantXP(10, 'loot'); item.xpClaimed = true; }
      const carried = {...structuredClone(item),xpClaimed:true};
      delete carried.x; delete carried.y; delete carried.z; delete carried.taken;
      state.raid.loot.push(carried);
      state.raid.value += item.value;
    }
    item.taken = true; emit({ type: 'loot', name: item.name, value: item.value, rarity: item.rarity });
    return true;
  }
  function takeContainerItem(containerId, itemId) {
    if (!alive() || state.activeContainerId !== containerId || typeof containerId !== 'string' || typeof itemId !== 'string' || containerId.length > 100 || itemId.length > 100) return false;
    const container = state.containers.find(value => value.id === containerId);
    if (!container?.searched || !canReachContainer(container)) return false;
    return collectItem(container.items.find(item => item.id === itemId));
  }
  function takeAllContainerItems(containerId) {
    const container = state.containers.find(value => value.id === containerId);
    if (!container) return 0;
    let count = 0;
    for (const item of container.items.slice(0, 8)) if (!item.taken && takeContainerItem(containerId, item.id)) count++;
    return count;
  }
  function updateContainer(dt) {
    if (!state.activeContainerId) return;
    const container = state.containers.find(value => value.id === state.activeContainerId);
    if (!container || !alive() || !canReachContainer(container)) { closeContainer(); return; }
    if (container.searched) { state.containerSearchRemaining = 0; return; }
    state.containerSearchRemaining = Math.max(0, state.containerSearchRemaining - dt);
    if (state.containerSearchRemaining < 1e-7) {
      state.containerSearchRemaining = 0; container.searched = true;
      emit({ type: 'containerSearched', containerId: container.id, x: container.x, z: container.z });
    }
  }

  function dropItem(id) {
    if (!alive()) return false;
    const index = state.raid.loot.findIndex(item => item.id === id);
    if (index < 0) return false;
    const item = state.raid.loot[index];
    if (item.issued || !dropWorldItem(item)) return false;
    state.raid.loot.splice(index, 1);
    state.raid.value = state.raid.loot.reduce((sum, carried) => sum + carried.value, 0);
    updatePrompt(); return true;
  }
  function dropWorldItem(item) {
    const p = state.player;
    let spot = null;
    for (const radius of [1.1, 1.7, 2.2, 0]) {
      for (const angle of [0, .8, -.8, 1.6, -1.6, 2.4, -2.4, Math.PI]) {
        const candidate = { x: p.x - Math.sin(p.yaw + angle) * radius, z: p.z - Math.cos(p.yaw + angle) * radius };
        if (isWalkable(candidate.x, candidate.z, .28) && hasLineOfSight({ x: p.x, y: p.y + 1.1, z: p.z }, { ...candidate, y: .55 })) {
          spot = candidate; break;
        }
      }
      if (spot) break;
    }
    if (!spot) { notice('Hier ist kein erreichbarer Platz zum Ablegen.'); return false; }
    const existing = state.loot.find(worldItem => worldItem.id === item.id);
    if (existing) Object.assign(existing, structuredClone(item),spot, { taken: false });
    else state.loot.push({ ...item, ...spot, taken: false });
    emit({ type: 'drop', id: item.id, name: item.name, value: item.value, ...spot });
    notice(`${item.name} abgelegt.`); return true;
  }

  function refreshEquipment() {
    const p = state.player, gear = deriveGear(p.equipment);
    state.raid.capacity = gear.capacity + skillEffects.capacityBonus;
    p.maxArmor = gear.maxArmor + skillEffects.armorBonus;
    p.armor = gear.armor + p.bonusArmor;
    p.gearSpeedMultiplier = gear.speedMultiplier; p.damageReduction = gear.damageReduction;
  }
  function rememberWeaponAmmo() {
    const p = state.player;
    if (p.weaponInstance) {p.weaponInstance.ammo = p.ammo;p.weaponInstance.reserve = p.reserve;}
  }
  function setRaidWeapon(item) {
    const p = state.player, weapon = item ? deriveWeapon(item.catalogId,item.attachments) : null;
    p.weaponInstance = item; p.weapon = weapon?.id ?? null; p.weaponStats = weapon; p.attachments = weapon?.attachments ?? {};
    p.magSize = weapon?.magSize ?? 0;
    p.ammo = weapon ? Number.isFinite(item.ammo) ? clamp(item.ammo,0,p.magSize) : p.magSize : 0;
    p.reserve = weapon ? Number.isFinite(item.reserve) ? clamp(item.reserve,0,1000) : 0 : 0;
    p.reload = 0; cooldown = 0; p.shotTimer = 0;
    p.reloadDuration = (weapon?.reloadSeconds ?? 1) * skillEffects.reloadMultiplier;
    p.cycleDuration = weapon?.fireInterval ?? 1; p.adsSeconds = weapon?.adsSeconds ?? .2; p.adsZoom = weapon?.adsZoom ?? 1.35;
  }
  function equipRaidItem(id) {
    if (!alive() || typeof id !== 'string') return false;
    const index = state.raid.loot.findIndex(item => item.id === id && !item.issued), item = state.raid.loot[index];
    if (!item || !['weapon','equipment'].includes(item.kind)) return false;
    const slot = item.kind === 'weapon' ? 'weapon' : getEquipment(item.catalogId)?.slot;
    if (!slot) return false;
    const previous = slot === 'weapon' ? state.player.weaponInstance : state.player.equipment[slot];
    if (slot === 'plate' && !state.player.equipment.carrier) {notice('Die Schutzplatte benötigt einen Plattenträger.');return false;}
    const nextEquipment = {...state.player.equipment,...(slot === 'weapon' ? {} : {[slot]:item})};
    const capacity = deriveGear(nextEquipment).capacity + skillEffects.capacityBonus;
    if (state.raid.loot.length - 1 + (previous && !previous.issued ? 1 : 0) > capacity) {notice('Der kleinere Rucksack reicht nicht. Lege zuerst Beute ab.');return false;}
    if (slot === 'weapon') rememberWeaponAmmo();
    state.raid.loot.splice(index,1);
    if (previous && !previous.issued) state.raid.loot.push(previous);
    if (slot === 'weapon') setRaidWeapon(item); else state.player.equipment[slot] = item;
    refreshEquipment();
    state.raid.value = state.raid.loot.reduce((sum,carried) => sum + carried.value,0);
    notice(`${item.name} ausgerüstet.`); updatePrompt();return true;
  }
  function dropEquipment(slot) {
    if (!alive() || !LOADOUT_SLOTS.includes(slot)) return false;
    const item = slot === 'weapon' ? state.player.weaponInstance : state.player.equipment[slot];
    if (!item || item.issued) {notice('Gestellte Kit-Ausrüstung kann nicht abgelegt werden.');return false;}
    if (slot === 'carrier' && state.player.equipment.plate) {notice('Lege zuerst die Schutzplatte ab.');return false;}
    const nextEquipment = {...state.player.equipment}; delete nextEquipment[slot];
    if (state.raid.loot.length > deriveGear(nextEquipment).capacity + skillEffects.capacityBonus) {notice('Ohne diesen Rucksack passt die Beute nicht. Lege zuerst Beute ab.');return false;}
    if (slot === 'weapon') rememberWeaponAmmo();
    if (!dropWorldItem(item)) return false;
    if (slot === 'weapon') setRaidWeapon(null); else delete state.player.equipment[slot];
    refreshEquipment(); updatePrompt();return true;
  }
  function spillEquipment() {
    if (!['raid','dead'].includes(state.phase) || state.raid.equipmentSpilled) return 0;
    rememberWeaponAmmo(); let count = 0;
    for (const slot of LOADOUT_SLOTS) {
      const item = slot === 'weapon' ? state.player.weaponInstance : state.player.equipment[slot];
      if (item && !item.issued) {state.raid.loot.push(item);count++;}
    }
    state.raid.equipmentSpilled = true;
    state.player.weaponInstance = null; state.player.equipment = {};
    state.raid.value = state.raid.loot.reduce((sum,carried) => sum + carried.value,0);
    return count;
  }

  function reload() {
    const p = state.player;
    if (!alive() || !p.weaponStats || p.reload > 0 || p.heal > 0 || p.ammo >= p.magSize || p.reserve <= 0) return false;
    p.reload = p.reloadDuration = p.weaponStats.reloadSeconds * skillEffects.reloadMultiplier;
    emit({ type: 'reload', duration: p.reload }); return true;
  }
  function heal() {
    const p = state.player;
    if (!alive() || p.medkits <= 0 || p.hp >= p.maxHp || p.heal > 0 || p.reload > 0) return false;
    p.heal = p.healDuration = 2.2 * skillEffects.healDurationMultiplier;
    emit({ type: 'heal', duration: p.healDuration, stage: 'start' }); return true;
  }

  function fire(direction, { triggerPressed = true } = {}) {
    const p = state.player, weapon = p.weaponStats;
    if (!alive() || !weapon || state.activeContainerId || cooldown > 1e-7 || p.reload > 0 || p.sprinting || (!weapon.automatic && triggerPressed !== true)) return false;
    if (!direction || ![direction.x, direction.y, direction.z].every(Number.isFinite)) return false;
    const len = Math.hypot(direction.x, direction.y, direction.z);
    if (len < 0.01) return false;
    if (p.ammo <= 0) { reload(); return false; }
    if (p.heal > 0) { p.heal = 0; notice('Behandlung abgebrochen.'); }
    p.ammo--; cooldown = p.shotTimer = p.cycleDuration = weapon.fireInterval;
    const origin = eye(), dir = { x: direction.x / len, y: direction.y / len, z: direction.z / len };
    const pelletEnds = [], hits = new Map();
    // Trace the complete shot before applying damage, so early pellets cannot
    // delete a target and let later pellets pass through its body.
    const horizontal = Math.hypot(dir.x, dir.z);
    const right = horizontal > 1e-7 ? { x: -dir.z / horizontal, y: 0, z: dir.x / horizontal } : { x: 1, y: 0, z: 0 };
    const up = { x: right.y * dir.z - right.z * dir.y, y: right.z * dir.x - right.x * dir.z, z: right.x * dir.y - right.y * dir.x };
    for (let pellet = 0; pellet < weapon.pellets; pellet++) {
      const angle = weapon.spread > 0 ? random() * Math.PI * 2 : 0;
      const radius = weapon.spread > 0 ? Math.sqrt(random()) * weapon.spread : 0;
      const dx = dir.x + (right.x * Math.cos(angle) + up.x * Math.sin(angle)) * radius;
      const dy = dir.y + up.y * Math.sin(angle) * radius;
      const dz = dir.z + (right.z * Math.cos(angle) + up.z * Math.sin(angle)) * radius;
      const length = Math.hypot(dx, dy, dz), ray = { x: dx / length, y: dy / length, z: dz / length };
      let nearest = traceObstacle(origin, ray, weapon.range), victim = null, headshot = false;
      for (const e of state.enemies) {
        if (e.dead) continue;
        const torso = rayBox(origin, ray, { x: e.x - .34, y: .22, z: e.z - .28 }, { x: e.x + .34, y: 1.48, z: e.z + .28 });
        const ox = origin.x - e.x, oy = origin.y - 1.69, oz = origin.z - e.z;
        const b = ox * ray.x + oy * ray.y + oz * ray.z;
        const discriminant = b * b - (ox * ox + oy * oy + oz * oz - .24 * .24);
        const head = discriminant >= 0 && -b - Math.sqrt(discriminant) > 0 ? -b - Math.sqrt(discriminant) : Infinity;
        const hitDistance = Math.min(torso, head);
        if (hitDistance < nearest) { nearest = hitDistance; victim = e; headshot = head < torso; }
      }
      const point = { x: origin.x + ray.x * nearest, y: origin.y + ray.y * nearest, z: origin.z + ray.z * nearest };
      pelletEnds.push(point);
      if (victim) {
        const hit = hits.get(victim) ?? { damage: 0, headshot: false, point };
        const falloff = clamp(1 - Math.max(0, nearest - 20) * .009, .62, 1);
        hit.damage += weapon.damage * (1 + skillEffects.damageBonus) * (headshot ? 2.9 : 1) * falloff;
        hit.headshot ||= headshot; hits.set(victim, hit);
      }
    }
    const to = pelletEnds[0];
    emit({ type: 'shot', from: origin, to, ...to, weapon: p.weapon, soundRadius:weapon.soundRadius,noiseMultiplier:weapon.noiseMultiplier, ...(weapon.pellets > 1 ? { pelletEnds } : {}) });
    enemyAI.hear(state.enemies, origin, { kind: 'shot', playerId: options.playerId, radius: weapon.soundRadius });
    for (const [victim, { damage, headshot, point: to }] of hits) {
      victim.hp -= damage; victim.hitFlash = 0.16; victim.fireTimer = Math.max(victim.fireTimer, 0.27);
      victim.alert = Math.max(victim.alert, 12); enemyAI.hit(victim);
      emit({ type: 'hit', ...to, headshot, damage, enemyId: victim.id });
      if (victim.hp <= 0) {
        victim.hp = 0; victim.dead = true; victim.mode = 'dead'; victim.attackFlash = 0;
        state.raid.kills++; emit({ type: 'kill', ...to, headshot, enemyId: victim.id });
        grantXP(victim.kind === 'elite' ? 100 : 50, 'kill');
        state.loot.push({ id: `drop-${victim.id}`, x: victim.x, z: victim.z, name: 'Wachmunition · +18', value: 0, rarity: 'common', kind: 'ammo', amount: 18, taken: false });
        if (victim.kind === 'elite') state.loot.push({ id: `raid-${state.profile.raids}-elite-${victim.id}`, x: victim.x, z: victim.z, name: 'Offiziers-Chip', value: Math.round(420 * ECONOMY_BALANCE.lootValueMultiplier), rarity: 'epic', taken: false });
      }
    }
    return true;
  }

  function shootEnemy(e, victim) {
    const p = victim.state.player, dist = distance(e, p);
    const playerTarget = { x: p.x, y: p.y + (p.crouching ? .95 : 1.3), z: p.z };
    e.fireTimer = (e.kind === 'elite' ? .65 : .92) + random() * .4;
    e.attackFlash = .1;
    const from = { x: e.x, y: 1.43, z: e.z };
    const accuracy = clamp((state.raid.difficulty === 'hard' ? .77 : .63) - dist * .009 - (p.sprinting ? .15 : 0) - (p.crouching ? .1 : 0), .18, .82);
    const hit = random() < accuracy;
    const to = hit ? { ...playerTarget } : { x: p.x + (random() - .5) * 3, y: 1 + random(), z: p.z + (random() - .5) * 3 };
    emit({ type: 'enemyShot', from, to, ...from, enemyId: e.id, ...(victim.id ? { targetPlayerId: victim.id } : {}) });
    if (hit && hasLineOfSight(from, playerTarget)) victim.damage((e.kind === 'elite' ? 18 : 13) * (state.raid.difficulty === 'hard' ? 1.15 : 1), e);
  }
  function updateEnemies(dt, targets = [{ id: null, state, damage: applyDamage }]) {
    enemyAI.update(dt, state.enemies, targets, state.raid.difficulty);
  }

  function update(dt, input = {}) {
    if (!alive() || !Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 0.05);
    const p = state.player;
    cooldown = Math.max(0, cooldown - dt); p.shotTimer = Math.max(0, p.shotTimer - dt);
    state.raid.timeLeft = Math.max(0, state.raid.timeLeft - dt);
    if (state.raid.timeLeft <= 0) { finish(false, 'Einsatzzeit abgelaufen'); return; }
    if (state.raid.timeLeft < 60 && !lowTimeWarned) { lowTimeWarned = true; notice('Noch 60 Sekunden. Jetzt extrahieren.'); }
    if (Number.isFinite(input.yaw)) p.yaw = input.yaw;
    if (Number.isFinite(input.pitch)) p.pitch = clamp(input.pitch, -1.5, 1.5);
    if (p.reload > 0) {
      p.reload = Math.max(0, p.reload - dt);
      if (p.reload === 0) { const amount = Math.min(p.magSize - p.ammo, p.reserve); p.ammo += amount; p.reserve -= amount; }
    }
    if (p.heal > 0) {
      p.heal = Math.max(0, p.heal - dt);
      if (p.heal === 0) { p.medkits--; p.hp = Math.min(p.maxHp, p.hp + 55 + skillEffects.healBonus); emit({ type: 'heal', stage: 'complete' }); }
    }
    const forward = Number.isFinite(input.forward) ? clamp(input.forward, -1, 1) : 0;
    const right = Number.isFinite(input.right) ? clamp(input.right, -1, 1) : 0;
    const magnitude = Math.max(1, Math.hypot(forward, right));
    p.moving = Math.abs(forward) + Math.abs(right) > 0.05;
    p.crouching = !!input.crouch;
    // Empty stamina must not alternate sprint/drain and walk/regenerate every
    // frame. Recover a useful reserve and release Shift once before rearming.
    if (p.stamina <= 0 && !p.sprintExhausted) { p.sprintExhausted = true; sprintNeedsRelease = !!input.sprint; }
    if (!input.sprint) sprintNeedsRelease = false;
    if (p.sprintExhausted && p.stamina >= 20 && !sprintNeedsRelease) p.sprintExhausted = false;
    p.sprinting = !!input.sprint && p.moving && forward > 0 && !p.crouching && !input.aim && !p.sprintExhausted && p.stamina > 0 && p.heal <= 0 && p.reload <= 0;
    p.stamina = clamp(p.stamina + (p.sprinting ? -23 * skillEffects.sprintDrainMultiplier : 15 * skillEffects.staminaRegenMultiplier) * dt, 0, p.maxStamina);
    if (p.sprinting && p.stamina === 0) { p.sprinting = false; p.sprintExhausted = true; sprintNeedsRelease = true; }
    const speed = (p.crouching ? 2.1 : p.sprinting ? 7.2 : input.aim ? 3 : 4.4) * skillEffects.moveSpeedMultiplier * p.gearSpeedMultiplier * (p.weaponStats?.moveMultiplier ?? 1) * (p.heal > 0 ? 0.62 : 1);
    if (input.jump && !jumpHeld && p.grounded && !p.crouching && p.stamina > 10) { velocityY = 6.7; p.stamina -= 10; p.grounded = false; }
    jumpHeld = !!input.jump;
    velocityY -= 19 * dt;
    const wanted = { x: (-Math.sin(p.yaw) * forward + Math.cos(p.yaw) * right) / magnitude * speed * dt,
      y: velocityY * dt, z: (-Math.cos(p.yaw) * forward - Math.sin(p.yaw) * right) / magnitude * speed * dt };
    // Physics owns collision, including world bounds, step-up, sliding and jump landings.
    controller.computeColliderMovement(collider, wanted);
    const delta = controller.computedMovement(), position = body.translation();
    body.setNextKinematicTranslation({ x: position.x + delta.x, y: position.y + delta.y, z: position.z + delta.z });
    world.timestep = dt; world.step();
    const moved = body.translation(); p.x = moved.x; p.y = moved.y - PLAYER_CENTER; p.z = moved.z;
    p.grounded = controller.computedGrounded();
    if (p.grounded && velocityY < 0) velocityY = -0.3;
    if (!options.externalAI) updateEnemies(dt);
    if (!alive()) return;
    if (extraction) {
      if (distance(p, extraction) > extraction.radius || p.y > 1.5) {
        extraction = null; state.raid.extractionProgress = 0; state.raid.extractionName = '';
        notice('Extraktion abgebrochen. Du hast die Zone verlassen.');
      } else {
        state.raid.extractionProgress = Math.min(state.raid.extractionDuration, state.raid.extractionProgress + dt);
        if (state.raid.extractionProgress >= state.raid.extractionDuration - 1e-6) { finish(true, 'Erfolgreich extrahiert'); return; }
      }
    }
    updateContainer(dt); updatePrompt();
  }

  function buyUpgrade(kind) {
    if (disposed || options.loadoutLocked || state.phase !== 'hub' || !Object.hasOwn(UPGRADE_COSTS, kind)) return false;
    const level = state.profile.upgrades[kind], cost = UPGRADE_COSTS[kind][level];
    if (cost === undefined || state.profile.credits < cost) return false;
    state.profile.credits -= cost; state.profile.upgrades[kind]++;
    state.profile.progression = validateProgression(state.profile.progression, state.profile.upgrades);
    notice('Upgrade installiert. Im nächsten Raid aktiv.'); return true;
  }
  function selectWeapon(id) {
    if (disposed || options.loadoutLocked || state.phase !== 'hub' || !getWeapon(id)) return false;
    const owned = state.profile.stash.find(item => item.kind === 'weapon' && item.catalogId === id);
    if (!owned) {notice('Kaufe oder sichere diese Waffe zuerst für dein eigenes Kit.');return false;}
    state.profile.selectedWeapon = id; state.profile.loadout.mode = 'custom';
    return selectOwned(state.profile,'weapon',owned.id);
  }
  const canChangeLoadout = () => !disposed && !options.loadoutLocked && state.phase === 'hub';
  function selectLoadout(selection) {
    if (!canChangeLoadout() || !selection || !['preset','custom'].includes(selection.mode)) return false;
    if (selection.presetId !== undefined && !PRESET_KITS.some(kit => kit.id === selection.presetId)) return false;
    state.profile.loadout.mode = selection.mode;
    if (selection.presetId) state.profile.loadout.presetId = selection.presetId;
    return true;
  }
  function purchaseEquipment(catalogId) {
    if (!canChangeLoadout()) return false;
    const item = purchaseOwned(state.profile,catalogId,() => `item-${state.profile.nextItemId++}`);
    if (!item) {notice('Kauf nicht möglich. Prüfe dein Guthaben.');return false;}
    notice(`${item.name} ins Lager geliefert.`);return true;
  }
  function equipLoadout(slot,itemId) { return canChangeLoadout() && selectOwned(state.profile,slot,itemId); }
  function mountAttachment(weaponItemId,slot,attachmentItemId) {
    if (!canChangeLoadout()) return false;
    return mountOwned(state.profile,weaponItemId,slot,attachmentItemId);
  }
  function unlockSkill(id) {
    if (disposed || options.loadoutLocked || state.phase !== 'hub' || !canUnlockSkill(state.profile, id)) return false;
    state.profile.progression.unlocked.push(id);
    state.profile.progression = validateProgression(state.profile.progression, state.profile.upgrades);
    notice('Fähigkeit freigeschaltet. Im nächsten Raid aktiv.'); return true;
  }

  return {
    state, layout, startRaid, update, fire, reload, heal, interact, dropItem, buyUpgrade, selectWeapon, selectLoadout,purchaseEquipment,equipLoadout,mountAttachment,equipRaidItem,dropEquipment,spillEquipment,unlockSkill, takeContainerItem, takeAllContainerItems, closeContainer,
    // Trusted host adapters. The WebSocket protocol never exposes these methods.
    advanceEnemies(dt, targets) {
      if (!disposed && options.externalAI && Number.isFinite(dt) && dt > 0) updateEnemies(Math.min(dt, .05), targets);
    },
    receiveDamage: applyDamage,
    aiStats: () => enemyAI.stats(),
    endRaid(reason = 'Einsatz abgebrochen') { finish(false, reason); },
    // Reconcile physics and state for deterministic replay setup and QA tooling.
    teleport(x, z, y = 0.02) {
      if (disposed || ![x, y, z].every(Number.isFinite) || !isWalkable(x, z, PLAYER_RADIUS, y) || y < 0 || y > 20) return false;
      body.setTranslation({ x, y: y + PLAYER_CENTER, z }, true);
      body.setNextKinematicTranslation({ x, y: y + PLAYER_CENTER, z });
      world.step();
      Object.assign(state.player, { x, y, z, grounded: y < 0.05 }); velocityY = 0;
      updateContainer(0); updatePrompt(); return true;
    },
    pause(paused = true) {
      if (paused && state.phase === 'raid') { closeContainer(); state.phase = 'paused'; pStop(); }
      else if (!paused && state.phase === 'paused') state.phase = 'raid';
    },
    returnToHub() {
      if (disposed) return;
      if (state.phase === 'paused') state.phase = 'raid';
      if (state.phase === 'raid') finish(false, 'Einsatz abgebrochen');
      state.phase = 'hub'; state.prompt = null; state.result = null; extraction = null; pStop();
    },
    getSave() { return { version: 3, profile: structuredClone(state.profile) }; },
    drainEvents() { const pending = events; events = []; return pending; },
    dispose() { if (disposed) return; disposed = true; world.free(); events = []; },
  };
  function pStop() { state.player.moving = false; state.player.sprinting = false; }
}
