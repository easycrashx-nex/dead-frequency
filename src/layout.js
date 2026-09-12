// All substantial world geometry shares this collision and rendering definition.
import {WORLD_SIZE,SETTLEMENTS,BRIDGE_SITES,getGroundHeight,isTerrainWalkable} from './terrain.js';
import {createInterior,createSettlements,vehicleSolids,createNaturalObstacles} from './world-layout.js';
export {WORLD_SIZE};
export const SPAWN = { x: -7, z: 48, yaw: 0 };
export const POIS = [
  { name: 'ANKUNFT', x: -7, z: 46 },
  { name: 'FRACHTHOF', x: -34, z: 15 },
  { name: 'UMSPANNWERK', x: 24, z: 17 },
  { name: 'LAGER 04', x: -23, z: -15 },
  { name: 'RELAIS', x: 7, z: -24 },
  { name: 'KONTROLLTURM', x: 33, z: -28 },
  { name: 'GÜTERBAHNHOF', x: -102, z: -87 },
  { name: 'WESTDEPOT', x: -104, z: 84 },
  { name: 'WASSERWERK', x: -8, z: -106 },
  { name: 'RAFFINERIE', x: 97, z: -90 },
  { name: 'ZOLLSTATION', x: 104, z: 25 },
  { name: 'KONVOIHOF', x: 72, z: 99 },
  { name: 'SÜDLAGER', x: -18, z: 119 },
  { name: 'AUFBEREITUNG', x: -111, z: -4 },
];
export const EXTRACTIONS = [
  { id: 'south', name: 'SÜDSCHLEUSE', x: -47, z: 46, radius: 4 },
  { id: 'north', name: 'NORDPIER', x: 46, z: -47, radius: 4 },
  { id: 'rail', name: 'BAHNTUNNEL', x: -136, z: -132, radius: 4 },
  { id: 'dock', name: 'NORDOST-DOCK', x: 137, z: -121, radius: 4 },
  { id: 'convoy', name: 'OSTKONVOI', x: 131, z: 132, radius: 4 },
  { id: 'forest', name: 'WALDSCHLEUSE', x: -135, z: 126, radius: 4 },
];
export const RELAY = { x: 7, z: -24 };
export const OBSTACLES = [
  { id: 'warehouse', kind: 'building', x: -25, z: -15, w: 22, d: 23, h: 11 },
  { id: 'depot', kind: 'building', x: -40, z: 21, w: 15, d: 17, h: 8 },
  { id: 'powerstation', kind: 'building', x: 29, z: 17, w: 18, d: 16, h: 8.5 },
  { id: 'control', kind: 'building', x: 32, z: -27, w: 14, d: 16, h: 16 },
  { id: 'offices', kind: 'building', x: -16, z: -46, w: 24, d: 9, h: 7 },
  { id: 'entry-booth', kind: 'building', x: 10, z: 43, w: 7, d: 8, h: 4 },
  { id: 'container-a', kind: 'container', x: -18, z: 28, w: 3.4, d: 11, h: 3, color: '#a75c31' },
  { id: 'container-b', kind: 'container', x: -22.5, z: 29, w: 3.4, d: 11, h: 3, color: '#617873' },
  { id: 'container-c', kind: 'container', x: -7, z: 13, w: 11, d: 3.4, h: 3, color: '#a95e30' },
  { id: 'container-d', kind: 'container', x: -7, z: 8, w: 11, d: 3.4, h: 3, color: '#77754b' },
  { id: 'container-e', kind: 'container', x: 14, z: -5, w: 3.4, d: 11, h: 3, color: '#617873' },
  { id: 'container-f', kind: 'container', x: 19, z: -7, w: 3.4, d: 11, h: 3, color: '#a75c31' },
  { id: 'container-g', kind: 'container', x: -3, z: -36, w: 11, d: 3.4, h: 3, color: '#526d67' },
  { id: 'container-h', kind: 'container', x: 10, z: -40, w: 3.4, d: 11, h: 3, color: '#a75c31' },
  { id: 'tank-a', kind: 'tank', x: 47, z: 13, w: 6, d: 6, h: 8 },
  { id: 'tank-b', kind: 'tank', x: 47, z: 23, w: 6, d: 6, h: 8 },
  { id: 'barrier-spawn', kind: 'barrier', x: -4, z: 37, w: 9, d: 1.2, h: 1.1 },
  { id: 'barrier-south', kind: 'barrier', x: -34, z: 38, w: 9, d: 1.2, h: 1.1 },
  { id: 'barrier-east', kind: 'barrier', x: 19, z: 32, w: 9, d: 1.2, h: 1.1 },
  { id: 'barrier-central', kind: 'barrier', x: 4, z: 1, w: 1.2, d: 7, h: 1.15 },
  { id: 'barrier-relay', kind: 'barrier', x: 8, z: -17, w: 8, d: 1.2, h: 1.1 },
  { id: 'barrier-north', kind: 'barrier', x: 35, z: -43, w: 7, d: 1.2, h: 1.1 },
  { id: 'barrier-west', kind: 'barrier', x: -47, z: -12, w: 1.2, d: 11, h: 1.3 },
  { id: 'crate-safe', kind: 'crate', x: -12, z: 44, w: 2.4, d: 2.4, h: 1.3 },
  { id: 'crate-approach', kind: 'crate', x: 2, z: 25, w: 2, d: 2, h: 1.8 },
  { id: 'crate-yard-a', kind: 'crate', x: -29, z: 7, w: 2.5, d: 2.5, h: 1.5 },
  { id: 'crate-yard-b', kind: 'crate', x: -32, z: 7, w: 2.5, d: 2.5, h: 2.7 },
  { id: 'crate-yard-c', kind: 'crate', x: -45, z: 6, w: 3, d: 3, h: 1.7 },
  { id: 'crate-central-a', kind: 'crate', x: -6, z: -10, w: 2.7, d: 2.7, h: 2.1 },
  { id: 'crate-central-b', kind: 'crate', x: -3, z: -11, w: 2.4, d: 2.4, h: 1.3 },
  { id: 'crate-relay-a', kind: 'crate', x: 2, z: -27, w: 2.5, d: 2.5, h: 1.5 },
  { id: 'crate-relay-b', kind: 'crate', x: 18, z: -27, w: 2.5, d: 2.5, h: 2.2 },
  { id: 'crate-east-a', kind: 'crate', x: 43, z: -5, w: 3, d: 3, h: 2 },
  { id: 'crate-north-a', kind: 'crate', x: 24, z: -48, w: 3, d: 3, h: 1.8 },
  { id: 'crate-west-a', kind: 'crate', x: -42, z: -34, w: 3, d: 3, h: 1.8 },
  // Rail sidings: long rows with cross routes between parked freight cars.
  { id: 'rail-office', kind: 'building', x: -116, z: -103, w: 26, d: 14, h: 8 },
  { id: 'rail-maintenance', kind: 'building', x: -79, z: -112, w: 19, d: 22, h: 10 },
  { id: 'rail-signal', kind: 'building', x: -128, z: -71, w: 9, d: 11, h: 12 },
  { id: 'rail-car-1', kind: 'container', x: -117, z: -87, w: 15, d: 3.8, h: 3.4, color: '#a75c31' },
  { id: 'rail-car-2', kind: 'container', x: -95, z: -77, w: 15, d: 3.8, h: 3.4, color: '#617873' },
  { id: 'rail-car-3', kind: 'container', x: -96, z: -63, w: 15, d: 3.8, h: 3.4, color: '#77754b' },
  { id: 'rail-crate-1', kind: 'crate', x: -111, z: -64, w: 3, d: 3, h: 2.1 },
  { id: 'rail-crate-2', kind: 'crate', x: -80, z: -84, w: 3, d: 3, h: 1.5 },
  { id: 'rail-barrier', kind: 'barrier', x: -133, z: -115, w: 1.2, d: 12, h: 1.2 },
  // West depot: close cover and a protected service lane.
  { id: 'west-store-1', kind: 'building', x: -115, z: 67, w: 27, d: 17, h: 10 },
  { id: 'west-store-2', kind: 'building', x: -91, z: 108, w: 20, d: 18, h: 8 },
  { id: 'west-container-1', kind: 'container', x: -125, z: 95, w: 3.5, d: 12, h: 3, color: '#617873' },
  { id: 'west-container-2', kind: 'container', x: -110, z: 92, w: 3.5, d: 12, h: 3, color: '#a75c31' },
  { id: 'west-container-3', kind: 'container', x: -86, z: 77, w: 12, d: 3.5, h: 3, color: '#77754b' },
  { id: 'west-crate-1', kind: 'crate', x: -96, z: 89, w: 3, d: 3, h: 1.5 },
  { id: 'west-crate-2', kind: 'crate', x: -125, z: 112, w: 3, d: 3, h: 2.2 },
  { id: 'west-barrier', kind: 'barrier', x: -73, z: 92, w: 1.2, d: 11, h: 1.2 },
  // Waterworks: exposed tanks with short concrete sight-line breaks.
  { id: 'water-pump', kind: 'building', x: -24, z: -121, w: 24, d: 15, h: 7 },
  { id: 'water-control', kind: 'building', x: 18, z: -117, w: 15, d: 12, h: 10 },
  { id: 'water-tank-1', kind: 'tank', x: -28, z: -91, w: 10, d: 10, h: 9 },
  { id: 'water-tank-2', kind: 'tank', x: -8, z: -86, w: 10, d: 10, h: 9 },
  { id: 'water-tank-3', kind: 'tank', x: 16, z: -90, w: 10, d: 10, h: 9 },
  { id: 'water-barrier-1', kind: 'barrier', x: -10, z: -99, w: 11, d: 1.2, h: 1.1 },
  { id: 'water-barrier-2', kind: 'barrier', x: 6, z: -132, w: 11, d: 1.2, h: 1.1 },
  { id: 'water-crate', kind: 'crate', x: 0, z: -116, w: 3, d: 3, h: 2 },
  // Refinery: a tall landmark with multiple routes between process tanks.
  { id: 'refinery-block', kind: 'building', x: 82, z: -112, w: 24, d: 19, h: 14 },
  { id: 'refinery-control', kind: 'building', x: 122, z: -88, w: 15, d: 24, h: 11 },
  { id: 'refinery-tower', kind: 'tank', x: 105, z: -115, w: 8, d: 8, h: 24 },
  { id: 'refinery-tank-1', kind: 'tank', x: 78, z: -79, w: 9, d: 9, h: 11 },
  { id: 'refinery-tank-2', kind: 'tank', x: 98, z: -69, w: 9, d: 9, h: 11 },
  { id: 'refinery-container', kind: 'container', x: 109, z: -95, w: 3.5, d: 12, h: 3, color: '#a75c31' },
  { id: 'refinery-barrier', kind: 'barrier', x: 93, z: -96, w: 10, d: 1.2, h: 1.1 },
  { id: 'refinery-crate', kind: 'crate', x: 116, z: -114, w: 3, d: 3, h: 2.2 },
  // Eastern customs yard: long courtyard bounded by customs offices.
  { id: 'customs-office', kind: 'building', x: 92, z: 6, w: 22, d: 18, h: 8 },
  { id: 'customs-store', kind: 'building', x: 125, z: 30, w: 17, d: 27, h: 10 },
  { id: 'customs-booth', kind: 'building', x: 106, z: 50, w: 8, d: 8, h: 4 },
  { id: 'customs-container-1', kind: 'container', x: 80, z: 30, w: 3.5, d: 12, h: 3, color: '#617873' },
  { id: 'customs-container-2', kind: 'container', x: 89, z: 40, w: 3.5, d: 12, h: 3, color: '#77754b' },
  { id: 'customs-barrier-1', kind: 'barrier', x: 104, z: 17, w: 8, d: 1.2, h: 1.2 },
  { id: 'customs-barrier-2', kind: 'barrier', x: 117, z: 58, w: 8, d: 1.2, h: 1.2 },
  { id: 'customs-crate', kind: 'crate', x: 107, z: 37, w: 3, d: 3, h: 1.5 },
  // Convoy yard: staggered cargo stacks around a wide service road.
  { id: 'convoy-garage', kind: 'building', x: 83, z: 121, w: 29, d: 17, h: 9 },
  { id: 'convoy-office', kind: 'building', x: 52, z: 88, w: 15, d: 15, h: 7 },
  { id: 'convoy-container-1', kind: 'container', x: 78, z: 83, w: 12, d: 3.5, h: 3, color: '#a75c31' },
  { id: 'convoy-container-2', kind: 'container', x: 95, z: 93, w: 12, d: 3.5, h: 3, color: '#617873' },
  { id: 'convoy-container-3', kind: 'container', x: 112, z: 112, w: 3.5, d: 12, h: 3, color: '#77754b' },
  { id: 'convoy-barrier', kind: 'barrier', x: 60, z: 110, w: 1.2, d: 10, h: 1.1 },
  { id: 'convoy-crate-1', kind: 'crate', x: 87, z: 103, w: 3, d: 3, h: 1.5 },
  { id: 'convoy-crate-2', kind: 'crate', x: 113, z: 90, w: 3, d: 3, h: 2.2 },
  // Southern camp and western processing plant.
  { id: 'south-barracks', kind: 'building', x: -35, z: 106, w: 20, d: 14, h: 6 },
  { id: 'south-workshop', kind: 'building', x: 3, z: 123, w: 18, d: 16, h: 7 },
  { id: 'south-container', kind: 'container', x: -18, z: 93, w: 12, d: 3.5, h: 3, color: '#77754b' },
  { id: 'south-booth', kind: 'building', x: -46, z: 131, w: 7, d: 8, h: 4 },
  { id: 'south-crate', kind: 'crate', x: -20, z: 129, w: 3, d: 3, h: 1.5 },
  { id: 'south-barrier', kind: 'barrier', x: -6, z: 105, w: 1.2, d: 9, h: 1.1 },
  { id: 'processing-hall', kind: 'building', x: -126, z: -19, w: 20, d: 23, h: 13 },
  { id: 'processing-shed', kind: 'building', x: -90, z: 17, w: 18, d: 16, h: 7 },
  { id: 'processing-tank', kind: 'tank', x: -94, z: -17, w: 9, d: 9, h: 10 },
  { id: 'processing-container', kind: 'container', x: -123, z: 14, w: 12, d: 3.5, h: 3, color: '#a75c31' },
  { id: 'processing-crate', kind: 'crate', x: -104, z: 2, w: 3, d: 3, h: 2 },
  { id: 'processing-barrier', kind: 'barrier', x: -111, z: -29, w: 1.2, d: 10, h: 1.2 },
  // Route cover makes the extended zone traversable without huge empty fields.
  { id: 'route-west-1', kind: 'container', x: -72, z: -40, w: 3.5, d: 12, h: 3, color: '#617873' },
  { id: 'route-west-2', kind: 'barrier', x: -65, z: 22, w: 1.2, d: 10, h: 1.2 },
  { id: 'route-west-3', kind: 'crate', x: -68, z: 63, w: 3, d: 3, h: 2.1 },
  { id: 'route-north-1', kind: 'container', x: -56, z: -89, w: 3.5, d: 12, h: 3, color: '#a75c31' },
  { id: 'route-north-2', kind: 'barrier', x: 8, z: -64, w: 10, d: 1.2, h: 1.1 },
  { id: 'route-north-3', kind: 'container', x: 45, z: -99, w: 3.5, d: 12, h: 3, color: '#77754b' },
  { id: 'route-east-1', kind: 'barrier', x: 66, z: -43, w: 1.2, d: 10, h: 1.1 },
  { id: 'route-east-2', kind: 'crate', x: 81, z: -20, w: 3, d: 3, h: 2 },
  { id: 'route-east-3', kind: 'container', x: 72, z: 61, w: 12, d: 3.5, h: 3, color: '#617873' },
  { id: 'route-south-1', kind: 'barrier', x: 23, z: 72, w: 10, d: 1.2, h: 1.1 },
  { id: 'route-south-2', kind: 'crate', x: -43, z: 76, w: 3, d: 3, h: 1.5 },
  { id: 'route-south-3', kind: 'container', x: 24, z: 101, w: 3.5, d: 12, h: 3, color: '#a75c31' },
];
const expansion=createSettlements();
OBSTACLES.push(...expansion.obstacles,...createNaturalObstacles());
export const SETTLEMENT_WALLS=expansion.wallSolids;
export const VEHICLES=expansion.vehicles;
export const BRIDGES=expansion.bridges;
POIS.push(...SETTLEMENTS.map(s=>({name:s.name,x:s.x,z:s.z,y:s.y})),...BRIDGE_SITES.map(s=>({name:s.name,x:s.x,z:s.z,y:s.y})));
EXTRACTIONS.push(...[{id:'mountain',name:'BERGPASS',x:-670,z:-340},{id:'coast',name:'KÜSTENFUNK',x:670,z:-430},{id:'south-road',name:'SÜDSTRASSE',x:-25,z:665}].map(s=>({...s,radius:5,y:getGroundHeight(s.x,s.z)})));
function interior(id,name,type,ceilingHeight,fixtures,lootSpots){return createInterior(OBSTACLES.find(o=>o.id===id),{name,type,ceilingHeight,fixtures,lootSpots});}

