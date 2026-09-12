import RAPIER from '@dimforge/rapier3d-compat';
import { layout, COLLIDERS, CONTAINER_SPOTS, SPAWN, EXTRACTIONS, RELAY, WORLD_SIZE } from './layout.js';
import * as worldLayout from './layout.js';
import {getGroundHeight,isTerrainWalkable,isWater,createTerrainMesh,WATER_LEVEL,riverCenter} from './terrain.js';
import { validateEconomy, createItem, ECONOMY_BALANCE } from './economy.js';
import { CONTAINER_TYPES, CONTAINER_SEARCH_SECONDS, LEGACY_ITEMS, rollContainerItems } from './loot-catalog.js';
import { getWeapon } from './weapons.js';
import { PRESET_KITS, GEAR_SLOTS, LOADOUT_SLOTS, resolveLoadout, validateLoadout, deriveWeapon, deriveGear, getEquipment, cleanLoadoutItem,
  purchaseEquipment as purchaseOwned, equipLoadout as selectOwned, mountAttachment as mountOwned } from './loadouts.js';
import { validateProgression, getSkillEffects, canUnlockSkill } from './progression.js';
import { createEnemyAI } from './enemy-ai.js';
import { ENEMY_TYPES, ENEMY_SPAWNING, rollCorpseItems } from './enemies.js';
import { getRaidSpawn, selectRaidSpawn } from './raid-spawns.js';
export { ITEM_CATALOG } from './loot-catalog.js';

export const KIT_COSTS = Object.fromEntries(PRESET_KITS.map(kit => [kit.id,kit.cost]));
export const UPGRADE_COSTS = {
  armor: [600, 1100, 1800], backpack: [500, 900, 1500], weapon: [700, 1300, 2000],
};
export const RAID_SECONDS = 1800;
export const REVIVE_SECONDS = 6;
export const BLEEDOUT_SECONDS = 60;
const PLAYER_RADIUS = 0.34;
const PLAYER_CENTER = 0.86;
const SPATIAL_CELL=24, colliderCells=new Map();
for(let id=0;id<COLLIDERS.length;id++){
  const box=COLLIDERS[id];
  for(let x=Math.floor((box.x-box.w/2)/SPATIAL_CELL);x<=Math.floor((box.x+box.w/2)/SPATIAL_CELL);x++)for(let z=Math.floor((box.z-box.d/2)/SPATIAL_CELL);z<=Math.floor((box.z+box.d/2)/SPATIAL_CELL);z++){
    const key=`${x},${z}`;if(!colliderCells.has(key))colliderCells.set(key,[]);colliderCells.get(key).push(id);
  }
}
function nearbyColliders(minX,maxX,minZ,maxZ){
  const ids=new Set();
  for(let x=Math.floor(minX/SPATIAL_CELL);x<=Math.floor(maxX/SPATIAL_CELL);x++)for(let z=Math.floor(minZ/SPATIAL_CELL);z<=Math.floor(maxZ/SPATIAL_CELL);z++)for(const id of colliderCells.get(`${x},${z}`)??[])ids.add(id);
  return [...ids].map(id=>COLLIDERS[id]);
}
const supportHeight=(x,z,y)=>{
  let current=y??getGroundHeight(x,z);
  if(y===undefined)for(const bridge of layout.bridges??[])if(Math.abs(x-bridge.x)<bridge.w/2&&Math.abs(z-bridge.z)<bridge.d/2-.3)current=Math.max(current,bridge.y);
  return worldLayout.getSupportHeight?.(x,z,current)??getGroundHeight(x,z);
};
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
  const end={x:origin.x+direction.x*maxDistance,z:origin.z+direction.z*maxDistance};
  for (const o of nearbyColliders(Math.min(origin.x,end.x),Math.max(origin.x,end.x),Math.min(origin.z,end.z),Math.max(origin.z,end.z))) {
    const t = rayBox(origin, direction,
      { x: o.x - o.w / 2, y: o.y - o.h / 2, z: o.z - o.d / 2 },
      { x: o.x + o.w / 2, y: o.y + o.h / 2, z: o.z + o.d / 2 });
    nearest = Math.min(nearest, t);
  }
  const step=2;
  for(let at=Math.min(step,nearest);at<=nearest;at=Math.min(at+step,nearest)){
    const x=origin.x+direction.x*at,z=origin.z+direction.z*at,y=origin.y+direction.y*at;
    if(y<=getGroundHeight(x,z)){let lo=Math.max(0,at-step),hi=at;for(let i=0;i<9;i++){const mid=(lo+hi)/2;if(origin.y+direction.y*mid<=getGroundHeight(origin.x+direction.x*mid,origin.z+direction.z*mid))hi=mid;else lo=mid;}nearest=hi;break;}
    if(at===nearest)break;
  }
  return nearest;
}

export function hasLineOfSight(a, b) {
  const d = { x: b.x - a.x, y: (b.y ?? 1.35) - (a.y ?? 1.35), z: b.z - a.z };
  const length = Math.hypot(d.x, d.y, d.z);
  if (length < 0.001) return true;
  d.x /= length; d.y /= length; d.z /= length;
  return traceObstacle({ x: a.x, y: a.y ?? 1.35, z: a.z }, d, length) >= length - 0.02;
}

