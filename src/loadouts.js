import { WEAPONS, getWeapon } from './weapons.js';

export const ATTACHMENT_SLOTS = ['optic','magazine','muzzle','grip','stock','barrel'];
export const GEAR_SLOTS = ['backpack','carrier','plate','helmet'];
export const LOADOUT_SLOTS = ['weapon', ...GEAR_SLOTS];
export const MEDKIT_COST = 25;
export const MAX_LOADOUT_MEDKITS = 4;
const longGuns = ['smg','assault','bullpup','shotgun','marksman','sniper','machinegun'];
const rifles = ['smg','assault','bullpup','marksman','machinegun'];
const allModels = [...longGuns,'revolver','pistol'];
const attachment = (id, slot, name, cost, model, modifiers, compatible = allModels, description = '') =>
  ({id,kind:'attachment',slot,name,cost,purchaseCost:cost,model,modifiers,compatible,description,rarity:cost >= 700 ? 'epic' : cost >= 350 ? 'rare' : 'common'});
// Multipliers are applied once, in slot order. Optics replace magnification;
// every attachment also has a handling, reach or cost tradeoff.
export const ATTACHMENTS = [
  attachment('optic-reflex','optic','Reflex Micro 1×',240,'micro',{adsZoom:1.35,adsSeconds:.9},allModels,'Schneller Anschlag, geringes Sichtfeldgehäuse.'),
  attachment('optic-holo','optic','Holografisch H2',330,'holo',{adsZoom:1.6,adsSeconds:1.06},longGuns,'Breites Fenster; etwas schwerer.'),
  attachment('optic-prism','optic','Prisma P2 · 2×',420,'prism',{adsZoom:2,adsSeconds:1.12},longGuns,'Mittlere Distanz, langsamerer Anschlag.'),
  attachment('optic-acog','optic','Prisma A4 · 4×',650,'acog',{adsZoom:4,adsSeconds:1.25},['assault','bullpup','marksman','sniper','machinegun'],'Deutliche Vergrößerung mit engerem Sichtfeld.'),
  attachment('optic-sniper','optic','Zielfernrohr S6 · 6×',850,'scope',{adsZoom:6,adsSeconds:1.4},['marksman','sniper'],'Weite Sicht, schwerer Anschlag.'),
  attachment('optic-open','optic','Offenes Sportvisier',140,'open',{adsZoom:1.15,adsSeconds:.8,recoilYaw:1.05},allModels,'Sehr schnell; kaum Vergrößerung und weniger Seitenkontrolle.'),
  attachment('mag-fast','magazine','Magazin mit Ziehlasche',200,'pulltab',{reloadSeconds:.82,adsSeconds:1.03},allModels,'Schneller Wechsel, leicht schwerer.'),
  attachment('mag-extended','magazine','Verlängertes Magazin',350,'extended',{magSize:1.4,reloadSeconds:1.14,adsSeconds:1.08},[...rifles,'pistol'],'Mehr Patronen, langsamerer Wechsel.'),
  attachment('mag-drum','magazine','Trommelmagazin',720,'drum',{magSize:2,reloadSeconds:1.4,adsSeconds:1.25,moveMultiplier:.97},rifles,'Doppelte Kapazität; deutlich schwerer.'),
  attachment('mag-compact','magazine','Kurzes Leichtmagazin',180,'compact',{magSize:.7,reloadSeconds:.78,adsSeconds:.9},allModels,'Weniger Patronen, schnelles Handling.'),
  attachment('mag-coupled','magazine','Gekoppeltes Magazin',480,'coupled',{magSize:1.2,reloadSeconds:.9,adsSeconds:1.17,moveMultiplier:.99},rifles,'Schneller Reservewechsel, schwerer Verbund.'),
  attachment('mag-precision','magazine','Präzisionszuführung',460,'precision',{magSize:1.15,reloadSeconds:1.12,spread:.8},['shotgun','marksman','sniper','revolver'],'Saubere Zuführung; längerer Wechsel.'),
  attachment('muzzle-brake','muzzle','Zweikammerbremse',380,'brake',{recoilPitch:.78,recoilYaw:1.08,soundRadius:1.2},longGuns,'Weniger Hochschlag, lauter und seitlich unruhiger.'),
  attachment('muzzle-comp','muzzle','Kompensator C4',420,'compensator',{recoilYaw:.65,recoilPitch:.94,adsSeconds:1.08},allModels,'Starke Seitenkontrolle, mehr Frontgewicht.'),
  attachment('muzzle-suppressor','muzzle','Schalldämpfer S',680,'suppressor',{soundRadius:.55,range:.94,adsSeconds:1.15},['smg','assault','bullpup','marksman','sniper','pistol'],'Weniger hörbar, etwas weniger Reichweite.'),
  attachment('muzzle-heavy-can','muzzle','Schwerer Schalldämpfer',900,'heavycan',{soundRadius:.38,recoilPitch:.9,adsSeconds:1.28,moveMultiplier:.985},['assault','bullpup','marksman','sniper'],'Starke Dämpfung, hohes Frontgewicht.'),
  attachment('muzzle-choke','muzzle','Präzisions-Choke',320,'choke',{spread:.62,range:1.18,reloadSeconds:1.05},['shotgun'],'Engere Garbe für gezielte Treffer.'),
  attachment('muzzle-short','muzzle','Leichter Mündungsring',120,'ring',{adsSeconds:.94,recoilPitch:1.08},allModels,'Leicht; weniger Rückstoßkontrolle.'),
  attachment('grip-vertical','grip','Vertikaler Vordergriff',260,'vertical',{recoilPitch:.84,adsSeconds:1.08},longGuns,'Weniger Hochschlag, langsamerer Anschlag.'),
  attachment('grip-angled','grip','Winkelgriff',300,'angled',{adsSeconds:.88,recoilYaw:1.07},longGuns,'Schneller Anschlag, weniger Seitenhalt.'),
  attachment('grip-stubby','grip','Kurzer Vordergriff',340,'stubby',{recoilPitch:.94,recoilYaw:.86,adsSeconds:1.03},longGuns,'Kompromiss für kontrollierte Feuerstöße.'),
  attachment('grip-bipod','grip','Zweibein',560,'bipod',{recoilPitch:.72,recoilYaw:.8,adsSeconds:1.25,moveMultiplier:.98},['marksman','sniper','machinegun'],'Schweres Stützsystem stabilisiert die Waffe.'),
  attachment('grip-rubber','grip','Gummierter Griff',160,'rubber',{recoilYaw:.9,reloadSeconds:1.03},allModels,'Sicherer Halt, leicht langsameres Umgreifen.'),
  attachment('grip-skeleton','grip','Skelettgriff',240,'skeleton',{adsSeconds:.92,moveMultiplier:1.01,recoilPitch:1.07},longGuns,'Beweglich und leicht; mehr Hochschlag.'),
  attachment('stock-heavy','stock','Schwerer Präzisionsschaft',520,'heavy',{recoilPitch:.82,recoilYaw:.84,adsSeconds:1.19,moveMultiplier:.97},longGuns,'Ruhige Schussabgabe, schweres Handling.'),
  attachment('stock-folding','stock','Klappschaft',300,'folding',{adsSeconds:.88,moveMultiplier:1.025,recoilPitch:1.14},longGuns,'Kompakt mit mehr Rückstoß.'),
  attachment('stock-padded','stock','Gepolsterter Schaft',260,'padded',{recoilPitch:.9,adsSeconds:1.05},longGuns,'Dämpfung für die Schulter; leicht schwerer.'),
  attachment('stock-marksman','stock','Verstellbare Wangenauflage',480,'marksman',{recoilYaw:.76,adsSeconds:1.15},['assault','bullpup','marksman','sniper','machinegun'],'Stabiler Seitenanschlag, mehr Masse.'),
  attachment('stock-light','stock','Leichtschaft',220,'light',{adsSeconds:.9,moveMultiplier:1.02,recoilYaw:1.13},longGuns,'Agiles Handling, weniger Seitenstabilität.'),
  attachment('stock-balanced','stock','Ausgleichsschaft',390,'balanced',{recoilPitch:.94,recoilYaw:.94,reloadSeconds:.95,adsSeconds:1.07},allModels,'Ausgewogenes Gewicht für kontrollierte Wechsel.'),
  attachment('barrel-long','barrel','Verlängerter Lauf',520,'long',{range:1.28,damage:1.04,adsSeconds:1.2,moveMultiplier:.98},allModels,'Mehr Reichweite, längere Front.'),
  attachment('barrel-short','barrel','Kompaktlauf',290,'short',{range:.8,adsSeconds:.83,moveMultiplier:1.025,recoilPitch:1.1},allModels,'Agiler, weniger Reichweite.'),
  attachment('barrel-heavy','barrel','Schwerer Matchlauf',740,'heavy',{damage:1.07,spread:.72,recoilPitch:.94,adsSeconds:1.25,moveMultiplier:.975},longGuns,'Präzision und Energie; schwerer.'),
  attachment('barrel-fluted','barrel','Kannelierter Lauf',590,'fluted',{range:1.12,adsSeconds:.96,recoilYaw:1.08},allModels,'Leichte Laufkontur mit mehr Reichweite.'),
  attachment('barrel-ported','barrel','Portierter Lauf',470,'ported',{recoilPitch:.82,range:.94,soundRadius:1.15},allModels,'Gasentlastung reduziert Hochschlag, ist lauter.'),
  attachment('barrel-cold','barrel','Kaltgeschmiedeter Lauf',820,'cold',{range:1.17,damage:1.025,spread:.86,reloadSeconds:1.07,adsSeconds:1.1},allModels,'Hohe Präzision; etwas schwereres Handling.'),
];
const equipmentGroup = (slot, rows) => rows.map(([id,name,cost,armor,capacity,speedMultiplier,protection,model],index) => ({id,name,kind:'equipment',slot,cost,purchaseCost:cost,armor,capacity,speedMultiplier,protection,model,rarity:index > 3 ? 'epic' : index > 1 ? 'rare' : 'common',description:slot === 'backpack' ? `${capacity} Beuteplätze. ${Math.round(speedMultiplier * 100)} % Bewegungstempo.` : `${armor} Panzerung. ${Math.round(protection * 100)} % zusätzliche Schadensminderung.`}));
export const EQUIPMENT = [
  ...equipmentGroup('backpack',[
    ['pack-sling','Umhängetasche',280,0,8,1,0,'sling'],['pack-day','Tagesrucksack',490,0,10,.99,0,'day'],['pack-assault','Sturmrucksack',820,0,12,.98,0,'assault'],['pack-patrol','Patrouillenrucksack',1250,0,16,.94,0,'patrol'],['pack-hauler','Lastenträger',1850,0,20,.9,0,'frame'],['pack-expedition','Expeditionsrucksack',2600,0,24,.86,0,'expedition'],
  ]),
  ...equipmentGroup('carrier',[
    ['carrier-web','Leichter Träger',260,5,0,1,0,'web'],['carrier-scout','Spähträger',460,10,0,.995,.015,'scout'],['carrier-modular','Modularer Plattenträger',780,15,0,.98,.03,'modular'],['carrier-assault','Sturm-Plattenträger',1100,20,0,.96,.045,'assault'],['carrier-heavy','Schwerer Plattenträger',1600,25,0,.935,.055,'heavy'],['carrier-fortress','Festungsweste',2300,35,0,.9,.065,'fortress'],
  ]),
  ...equipmentGroup('plate',[
    ['plate-fiber','Faser-Schutzplatte',300,20,0,1,0,'fiber'],['plate-steel','Stahl-Schutzplatte',540,35,0,.98,.02,'steel'],['plate-ceramic','Keramik-Schutzplatte',880,50,0,.99,.025,'ceramic'],['plate-composite','Verbund-Schutzplatte',1300,65,0,.975,.035,'composite'],['plate-titan','Titan-Schutzplatte',1950,80,0,.98,.045,'titan'],['plate-boron','Borkarbid-Schutzplatte',2900,100,0,.96,.055,'boron'],
  ]),
  ...equipmentGroup('helmet',[
    ['helmet-bump','Stoßschutzhelm',220,5,0,1,0,'bump'],['helmet-patrol','Patrouillenhelm',380,10,0,1,.01,'patrol'],['helmet-ballistic','Ballistikhelm',650,15,0,.995,.02,'ballistic'],['helmet-highcut','High-Cut-Helm',990,20,0,1,.025,'highcut'],['helmet-assault','Sturmhelm',1450,25,0,.98,.035,'assault'],['helmet-visor','Visierhelm',2100,30,0,.96,.045,'visor'],
  ]),
];
export const PRESET_KITS = [
  {id:'scout',name:'Notfall · Scout',description:'Kostenloses, festes Einsatzkit. Gestellte Ausrüstung ist nicht handelbar.',cost:0,weapon:'VX-9',attachments:{},gear:{backpack:'pack-sling',carrier:'carrier-web',plate:'plate-fiber',helmet:'helmet-bump'},medkits:2},
  {id:'assault',name:'Sturmtrupp',description:'Ausgewogenes Sturmgewehr-Kit für direkte Gefechte.',cost:350,weapon:'AR-4',attachments:{},gear:{backpack:'pack-sling',carrier:'carrier-scout',plate:'plate-steel',helmet:'helmet-patrol'},medkits:2},
  {id:'breacher',name:'Türöffner',description:'Schrotflinte, kompakte Ausrüstung und engere Garbe.',cost:470,weapon:'SG-8',attachments:{muzzle:'muzzle-choke',stock:'stock-padded'},gear:{backpack:'pack-day',carrier:'carrier-modular',plate:'plate-steel',helmet:'helmet-ballistic'},medkits:3},
  {id:'recon',name:'Fernaufklärer',description:'Halbautomatisches Präzisionskit mit 4-facher Optik.',cost:680,weapon:'DMR-7',attachments:{optic:'optic-acog',grip:'grip-stubby'},gear:{backpack:'pack-assault',carrier:'carrier-scout',plate:'plate-ceramic',helmet:'helmet-highcut'},medkits:2},
  {id:'support',name:'Unterstützer',description:'Maschinengewehr, viel Schutz und Reservemunition.',cost:850,weapon:'MG-60',attachments:{grip:'grip-bipod',stock:'stock-heavy'},gear:{backpack:'pack-patrol',carrier:'carrier-heavy',plate:'plate-composite',helmet:'helmet-assault'},medkits:3},
  {id:'infiltrator',name:'Infiltrator',description:'Leise PDW mit Reflexvisier und schneller Ausrüstung.',cost:720,weapon:'PDW-46',attachments:{optic:'optic-reflex',muzzle:'muzzle-suppressor',magazine:'mag-fast'},gear:{backpack:'pack-assault',carrier:'carrier-scout',plate:'plate-ceramic',helmet:'helmet-highcut'},medkits:2},
];
const attachmentsById = new Map(ATTACHMENTS.map(item => [item.id,item]));
const equipmentById = new Map(EQUIPMENT.map(item => [item.id,item]));
const presetsById = new Map(PRESET_KITS.map(item => [item.id,item]));
export const getAttachment = id => attachmentsById.get(id) ?? null;
export const getEquipment = id => equipmentById.get(id) ?? null;
export const getPresetKit = id => presetsById.get(id) ?? null;
export const getCatalogItem = id => getAttachment(id) ?? getEquipment(id) ?? (getWeapon(id) ? {...getWeapon(id),kind:'weapon',cost:getWeapon(id).purchaseCost} : null);
export const SHOP_ITEMS = [...WEAPONS.map(item => getCatalogItem(item.id)),...ATTACHMENTS,...EQUIPMENT];
export function canAttach(weaponId, attachmentId) {
  const weapon = getWeapon(weaponId), part = getAttachment(attachmentId);
  return !!weapon && !!part && part.compatible.includes(weapon.model)
    && !(weapon.id === 'DB-2' && part.slot === 'magazine' && !['mag-fast','mag-compact','mag-precision'].includes(part.id));
}
const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
const condition = value => Number.isFinite(value) ? clamp(value,0,1) : 1;
export function attachmentIds(attachments = {}) {
  return Object.fromEntries(ATTACHMENT_SLOTS.flatMap(slot => {const id = typeof attachments?.[slot] === 'string' ? attachments[slot] : attachments?.[slot]?.catalogId;return id ? [[slot,id]] : [];}));
}
export function deriveWeapon(weaponId, attachments = {}) {
  const base = getWeapon(weaponId); if (!base) return null;
  const weapon = {...base,attachments:{}};
  for (const [slot,id] of Object.entries(attachmentIds(attachments))) {
    const part = getAttachment(id); if (!canAttach(weaponId,id) || part.slot !== slot) continue;
    weapon.attachments[slot] = id;
    for (const [key,value] of Object.entries(part.modifiers)) weapon[key] = key === 'adsZoom' ? value : weapon[key] * value;
  }
  weapon.magSize = clamp(Math.round(weapon.magSize),1,200);
  weapon.adsSeconds = clamp(weapon.adsSeconds,.09,.95);
  weapon.moveMultiplier = clamp(weapon.moveMultiplier,.7,1.1);
  weapon.reloadSeconds = clamp(weapon.reloadSeconds,.65,9);
  weapon.noiseMultiplier = weapon.soundRadius / 36;
  return weapon;
}
export function deriveGear(equipment = {}) {
  let maxArmor = 0, armor = 0, speedMultiplier = 1, protection = 0;
  const pack = getEquipment(equipment.backpack?.catalogId ?? equipment.backpack);
  for (const slot of GEAR_SLOTS) {
    const instance = equipment[slot], gear = getEquipment(instance?.catalogId ?? instance);
    if (!gear || gear.slot !== slot || (slot === 'plate' && !equipment.carrier)) continue;
    maxArmor += gear.armor; armor += gear.armor * condition(instance?.condition);
    speedMultiplier *= gear.speedMultiplier;
    protection += gear.protection * condition(instance?.condition);
  }
  return {capacity:pack?.capacity ?? 4,maxArmor,armor,speedMultiplier:clamp(speedMultiplier,.6,1.05),damageReduction:clamp(protection,0,.25)};
}
export function makeCatalogItem(catalogId, id, {issued = false, condition:durability = 1, attachments = {}} = {}) {
  const catalog = getCatalogItem(catalogId); if (!catalog) return null;
  const item = {id,kind:catalog.kind,catalogId,name:catalog.name,value:Math.max(1,Math.round(catalog.purchaseCost * .4)),rarity:catalog.rarity ?? (catalog.purchaseCost > 2600 ? 'epic' : catalog.purchaseCost > 1300 ? 'rare' : 'common')};
  if (catalog.kind === 'equipment') { item.condition = condition(durability); item.value = Math.max(1,Math.round(item.value * (.25 + .75 * item.condition))); }
  if (catalog.kind === 'weapon') item.attachments = attachments;
  if (issued) item.issued = true;
  if (catalog.kind === 'weapon') item.value += Object.values(attachments).reduce((sum,part) => sum + (part.value ?? 0),0);
  return item;
}

