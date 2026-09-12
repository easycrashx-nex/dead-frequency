export const WEAPONS = [
  { id: 'VX-9', name: 'VX-9', category: 'Maschinenpistole', description: 'Leichte Automatik für schnelle Gefechte auf kurze Distanz.', damage: 28, magSize: 24, reserve: 72, fireInterval: .095, reloadSeconds: 1.7, pellets: 1, spread: 0, range: 80, automatic: true, cost: 0, recoilPitch: .005, recoilYaw: .0005, model: 'smg', sound: 'smg' },
  { id: 'AR-4', name: 'AR-4', category: 'Sturmgewehr', description: 'Vielseitiges Sturmgewehr mit kräftigem Einzeltreffer.', damage: 37, magSize: 30, reserve: 120, fireInterval: .12, reloadSeconds: 2.1, pellets: 1, spread: 0, range: 110, automatic: true, cost: 0, recoilPitch: .0066, recoilYaw: .00055, model: 'assault', sound: 'rifle' },
  { id: 'BR-12', name: 'BR-12', category: 'Bullpup-Gewehr', description: 'Kompaktes Gewehr mit hoher Feuerrate und großem Magazin.', damage: 32, magSize: 32, reserve: 96, fireInterval: .082, reloadSeconds: 2.35, pellets: 1, spread: .003, range: 100, automatic: true, cost: 250, recoilPitch: .016, recoilYaw: .00055, model: 'bullpup', sound: 'bullpup' },
  { id: 'SG-8', name: 'SG-8', category: 'Pump-Schrotflinte', description: 'Zehn Schrotkugeln pro Patrone; nach jedem Schuss repetieren.', damage: 12, magSize: 8, reserve: 32, fireInterval: .82, reloadSeconds: 3.2, pellets: 10, spread: .065, range: 34, automatic: false, cost: 175, recoilPitch: .027, recoilYaw: .00065, model: 'shotgun', sound: 'shotgun' },
  { id: 'DMR-7', name: 'DMR-7', category: 'Präzisionsgewehr', description: 'Halbautomatische Präzision: ein kräftiger Schuss pro Abzug.', damage: 62, magSize: 12, reserve: 48, fireInterval: .34, reloadSeconds: 2.55, pellets: 1, spread: 0, range: 170, automatic: false, cost: 325, recoilPitch: .022, recoilYaw: .0004, model: 'marksman', sound: 'marksman' },
  { id: 'SR-90', name: 'SR-90', category: 'Repetier-Scharfschützengewehr', description: 'Hohe Reichweite und Durchschlagskraft mit bewusster Repetierpause.', damage: 112, magSize: 5, reserve: 20, fireInterval: 1.2, reloadSeconds: 3.1, pellets: 1, spread: 0, range: 240, automatic: false, cost: 550, recoilPitch: .036, recoilYaw: .00035, model: 'sniper', sound: 'sniper' },
  { id: 'MG-60', name: 'MG-60', category: 'Leichtes Maschinengewehr', description: 'Langes Unterdrückungsfeuer; der Gurtwechsel braucht Zeit.', damage: 26, magSize: 60, reserve: 180, fireInterval: .095, reloadSeconds: 4.4, pellets: 1, spread: .006, range: 130, automatic: true, cost: 425, recoilPitch: .019, recoilYaw: .0006, model: 'machinegun', sound: 'machinegun' },
  { id: 'RV-6', name: 'RV-6', category: 'Revolver', description: 'Sechs kräftige Schüsse in einem günstigen, kompakten Paket.', damage: 55, magSize: 6, reserve: 36, fireInterval: .43, reloadSeconds: 2.65, pellets: 1, spread: 0, range: 75, automatic: false, cost: 0, recoilPitch: .024, recoilYaw: .0006, model: 'revolver', sound: 'revolver' },
];
// Each receiver has its own silhouette, cadence, ammunition and handling. The
// original eight ballistic/recoil profiles above remain unchanged.
const additions = [
  ['KX-5','Maschinenpistole','smg','compact',22,30,120,.066,1.85,1,0,68,true,210,.0058,.0007],
  ['PDW-46','Personal Defense Weapon','smg','pdw',24,40,120,.073,2.15,1,.002,92,true,360,.0054,.00045],
  ['TMP-22','Maschinenpistole','smg','micro',20,20,100,.061,1.5,1,.004,55,true,130,.0065,.0009],
  ['SM-45','Maschinenpistole','smg','heavy',35,22,88,.125,1.95,1,0,78,true,285,.009,.00065],
  ['AK-74','Sturmgewehr','assault','curved',35,30,120,.1,2.35,1,.002,125,true,330,.0095,.00085],
  ['HK-416','Sturmgewehr','assault','quadrail',39,30,90,.112,2.3,1,0,135,true,540,.008,.0006],
  ['SC-17','Kampfgewehr','assault','battle',51,20,80,.17,2.65,1,.002,158,true,610,.013,.0008],
  ['AS-VAL','Spezialgewehr','assault','integral',34,20,100,.074,2.55,1,.002,88,true,575,.0076,.00055],
  ['QB-95','Bullpup-Gewehr','bullpup','carryhandle',34,30,120,.091,2.5,1,.002,122,true,440,.012,.0008],
  ['AUG-77','Bullpup-Gewehr','bullpup','integralscope',36,30,90,.096,2.45,1,0,142,true,495,.011,.00055],
  ['FS-2000','Bullpup-Gewehr','bullpup','enclosed',33,40,120,.081,2.8,1,.002,118,true,520,.010,.0005],
  ['KS-12','Halbautomatische Schrotflinte','shotgun','boxmag',11,6,30,.37,2.65,9,.075,30,false,350,.025,.0009],
  ['DB-2','Doppelflinte','shotgun','doublebarrel',15,2,24,.21,2.15,9,.080,29,false,95,.035,.001],
  ['M4-90','Halbautomatische Schrotflinte','shotgun','semiauto',13,7,28,.46,3.4,8,.055,38,false,470,.029,.00075],
  ['MK-14','Präzisionsgewehr','marksman','wood',57,20,60,.29,2.6,1,.001,185,false,520,.024,.00065],
  ['SVD-63','Präzisionsgewehr','marksman','skeleton',73,10,40,.43,2.7,1,0,215,false,660,.026,.0005],
  ['RS-308','Präzisionsgewehr','marksman','precision',67,15,45,.36,2.8,1,0,205,false,730,.021,.0004],
  ['AX-50','Schweres Scharfschützengewehr','sniper','antimateriel',148,5,15,1.65,3.6,1,0,295,false,1100,.046,.0005],
  ['M24-7','Repetier-Scharfschützengewehr','sniper','classic',98,5,25,1.05,2.95,1,0,250,false,615,.031,.0004],
  ['SV-98','Repetier-Scharfschützengewehr','sniper','competition',106,10,30,1.28,3.25,1,0,265,false,820,.034,.00035],
  ['PK-90','Mittleres Maschinengewehr','machinegun','belt',34,90,180,.108,5.2,1,.007,170,true,750,.024,.00085],
  ['LM-46','Leichtes Maschinengewehr','machinegun','box',29,46,138,.088,3.8,1,.005,145,true,550,.017,.0007],
  ['P9-19','Pistole','pistol','service',31,17,68,.20,1.4,1,.001,65,false,75,.012,.0004],
  ['DE-50','Schwere Pistole','pistol','heavy',76,7,35,.46,1.9,1,0,90,false,395,.032,.0007],
];
for (const [id,category,model,variant,damage,magSize,reserve,fireInterval,reloadSeconds,pellets,spread,range,automatic,cost,recoilPitch,recoilYaw] of additions) {
  WEAPONS.push({ id,name:id,category,description:`${category}: ${magSize} Schuss, ${Math.round(60 / fireInterval)} Schuss/min und ${range} m Einsatzreichweite.`,model,variant,damage,magSize,reserve,fireInterval,reloadSeconds,pellets,spread,range,automatic,cost,recoilPitch,recoilYaw,sound:model === 'pistol' ? 'revolver' : model === 'assault' ? 'rifle' : model });
}
for (const weapon of WEAPONS) {
  weapon.variant ??= 'original';
  weapon.purchaseCost = Math.round(650 + weapon.cost * 4.5);
  weapon.ammoCost = ['sniper','machinegun'].includes(weapon.model) ? 70 : weapon.model === 'pistol' || weapon.model === 'revolver' ? 25 : 40;
  weapon.adsSeconds = ({smg:.19,assault:.26,bullpup:.27,shotgun:.3,marksman:.34,sniper:.44,machinegun:.42,revolver:.2,pistol:.17})[weapon.model];
  weapon.adsZoom = ({marksman:2.5,sniper:4})[weapon.model] ?? 1.35;
  weapon.moveMultiplier = ({machinegun:.9,sniper:.93,shotgun:.97})[weapon.model] ?? 1;
  weapon.soundRadius = weapon.id === 'AS-VAL' ? 22 : 36;
}
const byId = new Map(WEAPONS.map(weapon => [weapon.id, weapon]));
export const getWeapon = id => byId.get(id) ?? null;
export const defaultWeapon = kit => kit === 'assault' ? 'AR-4' : 'VX-9';
