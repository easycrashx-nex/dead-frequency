import { ECONOMY_BALANCE } from './economy.js';
import { SHOP_ITEMS, makeCatalogItem } from './loadouts.js';

export const CONTAINER_SEARCH_SECONDS = 1.5;
export const CONTAINER_TYPES = [
  { id: 'tools', name: 'Werkzeugkiste', color: '#c3994a', description: 'Werkzeuge und Reparaturmaterial' },
  { id: 'electronics', name: 'Elektronikkoffer', color: '#64b6ca', description: 'Bauteile, Sensoren und Datentechnik' },
  { id: 'medical', name: 'Sanitätskiste', color: '#b56c64', description: 'Medizinische Ausrüstung und Medkits' },
  { id: 'ammo', name: 'Munitionskiste', color: '#8b9b67', description: 'Munition und Waffenbedarf' },
  { id: 'provisions', name: 'Vorratskiste', color: '#ba976e', description: 'Verpflegung und Feldversorgung' },
  { id: 'industrial', name: 'Industriekiste', color: '#d28a52', description: 'Maschinenteile und Werkstoffe' },
  { id: 'security', name: 'Sicherheitskoffer', color: '#8e93bc', description: 'Zugangstechnik und sensible Ausrüstung' },
];

const group = (type, rows) => rows.map(([name, value, rarity = 'common'], index) => ({ id: `${type}-${String(index + 1).padStart(2, '0')}`, type, name, value, rarity }));
export const NEW_ITEMS = [
  ...group('tools', [
    ['Ratschenkasten', 145], ['Drehmomentschlüssel', 260, 'rare'], ['Präzisionszange', 90], ['Kabelabisolierer', 85], ['Schraubstockbacken', 110],
    ['Digitaler Messschieber', 240, 'rare'], ['Schweißelektroden', 120], ['Bohrkrone', 180], ['Lötstation', 330, 'rare'], ['Hydraulischer Abzieher', 460, 'epic'],
    ['Feilenrolle', 75], ['Gewindeschneidsatz', 205], ['Industrielle Nietzange', 190], ['Isolierter Schraubendrehersatz', 155], ['Laser-Nivelliergerät', 520, 'epic'],
  ]),
  ...group('electronics', [
    ['Keramikkondensatoren', 85], ['Glasfaserkoppler', 175], ['Spannungsregler', 145], ['Servoplatine', 350, 'rare'], ['Hochfrequenzverstärker', 470, 'rare'],
    ['Satellitenmodem', 880, 'epic'], ['Wärmebildmatrix', 1050, 'epic'], ['Optischer Encoder', 280, 'rare'], ['Industrie-SSD', 410, 'rare'], ['Quarzoszillator', 95],
    ['Leistungstransistoren', 125], ['Keramikantenne', 155], ['Programmieradapter', 225, 'rare'], ['Glasfaser-Spleißmodul', 690, 'epic'], ['Entstörfilter', 110],
  ]),
  ...group('medical', [
    ['Sterile Kompressen', 70], ['Chirurgische Nahtsets', 160], ['Infusionsschläuche', 90], ['Pulsoximeter', 245, 'rare'], ['Feldstethoskop', 180],
    ['Diagnostik-Lesegerät', 640, 'epic'], ['Traumaschere', 115], ['Desinfektionskonzentrat', 135], ['Vakuumschiene', 290, 'rare'], ['Verbandsklammern', 65],
    ['Notfallbeatmungsbeutel', 325, 'rare'], ['Medizinische Kühlampulle', 470, 'rare'], ['Blutdruckmodul', 380, 'rare'], ['Tragbarer Defibrillator', 990, 'epic'],
  ]),
  ...group('ammo', [
    ['Leere Patronenhülsen', 55], ['Magazinfederpaket', 95], ['Waffenreinigungsset', 150], ['Geschosswaage', 275, 'rare'], ['Patronenlehre', 130],
    ['Ladepressenmatrize', 330, 'rare'], ['AR-Magazingehäuse', 175], ['SMG-Magazingehäuse', 140], ['Ballistisches Messmodul', 820, 'epic'], ['Verschlussfeder', 185],
    ['Korrosionsschutzöl', 80], ['Laufprüfspiegel', 225, 'rare'], ['Munitionsgurtglieder', 105], ['Optischer Schusstimer', 490, 'epic'],
  ]),
  ...group('provisions', [
    ['Versiegelte Feldration', 115], ['Instantkaffee-Dose', 85], ['Mineralsalztabletten', 60], ['Wasserfilterpatrone', 195], ['Isolierflasche', 140],
    ['Expeditionskocher', 310, 'rare'], ['Gefriergetrocknete Beeren', 155], ['Elektrolyt-Konzentrat', 125], ['Notfall-Deckenpack', 100], ['Mechanischer Dosenöffner', 55],
    ['Keramik-Trinkfilter', 270, 'rare'], ['Vakuum-Frischhaltebox', 180], ['Feldküchen-Regelventil', 370, 'rare'], ['Langzeit-Rationspaket', 530, 'epic'],
  ]),
  ...group('industrial', [
    ['Kugellagersatz', 175], ['Hydraulikdichtung', 125], ['Wolframelektrode', 285, 'rare'], ['Druckmanometer', 210], ['Pumpenlaufrad', 340, 'rare'],
    ['Kohlenstoffgewebe', 425, 'rare'], ['Molybdänschmierstoff', 150], ['Keramiklager', 460, 'rare'], ['Servogetriebe', 750, 'epic'], ['Hitzeschildplatte', 390, 'rare'],
    ['Ventilsteuerblock', 580, 'epic'], ['Kupferrohrbogen', 105], ['Industriekeilriemen', 135], ['Turbinenleitschaufel', 960, 'epic'],
  ]),
  ...group('security', [
    ['Unbeschriebene Zugangskarte', 95], ['Sicherheitssiegelrolle', 120], ['Türkontaktmodul', 175], ['Alarmzentralen-Platine', 390, 'rare'], ['Biometrischer Leser', 680, 'epic'],
    ['Mechanischer Tresorzylinder', 310, 'rare'], ['Manipulationssensor', 260, 'rare'], ['Sicherheitskamera-Objektiv', 355, 'rare'], ['Abschirmtasche', 185], ['Notfall-Schlüsseldepot', 230],
    ['Verschlüsselungstoken', 790, 'epic'], ['Zutrittsprotokoll-Speicher', 460, 'rare'], ['Plombierzange', 145], ['Mehrkanal-Überwachungsmodul', 1080, 'epic'],
  ]),
];