export const INTERIORS = [
  interior('entry-booth', 'WACHHAUS', 'guardhouse', 3.4, [
    ['desk', 'desk', -2, .2, .9, 1.1, 2.2], ['cabinet', 'cabinet', 2.15, -1.7, .8, 2.3, 1.2],
  ], [[-1.3, -1.8, 0], [1.35, 1.4, 1]]),
  interior('warehouse', 'LAGER 04', 'warehouse', 4, [
    ['west-shelf', 'shelf', -8, -3, 2, 2.6, 5], ['east-shelf', 'shelf', 8, -4, 2, 2.6, 5],
    ['packing-bench', 'workbench', 5, 6, 3, 1.1, 3],
  ], [[-5, -4, 2], [5, -5, 2], [5, 3.5, 3]]),
  interior('rail-office', 'BAHNBÜRO', 'rail-office', 3.4, [
    ['dispatch-desk', 'desk', -9, -2, 3.2, 1.05, 1.6], ['archive-cabinet', 'cabinet', 9, -3, 1.2, 2.4, 3],
    ['ticket-counter', 'counter', 5, 3, 4, 1.2, 1.4],
  ], [[-7, 0, 2], [7, -1, 3], [-8, 3, 1]]),
  interior('customs-office', 'ZOLLBÜRO', 'customs-office', 3.4, [
    ['inspection-counter', 'counter', -6, -3, 5, 1.1, 1.3], ['records-cabinet', 'cabinet', 8, -4, 1.1, 2.4, 3],
    ['customs-desk', 'desk', 6, 4, 3, 1.1, 1.8],
  ], [[-6, -1, 2], [6, 0, 3], [-6, 5, 2]]),
  interior('south-workshop', 'SÜDWERKSTATT', 'workshop', 4, [
    ['repair-bench', 'workbench', -6, -3, 2, 1.1, 4], ['lathe', 'machine', 6, 0, 2.2, 2.3, 2.8],
    ['parts-shelf', 'shelf', -5, 5, 4, 2.5, 1.5],
  ], [[-4, -3, 1], [4, 2, 2], [-4, 3, 2]]),
];
for(const o of OBSTACLES.filter(o=>o.kind==='building'&&!INTERIORS.some(r=>r.id===o.id)))INTERIORS.push(createInterior(o,{name:o.name,type:o.theme==='residential'?'residential':o.theme==='farm'?'farm':o.theme==='military'?'guardhouse':o.theme||'warehouse',fixtures:[['storage','cabinet',-o.w/2+1.2,-o.d/2+2,1.1,2.3,2.4]]}));
for(const o of OBSTACLES){o.baseY=getGroundHeight(o.x,o.z);const room=INTERIORS.find(r=>r.id===o.id);if(room)o.h=room.h;}
const interiorById = new Map(INTERIORS.map(room => [room.id, room]));
const containerDimensions = { tools: [1.1, .7, .7], electronics: [1.05, .65, .65], medical: [.95, .65, .7], ammo: [1.05, .65, .65], provisions: [1.2, .8, .75], industrial: [1.3, .85, .85], security: [1.1, .75, .8] };
function container(id, type, x, z, interiorId) {
  const [w, d, h] = containerDimensions[type];
  return { id, type, x, z, y: getGroundHeight(x,z), w, d, h, rotation: 0, ...(interiorId ? { interiorId } : {}) };
}
export const CONTAINER_SPOTS = [
  container('arrival-tools', 'tools', -10, 47), container('arrival-medical', 'medical', -15, 47),
  container('cargo-ammo', 'ammo', -29, 34), container('cargo-tools', 'tools', -29, 11), container('cargo-industrial', 'industrial', -46, 9),
  container('power-electronics', 'electronics', 17, 25), container('power-industrial', 'industrial', 42, 30),
  container('relay-security', 'security', 12, -24), container('north-ammo', 'ammo', 19, -46),
  container('rail-industrial', 'industrial', -103, -87), container('rail-tools', 'tools', -79, -94), container('rail-security', 'security', -95, -115),
  container('west-tools', 'tools', -103, 84), container('west-provisions', 'provisions', -93, 95), container('west-medical', 'medical', -79, 112),
  container('water-industrial', 'industrial', -8, -106), container('water-electronics', 'electronics', 6, -120),
  container('refinery-industrial', 'industrial', 97, -86), container('refinery-electronics', 'electronics', 113, -108),
  container('customs-security', 'security', 104, 25), container('customs-ammo', 'ammo', 88, 25),
  container('convoy-provisions', 'provisions', 72, 99), container('convoy-ammo', 'ammo', 97, 104),
  container('south-tools', 'tools', -18, 119), container('south-medical', 'medical', -39, 122),
  container('processing-industrial', 'industrial', -111, -4), container('processing-electronics', 'electronics', -104, -23),
  container('booth-records', 'security', 8.7, 41.2, 'entry-booth'),
  container('warehouse-parts', 'industrial', -30, -19, 'warehouse'), container('warehouse-tools', 'tools', -20, -20, 'warehouse'), container('warehouse-rations', 'provisions', -20, -11.5, 'warehouse'),
  container('rail-office-electronics', 'electronics', -123, -103, 'rail-office'), container('rail-office-records', 'security', -109, -104, 'rail-office'),
  container('customs-office-records', 'security', 86, 5, 'customs-office'), container('customs-office-medical', 'medical', 98, 6, 'customs-office'),
  container('workshop-tools', 'tools', -1, 120, 'south-workshop'), container('workshop-electronics', 'electronics', 7, 125, 'south-workshop'),
];
const containerTypes=['tools','electronics','medical','ammo','provisions','industrial','security'];
for(const [i,room] of INTERIORS.entries()){
 if(!CONTAINER_SPOTS.some(s=>s.interiorId===room.id))CONTAINER_SPOTS.push({...container(`${room.id}-cache`,containerTypes[i%7],room.x-room.w*.22,room.z,room.id),y:room.baseY});
 if(room.levels>1)CONTAINER_SPOTS.push({...container(`${room.id}-upper-cache`,containerTypes[(i+2)%7],room.x-room.w*.22,room.z+room.d*.2,room.id),y:room.baseY+room.floorHeight,level:1});
}
export const SUPPORTS=[...INTERIORS.flatMap(r=>r.supports),...BRIDGES.flatMap(b=>b.supports)];
const supportCells=new Map(),cellSize=20;
for(const s of SUPPORTS)for(let x=Math.floor((s.x-s.w/2)/cellSize);x<=Math.floor((s.x+s.w/2)/cellSize);x++)for(let z=Math.floor((s.z-s.d/2)/cellSize);z<=Math.floor((s.z+s.d/2)/cellSize);z++){const key=`${x}:${z}`;if(!supportCells.has(key))supportCells.set(key,[]);supportCells.get(key).push(s);}
export function getSupportHeight(x,z,currentY=getGroundHeight(x,z)){
 let height=getGroundHeight(x,z);
 for(const s of supportCells.get(`${Math.floor(x/cellSize)}:${Math.floor(z/cellSize)}`)||[])if(Math.abs(x-s.x)<=s.w/2+.001&&Math.abs(z-s.z)<=s.d/2+.001&&s.y<=currentY+.305&&s.y>height)height=s.y;
 return height;
}
export const COLLIDERS = [
 ...OBSTACLES.flatMap(o=>interiorById.get(o.id)?.solids??[{...o,y:o.baseY+o.h/2}]),
 ...SETTLEMENT_WALLS,...VEHICLES.flatMap(vehicleSolids),...BRIDGES.flatMap(b=>b.solids),
 ...CONTAINER_SPOTS.map(s=>({...s,kind:'loot-container',y:s.y+s.h/2})),
 ...[-1,1].flatMap(sx=>[-1,1].map(sz=>({id:`relay-leg-${sx}-${sz}`,kind:'fixture',x:RELAY.x+sx*1.2,y:11,z:RELAY.z+sz*1.2,w:.24,h:22,d:.24}))),
 {id:'relay-console',kind:'fixture',x:RELAY.x,y:.65,z:RELAY.z,w:.9,h:1.3,d:.65},
];
export const layout = {
 size:WORLD_SIZE,obstacles:OBSTACLES,pois:POIS,extractions:EXTRACTIONS,relay:RELAY,spawn:SPAWN,
 interiors:INTERIORS,colliders:COLLIDERS,containers:CONTAINER_SPOTS,supports:SUPPORTS,
 settlements:SETTLEMENTS,walls:SETTLEMENT_WALLS,vehicles:VEHICLES,bridges:BRIDGES,
 getGroundHeight,getSupportHeight,isTerrainWalkable,
};