export function isWalkable(x, z, radius = 0.48, y = supportHeight(x,z)) {
  if (![x, z, radius, y].every(Number.isFinite) || radius < 0) return false;
  if (Math.abs(x) > WORLD_SIZE / 2 - 1 || Math.abs(z) > WORLD_SIZE / 2 - 1) return false;
  if(y<getGroundHeight(x,z)-.15 || (!isTerrainWalkable(x,z)&&!(isWater(x,z)&&y>WATER_LEVEL+.5)))return false;
  return !nearbyColliders(x-radius,x+radius,z-radius,z+radius).some(o => o.y - o.h / 2 < y + PLAYER_CENTER * 2 && o.y + o.h / 2 > y + (o.kind==='stair'?.255:.025)
    && Math.abs(x - o.x) < o.w / 2 + radius && Math.abs(z - o.z) < o.d / 2 + radius);
}

// Thin walls can lie between two free grid cells. Test the swept agent radius
// as well as cell occupancy; cache both directions for later patrol routes.
function walkSegmentClear(from, to, radius) {
  const dx=to.x-from.x,dz=to.z-from.z,steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.35));
  let y=from.y??supportHeight(from.x,from.z);
  for(let index=0;index<=steps;index++){
    const f=index/steps,x=from.x+dx*f,z=from.z+dz*f,nextY=supportHeight(x,z,y);
    if(Math.abs(nextY-y)>.5||!isWalkable(x,z,radius,nextY))return false;y=nextY;
  }
  return to.y===undefined||Math.abs(y-to.y)<.55;
}

// A shared navigation grid connects streets and the accessible ground floors.
const CELL = 2, GRID_SIZE = Math.ceil(WORLD_SIZE / CELL), GRID_ORIGIN = -WORLD_SIZE / 2 + CELL / 2;
const gridPoint = id => {const x=(id%GRID_SIZE)*CELL+GRID_ORIGIN,z=Math.floor(id/GRID_SIZE)*CELL+GRID_ORIGIN;return{x,z,y:supportHeight(x,z)};};
const grid=new Int8Array(GRID_SIZE*GRID_SIZE);
const gridFree=id=>{if(!grid[id]){const p=gridPoint(id);grid[id]=isWalkable(p.x,p.z,.58,p.y)?1:-1;}return grid[id]===1;};
const navCosts=new Float32Array(grid.length),navPrevious=new Int32Array(grid.length),navSeen=new Uint32Array(grid.length),navClosed=new Uint32Array(grid.length);let navRevision=0;
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
  if (gridFree(original) && reachable(gridPoint(original))) return original;
  const cx = original % GRID_SIZE, cz = Math.floor(original / GRID_SIZE);
  let chosen = original, best = Infinity;
  for (let radius = 1; radius < 10; radius++) {
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx, z = cz + dz, id = x + z * GRID_SIZE;
      if (x < 0 || x >= GRID_SIZE || z < 0 || z >= GRID_SIZE || !gridFree(id)) continue;
      const candidate = gridPoint(id), dist = distance(p, candidate);
      if (dist < best && reachable(candidate)) { best = dist; chosen = id; }
    }
    if (best < Infinity) return chosen;
  }
  return connectionRadius === null ? chosen : -1;
}