// Preserve all nine original goods, including their names, values and rarity.
export const LEGACY_ITEMS = [
  { id: 'legacy-copper', type: 'industrial', name: 'Kupferspulen', value: 120, rarity: 'common' },
  { id: 'legacy-tools', type: 'tools', name: 'Werkzeugset', value: 160, rarity: 'common' },
  { id: 'legacy-filter', type: 'industrial', name: 'Industriefilter', value: 140, rarity: 'common' },
  { id: 'legacy-sensor', type: 'electronics', name: 'Militärsensor', value: 290, rarity: 'rare' },
  { id: 'legacy-radio', type: 'electronics', name: 'Funkmodul', value: 340, rarity: 'rare' },
  { id: 'legacy-titanium', type: 'industrial', name: 'Titanlegierung', value: 270, rarity: 'rare' },
  { id: 'legacy-data', type: 'security', name: 'Verschlüsselter Datenträger', value: 650, rarity: 'epic' },
  { id: 'legacy-processor', type: 'electronics', name: 'Quantenprozessor', value: 780, rarity: 'epic' },
  { id: 'legacy-optic', type: 'security', name: 'Prototyp-Optik', value: 590, rarity: 'epic' },
];
export const ITEM_CATALOG = [...LEGACY_ITEMS, ...NEW_ITEMS];
export const ITEM_POOLS = Object.fromEntries(CONTAINER_TYPES.map(type => [type.id, ITEM_CATALOG.filter(item => item.type === type.id)]));
const RARITY_WEIGHTS = { common: 6, rare: 3, epic: 1 };
// Additional, relatively uncommon working equipment. The original 109 goods
// and their three-to-five-item rarity rolls remain intact.
export const EQUIPMENT_POOLS = Object.fromEntries(CONTAINER_TYPES.map(type => [type.id,SHOP_ITEMS.filter(item => {
  if (item.kind === 'weapon') return ['ammo','security'].includes(type.id);
  if (item.kind === 'attachment') return ({optic:['electronics','security'],magazine:['ammo'],muzzle:['ammo','tools'],grip:['tools'],stock:['industrial','tools'],barrel:['industrial','ammo']})[item.slot]?.includes(type.id);
  return ({backpack:['provisions','medical'],carrier:['security'],plate:['industrial','security'],helmet:['security','provisions']})[item.slot]?.includes(type.id);
})]));
export function rollContainerItems(spot, random, raid, difficulty = 'normal') {
  const pool = [...ITEM_POOLS[spot.type]], count = 3 + Math.floor(random() * 3), items = [];
  for (let i = 0; i < count; i++) {
    let draw = random() * pool.reduce((sum, item) => sum + RARITY_WEIGHTS[item.rarity], 0), index = 0;
    while (index < pool.length - 1 && (draw -= RARITY_WEIGHTS[pool[index].rarity]) >= 0) index++;
    const item = pool.splice(index, 1)[0];
    items.push({ id: `r${raid}-${spot.id}-${i}`, name: item.name, value: Math.round(item.value * ECONOMY_BALANCE.lootValueMultiplier * (difficulty === 'hard' ? 1.35 : 1)), rarity: item.rarity, taken: false });
  }
  if (spot.type === 'ammo') items.push({ id: `r${raid}-${spot.id}-supply`, name: 'Munition · +36', value: 0, rarity: 'common', kind: 'ammo', amount: 36, taken: false });
  if (spot.type === 'medical') items.push({ id: `r${raid}-${spot.id}-supply`, name: 'Medkit · +1', value: 0, rarity: 'rare', kind: 'medkit', amount: 1, taken: false });
  const equipmentPool = EQUIPMENT_POOLS[spot.type];
  if (equipmentPool?.length && random() < (['ammo','security'].includes(spot.type) ? .24 : .16)) {
    const rarityWeight = item => item.purchaseCost > 2600 ? .35 : item.purchaseCost > 1300 ? 1 : item.purchaseCost > 650 ? 2 : 4;
    let draw = random() * equipmentPool.reduce((sum,item) => sum + rarityWeight(item),0), selected = equipmentPool.at(-1);
    for (const item of equipmentPool) if ((draw -= rarityWeight(item)) <= 0) {selected = item;break;}
    items.push({...makeCatalogItem(selected.id,`r${raid}-${spot.id}-gear`),taken:false});
  }
  return items;
}
