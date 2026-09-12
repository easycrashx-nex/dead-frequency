import { getGroundHeight } from './terrain.js';
import { SPAWN } from './layout.js';

// Surveyed outdoor entry clearings. Both team positions and their approach paths
// are checked against the real terrain, world colliders and initial patrols.
const entries = [
  ['altdorf-west', 'ALTDORF · WESTHANG', -560, -410],
  ['northwest-forest', 'NORDWESTLICHER FORST', -430, -585],
  ['north-ridge', 'NORDKAMM', -180, -620],
  ['nordwacht-trail', 'NORDWACHT · HÖHENWEG', 90, -635],
  ['coastal-ridge', 'KÜSTENKAMM', 510, -590],
  ['harbor-approach', 'OSTHAFEN · ZUFAHRT', 650, -245],
  ['east-trail', 'ÖSTLICHER SENDEPFAD', 590, 40],
  ['linden-east', 'LINDEN · OSTHANG', 630, 400],
  ['southeast-forest', 'SÜDOSTWALD', 410, 540],
  ['south-meadow', 'SÜDLICHE AUE', 100, 575],
  ['farm-west', 'SÜDHOF · WESTPFAD', -230, 510],
  ['mine-west', 'BERGWERK · WESTZUGANG', -620, 300],
  ['western-heights', 'WESTLICHER HÖHENWEG', -590, 0],
  ['old-freight-route', 'ALTE GÜTERROUTE', -300, -230],
  ['west-forest-road', 'WESTLICHE FORSTSTRASSE', -230, 190],
  ['south-bridge-trail', 'SÜDLICHER BRÜCKENPFAD', 110, 300],
];
export const RAID_SPAWNS = Object.freeze(entries.map(([id, name, x, z]) => Object.freeze({ id, name, x, y: getGroundHeight(x, z), z, yaw: Math.atan2(x, z) })));
const arrival = Object.freeze({ id: 'arrival', name: 'ANKUNFT', ...SPAWN, y: getGroundHeight(SPAWN.x, SPAWN.z) });
export function getRaidSpawn(id) {
  const spawn = id === arrival.id ? arrival : RAID_SPAWNS.find(entry => entry.id === id);
  if (!spawn) throw new Error('Unbekannter Einstiegspunkt.');
  return spawn;
}
export function getRaidSpawnPositions(spawn) {
  const x = spawn.id === 'arrival' ? spawn.x + 2.2 : spawn.x + Math.cos(spawn.yaw) * 2.4;
  const z = spawn.id === 'arrival' ? spawn.z + .8 : spawn.z - Math.sin(spawn.yaw) * 2.4;
  return [{ x: spawn.x, y: spawn.y, z: spawn.z }, { x, y: getGroundHeight(x, z), z }];
}
export function selectRaidSpawn(seed, previousId) {
  const excluded = new Set(Array.isArray(previousId) ? previousId : [previousId]);
  const eligible = RAID_SPAWNS.filter(entry => !excluded.has(entry.id));
  const pool = eligible.length ? eligible : RAID_SPAWNS;
  // Independent integer mix: choosing an entry never consumes the loot/AI RNG.
  let value = (Number.isFinite(seed) ? seed >>> 0 : 0) ^ 0x6d2b79f5;
  value = Math.imul(value ^ value >>> 16, 0x7feb352d);
  value = Math.imul(value ^ value >>> 15, 0x846ca68b);
  return pool[((value ^ value >>> 16) >>> 0) % pool.length];
}