function floorPath(from,to,room){
  if(walkSegmentClear(from,to,.38))return [{...to}];
  const width=Math.ceil(room.w)+3,depth=Math.ceil(room.d)+3,ox=room.x-width/2,oz=room.z-depth/2,y=from.y??room.baseY;
  const id=p=>Math.round(p.x-ox)+Math.round(p.z-oz)*width;
  const point=id=>({x:ox+id%width,y,z:oz+Math.floor(id/width)});
  const start=id(from),end=id(to),open=[start],cost=new Map([[start,0]]),prev=new Map(),closed=new Set();
  while(open.length){open.sort((a,b)=>(cost.get(a)+distance(point(a),to))-(cost.get(b)+distance(point(b),to)));const current=open.shift();if(closed.has(current))continue;closed.add(current);
    if(current===end){const path=[];for(let at=end;at!==start;at=prev.get(at))path.unshift(point(at));path.push({...to});if(path.length&&walkSegmentClear(from,path[0],.38))return path;return[];}
    const p=point(current);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){if(!dx&&!dz)continue;const q={x:p.x+dx,y,z:p.z+dz},next=id(q);if(q.x<ox||q.x>=ox+width||q.z<oz||q.z>=oz+depth||closed.has(next)||!walkSegmentClear(p,q,.38))continue;const c=cost.get(current)+Math.hypot(dx,dz);if(c<(cost.get(next)??Infinity)){cost.set(next,c);prev.set(next,current);open.push(next);}}
  }
  return[];
}
export function findPath(from,to){
  const roomAt=p=>layout.interiors.find(room=>Math.abs(p.x-room.x)<room.w/2&&Math.abs(p.z-room.z)<room.d/2);
  const fromRoom=roomAt(from),toRoom=roomAt(to),fromY=from.y??supportHeight(from.x,from.z),toY=to.y??supportHeight(to.x,to.z);
  let fromLevel=fromRoom?Math.max(0,Math.round((fromY-fromRoom.baseY)/4)):0,toLevel=toRoom?Math.max(0,Math.round((toY-toRoom.baseY)/4)):0;
  if(!fromLevel&&!toLevel)return findGroundPath(from,to);
  if(fromRoom===toRoom&&fromLevel===toLevel)return floorPath({...from,y:fromY},{...to,y:toY},fromRoom);
  if(fromRoom===toRoom){
    const path=[];let cursor={...from,y:fromY},level=fromLevel;
    while(level!==toLevel){const ascending=level<toLevel,stairs=fromRoom.stairs[ascending?level:level-1];if(!stairs)return[];
      const approach=floorPath(cursor,ascending?stairs.start:stairs.end,fromRoom);if(!approach.length)return[];path.push(...approach,...(ascending?stairs.waypoints:[...stairs.waypoints].reverse()));cursor={...(ascending?stairs.end:stairs.start)};level+=ascending?1:-1;
    }
    const finish=floorPath(cursor,{...to,y:toY},toRoom);if(!finish.length)return[];return[...path,...finish];
  }
  const path=[];let cursor={...from,y:fromY};
  while(fromLevel>0){const stairs=fromRoom?.stairs?.[fromLevel-1];if(!stairs)return[];const approach=floorPath(cursor,stairs.end,fromRoom);if(!approach.length&&distance(cursor,stairs.end)>.3)return[];path.push(...approach,...[...stairs.waypoints].reverse());cursor={...stairs.start};fromLevel--;}
  const first=toLevel>0?toRoom?.stairs?.[0]?.start:{...to,y:toY};if(!first)return[];
  const ground=findGroundPath(cursor,first);if(!ground.length&&distance(cursor,first)>.3)return[];path.push(...ground);if(walkSegmentClear(path.at(-1)??cursor,first,.38))path.push({...first});else return[];cursor={...first};
  for(let level=0;level<toLevel;level++){const stairs=toRoom?.stairs?.[level];if(!stairs)return[];if(level>0){const approach=floorPath(cursor,stairs.start,toRoom);if(!approach.length&&distance(cursor,stairs.start)>.3)return[];path.push(...approach);}path.push(...stairs.waypoints);cursor={...stairs.end};}
  const last=floorPath(cursor,{...to,y:toY},toRoom);if(!last.length&&distance(cursor,to)>.3)return[];path.push(...last);return path;
}
function findGroundPath(from, to) {
  const townAt=p=>layout.settlements.find(town=>Math.abs(p.x-town.x)<town.w/2&&Math.abs(p.z-town.z)<town.d/2);
  const fromTown=townAt(from),toTown=townAt(to);
  if(fromTown!==toTown&&(fromTown||toTown)){
    const anchors=[];
    if(fromTown&&distance(from,fromTown)>4)anchors.push({x:fromTown.x,y:fromTown.y,z:fromTown.z});
    if(toTown&&distance(to,toTown)>4)anchors.push({x:toTown.x,y:toTown.y,z:toTown.z});
    anchors.push(to);const route=[];let cursor=from;
    for(const target of anchors){const segment=findLandscapePath(cursor,target);if(!segment.length)return[];route.push(...segment);if(target!==to){if(!walkSegmentClear(route.at(-1),target,.38))return[];route.push(target);}cursor=target;}
    return route;
  }
  return findLandscapePath(from,to);
}
function findLandscapePath(from, to) {
  const fromSide=from.x-riverCenter(from.z),toSide=to.x-riverCenter(to.z);
  // Cross-river navigation uses the physical bridge portals, avoiding a huge
  // blind grid search along an otherwise impassable shoreline.
  if(fromSide*toSide<0&&Math.abs(fromSide)>58&&Math.abs(toSide)>58){
    const bridges=[...layout.bridges].sort((a,b)=>distance(from,a)+distance(a,to)-distance(from,b)-distance(b,to));
    for(const bridge of bridges){
      const sign=fromSide<0?-1:1,entry={x:bridge.x+sign*(bridge.w/2+3),y:bridge.y,z:bridge.z},exit={x:bridge.x-sign*(bridge.w/2+3),y:bridge.y,z:bridge.z};
      const route=[];let cursor=from,valid=true;
      for(const target of [entry,exit,to]){const segment=findGridPath(cursor,target);if(!segment.length){valid=false;break;}route.push(...segment);if(target!==to){if(!walkSegmentClear(route.at(-1),target,.38)){valid=false;break;}route.push(target);}cursor=target;}
      if(valid)return route;
    }
    return [];
  }
  return findGridPath(from,to);
}
function findGridPath(from, to) {
  // Agents can stand closer to a wall than the conservative 2 m grid allows.
  // Attach such positions on their own side of the wall. Blocked POI centers
  // retain the existing nearest-free destination semantics.
  const start = closestFree(from, isWalkable(from.x, from.z, .38) ? .38 : null);
  const end = closestFree(to, isWalkable(to.x, to.z, PLAYER_RADIUS) ? PLAYER_RADIUS : null);
  if (start < 0 || end < 0) return [];
  if (start === end) return [gridPoint(end)];
  const costs=navCosts,previous=navPrevious,closed=navClosed,revision=++navRevision;
  const frontier=[];costs[start]=0;navSeen[start]=revision;previous[start]=-1;
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
  push(start, heuristic(start)*1.12);
  let found=false,expanded=0;
  while (frontier.length) {
    const current = pop();
    if (closed[current]===revision) continue;
    if (current === end) { found = true; break; }
    closed[current]=revision;if(++expanded>25000)break;
    const cx = current % GRID_SIZE, cz = Math.floor(current / GRID_SIZE);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dz) || cx + dx < 0 || cx + dx >= GRID_SIZE || cz + dz < 0 || cz + dz >= GRID_SIZE) continue;
      const next = current + dx + dz * GRID_SIZE;
      if (!gridFree(next) || closed[next]===revision) continue;
      if (dx && dz && (!gridFree(current + dx) || !gridFree(current + dz * GRID_SIZE))) continue;
      if (!clearGridEdge(current, next, dx, dz)) continue;
      const cost = costs[current] + (dx && dz ? 1.414214 : 1);
      if(navSeen[next]===revision&&cost>=costs[next])continue;
      navSeen[next]=revision;costs[next]=cost;previous[next]=current;
      push(next, cost + heuristic(next)*1.12);
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
    adminGodmode: false, adminStamina: false,
    magSize: 24, weapon: 'VX-9', medkits: 2, reload: 0, heal: 0, maxHp: 100, maxStamina: 100,
    reloadDuration: 1.7, healDuration: 2.2, recoilMultiplier: 1, shotTimer: 0, cycleDuration: .095,
    maxArmor:30,bonusArmor:0,weaponInstance:null,attachments:{},weaponStats:deriveWeapon('VX-9'),equipment:{},gearSpeedMultiplier:1,damageReduction:0,adsSeconds:.19,adsZoom:1.35,
    downed:false,downCount:0,bleedoutRemaining:0,reviveProgress:0,reviveDuration:REVIVE_SECONDS,revivingTargetId:null,damageSequence:0,reviveProtection:0,
    grounded: true, moving: false, sprinting: false, sprintExhausted: false, crouching: false };
}