// Canonical catalog data owns stats, names and resale basis. Saved nested parts
// are bounded to the six compatible slots; shared economy validation owns IDs.
export function cleanLoadoutItem(raw) {
  if (!raw || raw.issued || !['weapon','attachment','equipment'].includes(raw.kind)) return null;
  const catalog = getCatalogItem(raw.catalogId); if (!catalog || catalog.kind !== raw.kind) return null;
  const parts = {};
  if (catalog.kind === 'weapon') for (const slot of ATTACHMENT_SLOTS) {
    const part = raw.attachments?.[slot];
    if (!part || part.kind !== 'attachment' || getAttachment(part.catalogId)?.slot !== slot || !canAttach(catalog.id,part.catalogId)) continue;
    const clean = cleanLoadoutItem(part); if (clean) parts[slot] = clean;
  }
  return makeCatalogItem(catalog.id,typeof raw.id === 'string' ? raw.id.slice(0,100) : '',{condition:raw.condition,attachments:parts});
}
export function normalizeSelection(profile, request = {}) {
  const source = request.loadout ?? (request.mode ? request : profile?.loadout) ?? {};
  const custom = source.custom && typeof source.custom === 'object' ? source.custom : profile?.loadout?.custom ?? {};
  const refs = Object.fromEntries(LOADOUT_SLOTS.map(slot => [slot,typeof custom[slot] === 'string' ? custom[slot].slice(0,100) : null]));
  refs.medkits = Number.isInteger(custom.medkits) ? clamp(custom.medkits,0,MAX_LOADOUT_MEDKITS) : 2;
  return {mode:request.kit !== undefined && !request.loadout ? 'preset' : source.mode === 'custom' ? 'custom' : 'preset',presetId:getPresetKit(request.kit ?? source.presetId)?.id ?? 'scout',custom:refs};
}
export function validateLoadout(profile, source = profile?.loadout) {
  const selection = normalizeSelection(profile,{loadout:source});
  for (const slot of LOADOUT_SLOTS) {
    const item = [...(profile?.stash ?? []),...(profile?.intake ?? [])].find(item => item.id === selection.custom[slot]);
    if (!item || item.issued || (slot === 'weapon' ? item.kind !== 'weapon' : getEquipment(item.catalogId)?.slot !== slot)) selection.custom[slot] = null;
  }
  if (!selection.custom.carrier) selection.custom.plate = null;
  return selection;
}
export function resolveLoadout(profile, request = {}) {
  const selection = normalizeSelection(profile,request), preset = getPresetKit(selection.presetId);
  const fail = reason => ({valid:false,reason,cost:0,selection,weapon:null,equipment:{},gearStats:deriveGear()});
  if (request.kit !== undefined && !getPresetKit(request.kit)) return fail('Unbekanntes Einsatzkit.');
  if (request.loadout?.mode !== undefined && !['preset','custom'].includes(request.loadout.mode)) return fail('Unbekannter Loadout-Modus.');
  if (request.loadout?.presetId !== undefined && !getPresetKit(request.loadout.presetId)) return fail('Unbekanntes Einsatzkit.');
  let weaponInstance, equipment = {}, cost = 0, medkits;
  if (selection.mode === 'preset') {
    if (request.weapon !== undefined && request.weapon !== preset.weapon) return fail('Feste Kits können nicht verändert werden. Wähle ein eigenes Kit.');
    const parts = Object.fromEntries(Object.entries(preset.attachments).map(([slot,id]) => [slot,makeCatalogItem(id,`issued-${slot}`,{issued:true})]));
    weaponInstance = makeCatalogItem(preset.weapon,'issued-weapon',{issued:true,attachments:parts});
    equipment = Object.fromEntries(GEAR_SLOTS.map(slot => [slot,makeCatalogItem(preset.gear[slot],`issued-${slot}`,{issued:true})]));
    cost = preset.cost; medkits = preset.medkits;
  } else {
    if (request.weapon !== undefined) return fail('Eigene Kits verwenden die ausgewählte besessene Waffeninstanz.');
    for (const slot of LOADOUT_SLOTS) {
      const id = selection.custom[slot];
      if (!id) {if (slot === 'weapon') return fail('Wähle eine Waffe aus deinem Lager.');continue;}
      const item = profile?.stash?.find(item => item.id === id);
      if (!item || item.issued || (slot === 'weapon' ? item.kind !== 'weapon' || !getWeapon(item.catalogId) : getEquipment(item.catalogId)?.slot !== slot)) return fail('Ausgewählte Ausrüstung liegt nicht im Lager.');
      if (slot === 'weapon') weaponInstance = structuredClone(item); else equipment[slot] = structuredClone(item);
    }
    if (equipment.plate && !equipment.carrier) return fail('Die Schutzplatte benötigt einen Plattenträger.');
    medkits = selection.custom.medkits;
    cost = getWeapon(weaponInstance.catalogId).ammoCost + medkits * MEDKIT_COST;
  }
  const weapon = deriveWeapon(weaponInstance.catalogId,weaponInstance.attachments), gearStats = deriveGear(equipment);
  return {valid:true,reason:'',selection,name:selection.mode === 'preset' ? preset.name : 'Eigenes Kit',kit:selection.presetId,cost,weapon,weaponInstance,equipment,gearStats,medkits,issued:selection.mode === 'preset',affordable:(profile?.credits ?? 0) >= cost};
}