export async function createGame(saved = null, options = {}) {
  initialization ??= RAPIER.init();
  await initialization;
  const world = new RAPIER.World({ x: 0, y: -19, z: 0 });
  const halfWorld = WORLD_SIZE / 2;
  const terrain=createTerrainMesh();world.createCollider(RAPIER.ColliderDesc.trimesh(terrain.vertices,terrain.indices));
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
  let previousSpawnId = options.previousSpawnId;
  let spawnSerial = 0,respawnTimer = ENEMY_SPAWNING.interval,reinforcements = 0;
  let skillEffects = getSkillEffects(state.profile);
  const ownerNamespace = String(options.playerId ?? 'solo').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,30);
  const emit = event => events.push(event);
  const notice = text => emit({ type: 'notice', text });
  const alive = () => !disposed && state.phase === 'raid';
  const canAct = () => alive() && !state.player.downed;
  const eye = () => ({ x: state.player.x, y: state.player.y + (state.player.crouching ? 1.17 : 1.65), z: state.player.z });
  const enemyAI = createEnemyAI({ isWalkable, findPath, hasLineOfSight, walkSegmentClear,getGroundHeight,getSupportHeight:supportHeight,colliders: COLLIDERS, random: () => random(), shoot: shootEnemy });
  function grantXP(amount, reason) {
    if (!alive()) return;
    const before = state.profile.progression.xp;
    state.profile.progression.xp = Math.min(1e9, before + amount);
    const earned = state.profile.progression.xp - before;
    state.raid.xpEarned += earned;
    if (earned > 0) emit({ type: 'xp', amount: earned, reason });
  }

  function spawnEnemy(x, z, index, kind = 'guard', squad = {}) {
    const home = isWalkable(x, z) ? { x, z } : gridPoint(closestFree({ x, z }));
    home.y=supportHeight(home.x,home.z);
    const type=ENEMY_TYPES[kind]??ENEMY_TYPES.guard;
    return { id: `enemy-${index}`, ...home,y:supportHeight(home.x,home.z), yaw: random() * Math.PI * 2,hp:type.hp,maxHp:type.hp,armor:type.armor,maxArmor:type.armor,name:type.name,...squad,
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
    const seed = Number.isFinite(options.seed) ? options.seed >>> 0 : ((Date.now() ^ ++raidSerial * 2654435761) >>> 0);
    const spawn = options.spawnId === undefined ? selectRaidSpawn(seed, previousSpawnId) : getRaidSpawn(options.spawnId);
    state.profile.credits -= cost; state.profile.raids++;
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
    state.player = { ...emptyPlayer(), x: spawn.x, y: spawn.y + .02, z: spawn.z, yaw: spawn.yaw, armor: gearStats.armor + skillEffects.armorBonus,
      weapon: weapon.id, ammo: weapon.magSize, magSize: weapon.magSize, reserve: Math.round(weapon.reserve * skillEffects.reserveMultiplier),
      weaponInstance,weaponStats:weapon,attachments:weapon.attachments,equipment,maxArmor:gearStats.maxArmor + skillEffects.armorBonus,bonusArmor:skillEffects.armorBonus,
      gearSpeedMultiplier:gearStats.speedMultiplier,damageReduction:gearStats.damageReduction,adsSeconds:weapon.adsSeconds,adsZoom:weapon.adsZoom,
      hp: 100 + skillEffects.maxHpBonus, maxHp: 100 + skillEffects.maxHpBonus,
      stamina: 100 + skillEffects.staminaBonus, maxStamina: 100 + skillEffects.staminaBonus, medkits: resolved.medkits + skillEffects.extraMedkits,
      recoilMultiplier: skillEffects.recoilMultiplier, reloadDuration: weapon.reloadSeconds * skillEffects.reloadMultiplier,
      healDuration: 2.2 * skillEffects.healDurationMultiplier, cycleDuration: weapon.fireInterval };
    state.raid = { ...emptyRaid(), spawn: { ...spawn }, capacity: gearStats.capacity + skillEffects.capacityBonus, extractionDuration: 8 * skillEffects.extractionMultiplier, difficulty, seed,loadoutMode:resolved.selection.mode,equipmentSpilled:false };
    state.result = null; state.prompt = null; cooldown = 0; velocityY = 0; jumpHeld = false; extraction = null; lowTimeWarned = false; sprintNeedsRelease = false;
    body.setTranslation({ x: spawn.x, y: spawn.y + PLAYER_CENTER + .02, z: spawn.z }, true);
    body.setNextKinematicTranslation({ x: spawn.x, y: spawn.y + PLAYER_CENTER + .02, z: spawn.z });
    world.step();
    state.enemies = PATROLS.map(([x, z], i) => spawnEnemy(x, z, i, (difficulty === 'hard' && i % 3 === 0) || i === 9 ? 'elite' : 'guard'));
    spawnSerial = state.enemies.length;respawnTimer=ENEMY_SPAWNING.interval;reinforcements=0;
    const outerPatrols = layout.pois.filter(poi=>Math.hypot(poi.x-SPAWN.x,poi.z-SPAWN.z)>150);
    for(let index=0;outerPatrols.length&&state.enemies.length<ENEMY_SPAWNING.initialPatrols;index++){const point=outerPatrols[index%outerPatrols.length],angle=index*2.4,radius=12+Math.floor(index/outerPatrols.length)*8;state.enemies.push(spawnEnemy(point.x+Math.cos(angle)*radius,point.z+Math.sin(angle)*radius,spawnSerial++,spawnSerial%4===0?'elite':'guard'));}
    const bossPoint=layout.bossSpawn??{x:Math.min(WORLD_SIZE*.32,Math.max(85,WORLD_SIZE/2-35)),z:-WORLD_SIZE*.32};
    const boss=spawnEnemy(bossPoint.x,bossPoint.z,spawnSerial++,'boss',{squadId:'voss',role:'commander'});state.enemies.push(boss);
    for(let index=0;index<4;index++)state.enemies.push(spawnEnemy(boss.x+(index%2?1:-1)*5,boss.z+(index<2?5:-5),spawnSerial++,'bodyguard',{squadId:'voss',leaderId:boss.id,formationIndex:index,role:index%2?'flanker':'protector'}));
    state.loot = [];
    state.containers = CONTAINER_SPOTS.map(spot => ({ ...spot, opened: false, searched: false, items: rollContainerItems(spot, random, state.profile.raids, difficulty) }));
    closeContainer();
    events = []; state.phase = 'raid';
    previousSpawnId = spawn.id;
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
    if (p.adminGodmode) return;
    if(p.reviveProtection>0)return;
    p.damageSequence++;p.reviveProgress=0;
    if(p.downed){p.bleedoutRemaining=Math.max(0,p.bleedoutRemaining-amount*.6);if(p.bleedoutRemaining<=0)finish(false,'Verblutet');return;}
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
    if(p.hp<=0){
      if(options.allowDowned&&p.downCount===0){p.downed=true;p.downCount++;p.bleedoutRemaining=BLEEDOUT_SECONDS;p.reload=p.heal=0;p.moving=p.sprinting=false;extraction=null;closeContainer();state.raid.extractionProgress=0;emit({type:'downed',duration:BLEEDOUT_SECONDS});notice('Kampfunfähig. Dein Team kann dich mit einem Medkit wiederbeleben.');}
      else finish(false,'Im Einsatz gefallen');
    }
  }

  function updatePrompt() {
    state.prompt = null;
    if (!canAct()) return;
    const p = state.player;
    if (!state.raid.objectiveComplete && distance(p, RELAY) < 3) {
      state.prompt = { kind: 'relay', id: 'relay', text: `Relais aktivieren · +${ECONOMY_BALANCE.relayBonus} Credits bei Extraktion` }; return;
    }
    let closest, near = 2.7;
    for (const item of state.loot) {
      const d = distance(p, item);
      if (!item.taken && d < near && Math.abs(p.y-(item.y??getGroundHeight(item.x,item.z)))<2&&hasLineOfSight({ ...p, y: p.y + 1.1 }, { ...item, y: (item.y??getGroundHeight(item.x,item.z))+.55 })) { closest = item; near = d; }
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
      state.prompt = { kind: 'container', id: container.id, text: `${container.name??containerNames[container.type]} · ${empty ? 'Leer' : container.searched ? 'Öffnen' : 'Durchsuchen'}` }; return;
    }
    const zone = EXTRACTIONS.find(ex => distance(p, ex) <= ex.radius);
    if (zone && !extraction) state.prompt = { kind: 'extract', id: zone.id, text: `${zone.name} · Extraktion anfordern (${state.raid.extractionDuration} s)` };
  }

  function interact() {
    if (!canAct()) return false;
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
      state.containerSearchRemaining = container.searched ? 0 : (container.searchSeconds??CONTAINER_SEARCH_SECONDS) * skillEffects.searchMultiplier;
      container.opened = true;
      emit({ type: 'containerOpen', containerId: container.id, x: container.x, z: container.z });
    } else if (prompt.kind === 'relay') {
      state.raid.objectiveComplete = true;
      emit({ type: 'relay', x: RELAY.x, z: RELAY.z });
      notice(`Relais gesichert. Verstärkung unterwegs. Extrahiere für +${ECONOMY_BALANCE.relayBonus} CR.`);
      enemyAI.hear(state.enemies, RELAY, { kind: 'alarm', radius: 36 });
      if(state.enemies.filter(enemy=>!enemy.dead).length<ENEMY_SPAWNING.maxAlive){
        const reinforcements = spawnEnemy(21, -49, spawnSerial++, 'elite');
        enemyAI.hear([reinforcements], RELAY, { kind: 'alarm', radius: 80 });
        state.enemies.push(reinforcements);
      }
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
    return Math.hypot(p.x - container.x, p.z - container.z, p.y-(container.y??getGroundHeight(container.x,container.z))) <= 3
      && hasLineOfSight(eye(), { x: container.x, y: (container.y??getGroundHeight(container.x,container.z))+container.h + .08, z: container.z });
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
    if (!canAct() || state.activeContainerId !== containerId || typeof containerId !== 'string' || typeof itemId !== 'string' || containerId.length > 100 || itemId.length > 100) return false;
    const container = state.containers.find(value => value.id === containerId);
    if (!container?.searched || !canReachContainer(container)) return false;
    return collectItem(container.items.find(item => item.id === itemId));
  }
  function takeAllContainerItems(containerId) {
    const container = state.containers.find(value => value.id === containerId);
    if (!container) return 0;
    let count = 0;
    for (const item of container.items.slice(0, 12)) if (!item.taken && takeContainerItem(containerId, item.id)) count++;
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
    if (!canAct()) return false;
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
        const candidate = { x: p.x - Math.sin(p.yaw + angle) * radius, z: p.z - Math.cos(p.yaw + angle) * radius };candidate.y=supportHeight(candidate.x,candidate.z,p.y);
        if (Math.abs(candidate.y-p.y)<1&&isWalkable(candidate.x, candidate.z, .28,candidate.y) && hasLineOfSight({ x: p.x, y: p.y + 1.1, z: p.z }, { ...candidate, y: candidate.y+.55 })) {
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
    if (!canAct() || typeof id !== 'string') return false;
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
    if (!canAct() || !LOADOUT_SLOTS.includes(slot)) return false;
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
    if (!canAct() || !p.weaponStats || p.reload > 0 || p.heal > 0 || p.ammo >= p.magSize || p.reserve <= 0) return false;
    p.reload = p.reloadDuration = p.weaponStats.reloadSeconds * skillEffects.reloadMultiplier;
    emit({ type: 'reload', duration: p.reload }); return true;
  }
  function heal() {
    const p = state.player;
    if (!canAct() || p.medkits <= 0 || p.hp >= p.maxHp || p.heal > 0 || p.reload > 0) return false;
    p.heal = p.healDuration = 2.2 * skillEffects.healDurationMultiplier;
    emit({ type: 'heal', duration: p.healDuration, stage: 'start' }); return true;
  }

  function fire(direction, { triggerPressed = true } = {}) {
    const p = state.player, weapon = p.weaponStats;
    if (!canAct() || !weapon || state.activeContainerId || cooldown > 1e-7 || p.reload > 0 || p.sprinting || (!weapon.automatic && triggerPressed !== true)) return false;
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
        const enemyY=e.y??getGroundHeight(e.x,e.z);
        const torso = rayBox(origin, ray, { x: e.x - .34, y: enemyY+.22, z: e.z - .28 }, { x: e.x + .34, y: enemyY+1.48, z: e.z + .28 });
        const ox = origin.x - e.x, oy = origin.y - enemyY-1.69, oz = origin.z - e.z;
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
    enemyAI.hear(state.enemies, p, { kind: 'shot', playerId: options.playerId, radius: weapon.soundRadius*2.5 });
    for (const [victim, { damage, headshot, point: to }] of hits) {
      const absorbed=headshot?0:Math.min(victim.armor??0,damage*.55);victim.armor=Math.max(0,(victim.armor??0)-absorbed);
      victim.hp -= damage-absorbed; victim.hitFlash = 0.16; victim.fireTimer = Math.max(victim.fireTimer, 0.27);
      victim.alert = Math.max(victim.alert, 12); enemyAI.hit(victim);
      emit({ type: 'hit', ...to, headshot, damage, enemyId: victim.id });
      if (victim.hp <= 0) {
        victim.hp = 0; victim.dead = true; victim.mode = 'dead'; victim.attackFlash = 0;
        state.raid.kills++; emit({ type: 'kill', ...to, headshot, enemyId: victim.id });
        grantXP((ENEMY_TYPES[victim.kind]??ENEMY_TYPES.guard).xp, 'kill');
        if(!state.containers.some(container=>container.enemyId===victim.id))state.containers.push({id:`corpse-${victim.id}`,enemyId:victim.id,kind:'corpse',role:victim.kind,name:`${victim.name??ENEMY_TYPES[victim.kind]?.name??'Wache'} · Gefallen`,type:'security',x:victim.x,y:victim.y??0,z:victim.z,w:1.6,d:.7,h:.55,opened:false,searched:false,age:0,searchSeconds:(ENEMY_TYPES[victim.kind]??ENEMY_TYPES.guard).searchSeconds,items:rollCorpseItems(victim,random)});
        emit({type:'corpse',enemyId:victim.id,x:victim.x,y:victim.y??0,z:victim.z});
      }
    }
    return true;
  }

  function shootEnemy(e, victim) {
    const p = victim.state.player, dist = distance(e, p);
    const playerTarget = { x: p.x, y: p.y + (p.crouching ? .95 : 1.3), z: p.z };
    const type=ENEMY_TYPES[e.kind]??ENEMY_TYPES.guard;
    e.fireTimer = type.interval + random() * .4;
    e.attackFlash = .1;
    const from = { x: e.x, y: (e.y??0)+1.43, z: e.z };
    const accuracy = clamp((state.raid.difficulty === 'hard' ? .77 : .63) - dist * .009 - (p.sprinting ? .15 : 0) - (p.crouching ? .1 : 0), .18, .82);
    const hit = random() < accuracy;
    const to = hit ? { ...playerTarget } : { x: p.x + (random() - .5) * 3, y: p.y+1 + random(), z: p.z + (random() - .5) * 3 };
    emit({ type: 'enemyShot', from, to, ...from, enemyId: e.id, ...(victim.id ? { targetPlayerId: victim.id } : {}) });
    if (hit && hasLineOfSight(from, playerTarget)) victim.damage(type.damage * (state.raid.difficulty === 'hard' ? 1.15 : 1), e);
  }
  function updateEnemies(dt, targets = [{ id: null, state, damage: applyDamage }]) {
    enemyAI.update(dt, state.enemies, targets, state.raid.difficulty);
    updateReinforcements(dt,targets);
  }
  function updateReinforcements(dt,targets){
    for(const corpse of state.containers)if(corpse.kind==='corpse')corpse.age=(corpse.age??0)+dt;
    const cleanup=new Set(state.containers.filter(c=>c.kind==='corpse'&&c.age>45&&c.items.every(item=>item.taken)).map(c=>c.enemyId));
    if(cleanup.size){for(let i=state.containers.length-1;i>=0;i--)if(cleanup.has(state.containers[i].enemyId))state.containers.splice(i,1);for(let i=state.enemies.length-1;i>=0;i--)if(cleanup.has(state.enemies[i].id)&&state.enemies[i].dead)state.enemies.splice(i,1);}
    respawnTimer-=dt;if(respawnTimer>0)return;respawnTimer=ENEMY_SPAWNING.interval;
    if(reinforcements>=ENEMY_SPAWNING.maxReinforcements||state.containers.filter(c=>c.kind==='corpse').length>=ENEMY_SPAWNING.corpseLimit)return;
    const living=targets.filter(target=>target.state.phase==='raid'),available=Math.min(ENEMY_SPAWNING.waveSize,ENEMY_SPAWNING.maxAlive-state.enemies.filter(e=>!e.dead).length,ENEMY_SPAWNING.maxReinforcements-reinforcements);
    if(!living.length||available<=0)return;
    const candidates=[...layout.pois,...PATROLS.map(([x,z])=>({x,z}))];let spawned=0;
    for(let attempt=0;attempt<80&&spawned<available;attempt++){
      const base=candidates[Math.floor(random()*candidates.length)],angle=random()*Math.PI*2,radius=16+random()*24,x=base.x+Math.cos(angle)*radius,z=base.z+Math.sin(angle)*radius,y=supportHeight(x,z);
      if(!isWalkable(x,z,.6,y)||Math.hypot(x-SPAWN.x,z-SPAWN.z)<60||state.enemies.some(e=>!e.dead&&Math.hypot(e.x-x,e.z-z)<6))continue;
      if(living.some(({state:s})=>{const d=Math.hypot(s.player.x-x,s.player.z-z);return d<ENEMY_SPAWNING.minPlayerDistance||(d<ENEMY_SPAWNING.visibilityDistance&&hasLineOfSight({...s.player,y:s.player.y+1.65},{x,y:y+1.5,z}));}))continue;
      const enemy=spawnEnemy(x,z,spawnSerial++,reinforcements%4===3?'elite':'guard');enemy.reinforcement=true;state.enemies.push(enemy);spawned++;reinforcements++;
    }
    if(spawned)emit({type:'reinforcements',count:spawned});
  }

  function update(dt, input = {}) {
    if (!alive() || !Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 0.05);
    const p = state.player;
    p.reviveProtection=Math.max(0,p.reviveProtection-dt);
    cooldown = Math.max(0, cooldown - dt); p.shotTimer = Math.max(0, p.shotTimer - dt);
    state.raid.timeLeft = Math.max(0, state.raid.timeLeft - dt);
    if (state.raid.timeLeft <= 0) { finish(false, 'Einsatzzeit abgelaufen'); return; }
    if(p.downed){
      if(Number.isFinite(input.yaw))p.yaw=input.yaw;if(Number.isFinite(input.pitch))p.pitch=clamp(input.pitch,-1.5,1.5);
      p.bleedoutRemaining=Math.max(0,p.bleedoutRemaining-dt);p.moving=p.sprinting=false;
      velocityY-=19*dt;controller.computeColliderMovement(collider,{x:0,y:velocityY*dt,z:0});const delta=controller.computedMovement(),position=body.translation();body.setNextKinematicTranslation({x:position.x,y:position.y+delta.y,z:position.z});world.timestep=dt;world.step();p.y=body.translation().y-PLAYER_CENTER;if(controller.computedGrounded())velocityY=-.3;
      if(p.bleedoutRemaining<=0)finish(false,'Verblutet');return;
    }
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
    if (p.adminStamina) { p.stamina = p.maxStamina; p.sprintExhausted = false; sprintNeedsRelease = false; }
    p.moving = Math.abs(forward) + Math.abs(right) > 0.05;
    p.crouching = !!input.crouch;
    // Empty stamina must not alternate sprint/drain and walk/regenerate every
    // frame. Recover a useful reserve and release Shift once before rearming.
    if (p.stamina <= 0 && !p.sprintExhausted) { p.sprintExhausted = true; sprintNeedsRelease = !!input.sprint; }
    if (!input.sprint) sprintNeedsRelease = false;
    if (p.sprintExhausted && p.stamina >= 20 && !sprintNeedsRelease) p.sprintExhausted = false;
    p.sprinting = !!input.sprint && p.moving && forward > 0 && !p.crouching && !input.aim && !p.sprintExhausted && p.stamina > 0 && p.heal <= 0 && p.reload <= 0;
    p.stamina = p.adminStamina ? p.maxStamina : clamp(p.stamina + (p.sprinting ? -23 * skillEffects.sprintDrainMultiplier : 15 * skillEffects.staminaRegenMultiplier) * dt, 0, p.maxStamina);
    if (p.sprinting && p.stamina === 0) { p.sprinting = false; p.sprintExhausted = true; sprintNeedsRelease = true; }
    const speed = (p.crouching ? 2.1 : p.sprinting ? 7.2 : input.aim ? 3 : 4.4) * skillEffects.moveSpeedMultiplier * p.gearSpeedMultiplier * (p.weaponStats?.moveMultiplier ?? 1) * (p.heal > 0 ? 0.62 : 1);
    if (input.jump && !jumpHeld && p.grounded && !p.crouching && p.stamina > 10) { velocityY = 6.7; if (!p.adminStamina) p.stamina -= 10; p.grounded = false; }
    jumpHeld = !!input.jump;
    velocityY -= 19 * dt;
    const wanted = { x: (-Math.sin(p.yaw) * forward + Math.cos(p.yaw) * right) / magnitude * speed * dt,
      y: velocityY * dt, z: (-Math.cos(p.yaw) * forward - Math.sin(p.yaw) * right) / magnitude * speed * dt };
    const nextX=clamp(p.x+wanted.x,-WORLD_SIZE/2+1,WORLD_SIZE/2-1),nextZ=clamp(p.z+wanted.z,-WORLD_SIZE/2+1,WORLD_SIZE/2-1);
    wanted.x=nextX-p.x;wanted.z=nextZ-p.z;
    if(isWater(nextX,nextZ)&&supportHeight(nextX,nextZ,p.y)<WATER_LEVEL+.5){wanted.x=0;wanted.z=0;}
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
      if (distance(p, extraction) > extraction.radius || Math.abs(p.y-(extraction.y??getGroundHeight(extraction.x,extraction.z))) > 1.5) {
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
    revive(){if(!alive()||!state.player.downed||state.player.bleedoutRemaining<=0)return false;Object.assign(state.player,{downed:false,hp:35,bleedoutRemaining:0,reviveProgress:0,revivingTargetId:null,reviveProtection:2});emit({type:'revived',hp:35});return true;},
    spawnStats(){return{nextWave:respawnTimer,reinforcements,maximum:ENEMY_SPAWNING.maxReinforcements,live:state.enemies.filter(e=>!e.dead).length};},
    aiStats: () => enemyAI.stats(),
    endRaid(reason = 'Einsatz abgebrochen') { finish(false, reason); },
    // Reconcile physics and state for deterministic replay setup and QA tooling.
    teleport(x, z, y = supportHeight(x,z)+.02) {
      if (disposed || ![x, y, z].every(Number.isFinite) || !isWalkable(x, z, PLAYER_RADIUS, y) || y < -10 || y > 300) return false;
      body.setTranslation({ x, y: y + PLAYER_CENTER, z }, true);
      body.setNextKinematicTranslation({ x, y: y + PLAYER_CENTER, z });
      world.step();
      Object.assign(state.player, { x, y, z, grounded: Math.abs(y-supportHeight(x,z,y))<.05 }); velocityY = 0;
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