export function repairLoadoutReferences(profile) { profile.loadout = validateLoadout(profile); }
export function purchaseEquipment(profile, catalogId, allocate) {
  const catalog = getCatalogItem(catalogId);
  if (!catalog || profile.credits < catalog.purchaseCost) return false;
  const item = makeCatalogItem(catalogId,allocate());
  profile.credits -= catalog.purchaseCost; profile.stash.push(item); return item;
}
export function equipLoadout(profile, slot, itemId) {
  if (slot === 'medkits') {if (!Number.isInteger(itemId) || itemId < 0 || itemId > MAX_LOADOUT_MEDKITS) return false;profile.loadout.custom.medkits = itemId;return true;}
  if (!LOADOUT_SLOTS.includes(slot)) return false;
  const item = itemId === null ? null : profile.stash.find(item => item.id === itemId);
  if (itemId !== null && (!item || item.issued || (slot === 'weapon' ? item.kind !== 'weapon' : getEquipment(item.catalogId)?.slot !== slot))) return false;
  if (slot === 'plate' && item && !profile.loadout.custom.carrier) return false;
  profile.loadout.custom[slot] = item?.id ?? null;
  if (slot === 'carrier' && !item) profile.loadout.custom.plate = null;
  if (slot === 'weapon' && item) profile.selectedWeapon = item.catalogId;
  return true;
}
export function mountAttachment(profile, weaponItemId, slot, attachmentItemId) {
  const weapon = profile.stash.find(item => item.id === weaponItemId && item.kind === 'weapon' && !item.issued);
  if (!weapon || !ATTACHMENT_SLOTS.includes(slot)) return false;
  const index = attachmentItemId === null ? -1 : profile.stash.findIndex(item => item.id === attachmentItemId && item.kind === 'attachment' && !item.issued);
  const part = profile.stash[index];
  if (attachmentItemId !== null && (!part || getAttachment(part.catalogId)?.slot !== slot || !canAttach(weapon.catalogId,part.catalogId))) return false;
  const previous = weapon.attachments?.[slot];
  if (!part && !previous) return false;
  weapon.attachments ??= {};
  if (part) profile.stash.splice(index,1);
  if (previous) profile.stash.push(previous);
  if (part) weapon.attachments[slot] = part; else delete weapon.attachments[slot];
  weapon.value = makeCatalogItem(weapon.catalogId,weapon.id,{attachments:weapon.attachments}).value;
  return true;
}
