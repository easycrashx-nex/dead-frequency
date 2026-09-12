import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS,getWeapon } from '../src/weapons.js';
import { ATTACHMENTS,EQUIPMENT,PRESET_KITS,ATTACHMENT_SLOTS,GEAR_SLOTS,SHOP_ITEMS,getAttachment,getEquipment,getCatalogItem,canAttach,deriveWeapon,deriveGear,makeCatalogItem,resolveLoadout,normalizeSelection,purchaseEquipment,equipLoadout,mountAttachment } from '../src/loadouts.js';
import { createGame,validateProfile,seededRandom } from '../src/simulation.js';
import { storeAll,listItem,cancelListing,claimAll,createItem } from '../src/economy.js';
import { EQUIPMENT_POOLS,CONTAINER_TYPES,NEW_ITEMS,rollContainerItems } from '../src/loot-catalog.js';
import { EXTRACTIONS } from '../src/layout.js';
import { ownedProfile } from './loadout-helpers.js';

const starterGear = ['pack-sling','carrier-web','plate-fiber','helmet-bump'];
const run = (game,seconds) => {for(let step=0;step<Math.ceil(seconds*60);step++) game.update(1/60);};
async function setup(t,profile = ownedProfile({weapon:'AR-4',gear:starterGear}),options={}) {
  const game = await createGame(profile,{externalAI:true,...options});t.after(()=>game.dispose());return game;
}
function extract(game) {const exit=EXTRACTIONS[0];assert.equal(game.teleport(exit.x,exit.z),true);assert.equal(game.interact(),true);run(game,8.1);assert.equal(game.state.phase,'extracted');}
function lootItem(game,catalogId,id='found-item') {
  assert.equal(game.teleport(-140,130),true);
  const item={...makeCatalogItem(catalogId,id),x:-140,z:129,taken:false};game.state.loot.push(item);
  assert.equal(game.interact(),true);return game.state.raid.loot.find(value=>value.id===id);
}
const ids = items => items.flatMap(item=>[item.id,...Object.values(item.attachments??{}).map(part=>part.id)]);

test('catalog has 32 receivers, 36 distinct compatible attachments, 24 equipment pieces and six fixed kits',()=>{
  assert.equal(WEAPONS.length,32);assert.equal(ATTACHMENTS.length,36);assert.equal(EQUIPMENT.length,24);assert.equal(PRESET_KITS.length,6);assert.equal(SHOP_ITEMS.length,92);
  assert.equal(new Set(SHOP_ITEMS.map(item=>item.id)).size,92);
  for(const slot of ATTACHMENT_SLOTS){const parts=ATTACHMENTS.filter(part=>part.slot===slot);assert.equal(parts.length,6);assert.equal(new Set(parts.map(part=>part.model)).size,6);}
  for(const slot of GEAR_SLOTS){const items=EQUIPMENT.filter(item=>item.slot===slot);assert.equal(items.length,6);assert.equal(new Set(items.map(item=>item.model)).size,6);}
  for(const part of ATTACHMENTS){assert.ok(part.purchaseCost>0);assert.ok(Object.keys(part.modifiers).length>0);assert.ok(WEAPONS.some(weapon=>canAttach(weapon.id,part.id)));}
  for(const kit of PRESET_KITS){const result=resolveLoadout(validateProfile({credits:10000}),{kit:kit.id});assert.equal(result.valid,true);assert.equal(result.cost,kit.cost);assert.equal(result.weapon.id,kit.weapon);for(const [slot,id]of Object.entries(kit.attachments)){assert.equal(canAttach(kit.weapon,id),true);assert.equal(getAttachment(id).slot,slot);}}
});

test('attachment tradeoffs change real magazine, reload, recoil, range, noise and ADS values without mutating the base catalog',()=>{
  const before=structuredClone(WEAPONS),base=getWeapon('AR-4');
  const built=deriveWeapon('AR-4',{optic:'optic-acog',magazine:'mag-drum',muzzle:'muzzle-suppressor',grip:'grip-vertical',stock:'stock-light',barrel:'barrel-long'});
  assert.equal(built.magSize,60);assert.ok(built.reloadSeconds>base.reloadSeconds);assert.ok(built.recoilPitch<base.recoilPitch);assert.ok(built.range>base.range);assert.equal(built.adsZoom,4);assert.ok(built.adsSeconds>base.adsSeconds);assert.equal(built.soundRadius,36*.55);assert.equal(built.noiseMultiplier,.55);
  assert.equal(canAttach('RV-6','mag-drum'),false);assert.equal(canAttach('AR-4','muzzle-choke'),false);assert.deepEqual(deriveWeapon('RV-6',{magazine:'mag-drum'}).attachments,{});
  assert.deepEqual(WEAPONS,before);
});

test('buying and mounting moves exact owned instances and validates incompatibility before changing credits or inventory',()=>{
  const profile=ownedProfile({weapon:'AR-4',attachments:['mag-extended']});const gun=profile.stash.find(item=>item.kind==='weapon'),part=gun.attachments.magazine;
  const initialIDs=ids(profile.stash),bank=profile.credits;
  assert.equal(mountAttachment(profile,gun.id,'magazine',null),true);assert.equal(profile.stash.find(item=>item.id===part.id),part);assert.equal(gun.attachments.magazine,undefined);
  assert.equal(mountAttachment(profile,gun.id,'magazine',part.id),true);assert.equal(gun.attachments.magazine,part);assert.deepEqual(ids(profile.stash).sort(),initialIDs.sort());assert.equal(profile.credits,bank);
  const wrong=purchaseEquipment(profile,'muzzle-choke',()=>`item-${profile.nextItemId++}`),before=structuredClone(profile);
  assert.equal(mountAttachment(profile,gun.id,'muzzle',wrong.id),false);assert.deepEqual(profile,before);
  assert.equal(mountAttachment(profile,gun.id,'optic',part.id),false);assert.deepEqual(profile,before);
  assert.equal(purchaseEquipment(profile,'bogus',()=> 'unused'),false);
});

test('preset selection is locked to its catalog, remembered, and free issued gear has no resale or extraction value',async t=>{
  const game=await setup(t,validateProfile({credits:0}));
  assert.equal(game.startRaid({kit:'scout',weapon:'SR-90'}),false);assert.equal(game.state.profile.raids,0);
  assert.equal(game.startRaid({kit:'scout',loadout:{mode:'preset',presetId:'scout',custom:{weapon:'forged'}},attachments:{barrel:'barrel-heavy'},cost:-900}),true);
  assert.equal(game.state.player.weapon,'VX-9');assert.deepEqual(game.state.player.attachments,{});assert.equal(game.state.player.armor,30);assert.equal(game.state.profile.credits,0);
  for(const slot of ['weapon',...GEAR_SLOTS])assert.equal(game.dropEquipment(slot),false);
  const gun=game.state.player.weaponInstance;assert.throws(()=>createItem(game.state.profile,gun));
  extract(game);assert.equal(game.state.profile.intake.length,0);assert.equal(game.state.profile.stash.length,0);assert.equal(game.state.profile.credits,0);
  game.returnToHub();assert.equal(game.startRaid(),true);assert.equal(game.state.profile.credits,0);
});

test('raid preflight charges custom consumables once and transfers every selected weapon, nested part and gear out of stash',async t=>{
  const profile=ownedProfile({weapon:'AR-4',gear:starterGear,attachments:['optic-holo','mag-extended']}),selection=structuredClone(profile.loadout);
  const quote=resolveLoadout(profile);const beforeIDs=ids(profile.stash);
  const game=await setup(t,profile,{playerId:'alice'});assert.equal(game.startRaid({loadout:selection,seed:1800}),true);
  assert.equal(game.state.profile.credits,profile.credits-quote.cost);assert.equal(game.state.profile.stash.length,0);assert.equal(game.state.player.magSize,42);
  assert.equal(game.state.player.weaponInstance.id,'r1800-alice-'+selection.custom.weapon);
  const actual=ids([game.state.player.weaponInstance,...Object.values(game.state.player.equipment)]);assert.equal(actual.length,beforeIDs.length);assert.equal(new Set(actual).size,actual.length);
  const bank=game.state.profile.credits;assert.equal(game.startRaid({loadout:selection,seed:1800}),false);assert.equal(game.state.profile.credits,bank);assert.equal(game.purchaseEquipment('AR-4'),false);assert.equal(game.mountAttachment('x','optic',null),false);
});

test('invalid, unavailable and unaffordable custom kits fail without losing owned inventory or spending money',async t=>{
  const profile=ownedProfile({weapon:'AR-4'});profile.credits=0;const game=await setup(t,profile),before=game.getSave();
  assert.equal(game.startRaid(),false);assert.deepEqual(game.getSave(),before);
  const forged=structuredClone(profile.loadout);forged.custom.weapon='item-not-owned';assert.equal(game.startRaid({loadout:forged}),false);assert.deepEqual(game.getSave(),before);
  assert.equal(game.startRaid({loadout:{mode:'invalid'}}),false);assert.deepEqual(game.getSave(),before);
  assert.equal(game.startRaid({kit:'no-kit'}),false);assert.deepEqual(game.getSave(),before);
});

test('successful extraction preserves customized ownership and worn condition once and restores selectable intake references',async t=>{
  const game=await setup(t,ownedProfile({weapon:'AR-4',gear:starterGear,attachments:['mag-extended','optic-holo']}));
  const before=ids(game.state.profile.stash).length;assert.equal(game.startRaid({seed:12}),true);game.receiveDamage(10,{x:0,z:0});
  const worn=game.state.player.equipment.plate.condition;assert.ok(worn<1);
  extract(game);assert.equal(ids(game.state.profile.intake).length,before);assert.equal(new Set(ids(game.state.profile.intake)).size,before);
  const selected=game.state.profile.intake.find(item=>item.id===game.state.profile.loadout.custom.weapon);assert.equal(selected.catalogId,'AR-4');assert.equal(selected.attachments.magazine.catalogId,'mag-extended');
  assert.equal(game.state.profile.intake.find(item=>item.catalogId==='plate-fiber').condition,worn);
  const recovered=structuredClone(game.state.profile.intake);game.endRaid();run(game,10);assert.deepEqual(game.state.profile.intake,recovered);
  game.returnToHub();assert.equal(game.startRaid(),false);storeAll(game.state.profile);assert.equal(resolveLoadout(game.state.profile).valid,true);assert.equal(game.startRaid(),true);assert.ok(game.state.player.armor<30);
});

test('death and abandonment lose carried custom equipment but never consume other stashed possessions',async t=>{
  const profile=ownedProfile({weapon:'P9-19',gear:starterGear,attachments:['grip-rubber']});const spare=purchaseEquipment(profile,'DE-50',()=>`item-${profile.nextItemId++}`);
  const game=await setup(t,profile);assert.equal(game.startRaid(),true);game.receiveDamage(10000,{x:0,z:0});assert.equal(game.state.phase,'dead');assert.equal(game.state.profile.intake.length,0);assert.deepEqual(game.state.profile.stash,[spare]);
  assert.equal(game.spillEquipment(),5);assert.equal(game.spillEquipment(),0);assert.equal(game.state.raid.loot.length,5);assert.equal(ids(game.state.raid.loot).length,6);
  game.returnToHub();assert.equal(game.state.profile.loadout.custom.weapon,null);assert.equal(game.startRaid(),false);assert.equal(game.startRaid({kit:'scout'}),true);game.pause();game.returnToHub();assert.deepEqual(game.state.profile.stash,[spare]);
});

test('two players with identical local serials obtain distinct world ownership IDs including mounted attachments',async t=>{
  const profile=ownedProfile({weapon:'AR-4',attachments:['optic-reflex']});const alice=await setup(t,profile,{playerId:'alice'}),bob=await setup(t,profile,{playerId:'bob'});
  alice.startRaid({seed:8});bob.startRaid({seed:8});const worldIDs=ids([alice.state.player.weaponInstance,bob.state.player.weaponInstance]);assert.equal(new Set(worldIDs).size,4);
});

test('backpack upgrades and reductions preserve every item and fail atomically when the new capacity cannot hold it',async t=>{
  const game=await setup(t,ownedProfile({weapon:'AR-4',gear:['pack-patrol']}));game.startRaid();assert.equal(game.state.raid.capacity,16);
  const small=lootItem(game,'pack-sling');for(let i=0;i<8;i++)game.state.raid.loot.push({id:`goods-${i}`,name:'Beute',value:10,rarity:'common'});
  const before=structuredClone(game.state.raid.loot);assert.equal(game.equipRaidItem(small.id),false);assert.deepEqual(game.state.raid.loot,before);assert.equal(game.state.raid.capacity,16);assert.equal(game.dropEquipment('backpack'),false);
  assert.equal(game.dropItem('goods-0'),true);assert.equal(game.equipRaidItem(small.id),true);assert.equal(game.state.raid.capacity,8);assert.equal(game.state.raid.loot.length,8);assert.ok(game.state.raid.loot.some(item=>item.catalogId==='pack-patrol'));
  assert.equal(game.dropEquipment('backpack'),false);for(let i=1;i<=4;i++)assert.equal(game.dropItem(`goods-${i}`),true);assert.equal(game.dropEquipment('backpack'),true);assert.equal(game.state.raid.capacity,4);
});

test('armor swaps keep damage on actual plates and require a carrier, with no equip or drop healing exploit',async t=>{
  const game=await setup(t);game.startRaid();game.receiveDamage(15,{x:0,z:0});const armor=game.state.player.armor,hp=game.state.player.hp;
  const replacement=lootItem(game,'plate-ceramic');assert.equal(game.equipRaidItem(replacement.id),true);assert.equal(game.state.player.hp,hp);assert.ok(game.state.player.armor>armor);
  const old=game.state.raid.loot.find(item=>item.catalogId==='plate-fiber');assert.ok(old.condition<1);assert.equal(game.equipRaidItem(old.id),true);assert.ok(Math.abs(game.state.player.armor-armor)<1e-8);assert.equal(game.state.player.hp,hp);
  assert.equal(game.dropEquipment('carrier'),false);assert.equal(game.dropEquipment('plate'),true);assert.equal(game.dropEquipment('carrier'),true);
  const plate=game.state.raid.loot.find(item=>item.catalogId==='plate-ceramic');assert.equal(game.equipRaidItem(plate.id),false);
});

test('weapon swapping, dropping and reclaiming preserves loaded and reserve ammunition and supports an unarmed player',async t=>{
  const game=await setup(t);game.startRaid();game.fire({x:0,y:.1,z:-1});const originalAmmo=game.state.player.ammo,originalReserve=game.state.player.reserve;
  const found=lootItem(game,'RV-6');assert.equal(game.equipRaidItem(found.id),true);assert.equal(game.state.player.ammo,6);assert.equal(game.state.player.reserve,0);
  const original=game.state.raid.loot.find(item=>item.kind==='weapon');assert.equal(game.equipRaidItem(original.id),true);assert.equal(game.state.player.ammo,originalAmmo);assert.equal(game.state.player.reserve,originalReserve);
  assert.equal(game.dropEquipment('weapon'),true);assert.equal(game.state.player.weapon,null);assert.equal(game.fire({x:0,y:0,z:-1}),false);assert.equal(game.reload(),false);
  assert.equal(game.interact(),true);const dropped=game.state.raid.loot.find(item=>item.catalogId==='AR-4');assert.equal(game.equipRaidItem(dropped.id),true);assert.equal(game.state.player.ammo,originalAmmo);assert.equal(game.state.player.reserve,originalReserve);
});

test('effective weapon stats govern simulation magazine, reload, damage, cadence and audible range',async t=>{
  const base=await setup(t,ownedProfile({weapon:'AR-4'})),custom=await setup(t,ownedProfile({weapon:'AR-4',attachments:['mag-drum','muzzle-suppressor','barrel-heavy']}));base.startRaid({seed:9});custom.startRaid({seed:9});
  assert.equal(custom.state.player.magSize,60);custom.state.player.ammo=0;assert.equal(custom.reload(),true);assert.ok(custom.state.player.reloadDuration>base.state.player.reloadDuration);run(custom,custom.state.player.reloadDuration+.1);
  const target={id:'target',x:-140,z:126,hp:1000,kind:'guard',dead:false,fireTimer:100,alert:0,pathTimer:0};
  for(const game of [base,custom]){game.teleport(-140,130);game.state.enemies=[structuredClone(target)];game.fire({x:0,y:(1.1-game.state.player.y-1.65)/4,z:-1});}
  assert.ok(custom.state.enemies[0].hp<base.state.enemies[0].hp);const shot=custom.drainEvents().find(event=>event.type==='shot');assert.equal(shot.soundRadius,19.8);assert.equal(shot.noiseMultiplier,.55);
});

test('carried gear has actual protection and speed tradeoffs rather than cosmetic-only stats',async t=>{
  const light=await setup(t,ownedProfile({weapon:'AR-4',gear:starterGear})),heavy=await setup(t,ownedProfile({weapon:'AR-4',gear:['pack-expedition','carrier-fortress','plate-boron','helmet-visor']}));
  light.startRaid();heavy.startRaid();assert.equal(light.state.raid.capacity,8);assert.equal(heavy.state.raid.capacity,24);assert.equal(heavy.state.player.maxArmor,165);assert.ok(heavy.state.player.damageReduction>light.state.player.damageReduction);
  for(const game of [light,heavy]){game.teleport(-140,130);for(let i=0;i<60;i++)game.update(1/60,{forward:1});game.receiveDamage(10,{x:0,z:0});}
  assert.ok(light.state.player.z<heavy.state.player.z);assert.ok(light.state.player.hp<heavy.state.player.hp);
});

test('all 92 usable items have logical container pools and remain additional to the 100 trade goods',()=>{
  assert.equal(NEW_ITEMS.length,100);const reachable=new Set(Object.values(EQUIPMENT_POOLS).flat().map(item=>item.id));assert.equal(reachable.size,92);
  for(const item of EQUIPMENT_POOLS.electronics)assert.equal(item.kind,'attachment');for(const item of EQUIPMENT_POOLS.medical)assert.equal(item.slot,'backpack');
  let functional=0;for(const type of CONTAINER_TYPES)for(let seed=1;seed<100;seed++)for(const item of rollContainerItems({id:type.id,type:type.id},seededRandom(seed),1)){if(item.catalogId){assert.ok(getCatalogItem(item.catalogId));assert.ok(item.value>0);functional++;}}
  assert.ok(functional>70&&functional<220);
});

test('malformed saves reject unknown catalog data, repeated nested ownership, issued items and invalid custom references',()=>{
  const profile=ownedProfile({weapon:'AR-4',gear:starterGear,attachments:['optic-holo']}),gun=profile.stash.find(item=>item.kind==='weapon'),part=gun.attachments.optic;
  profile.stash.push(structuredClone(part));gun.attachments.magazine={...part,catalogId:'mag-drum'};gun.damage=999999;gun.attachments.optic.modifiers={damage:999};
  profile.stash.push({...makeCatalogItem('AR-4','item-900'),issued:true});profile.stash.push({...makeCatalogItem('AR-4','item-901'),catalogId:'not-real'});profile.loadout.custom.helmet='item-unknown';
  const clean=validateProfile(profile),allIDs=ids(clean.stash);assert.equal(new Set(allIDs).size,allIDs.length);assert.equal(allIDs.filter(id=>id===part.id).length,1);assert.equal(clean.loadout.custom.helmet,null);assert.ok(clean.nextItemId>901);
  assert.equal(clean.stash.some(item=>item.issued||item.catalogId==='not-real'),false);assert.equal(resolveLoadout(clean).weapon.damage,getWeapon('AR-4').damage);assert.deepEqual(validateProfile(clean),clean);
  const invalid=validateProfile({loadout:{mode:'custom',custom:{weapon:'forged',medkits:999}},stash:[]});assert.equal(invalid.loadout.custom.medkits,4);assert.equal(resolveLoadout(invalid).valid,false);
});

test('customized weapon market escrow and return conserve nested parts, serials, value and selection without duplication',()=>{
  const profile=ownedProfile({weapon:'AR-4',attachments:['optic-holo','mag-drum']}),gun=profile.stash[0],nestedIDs=ids([gun]),value=gun.value;
  assert.equal(value,Math.round(getWeapon('AR-4').purchaseCost*.4)+Math.round(getAttachment('optic-holo').purchaseCost*.4)+Math.round(getAttachment('mag-drum').purchaseCost*.4));
  assert.equal(listItem(profile,gun.id,100000,2,1_000_000),true);assert.equal(profile.loadout.custom.weapon,null);assert.equal(profile.stash.length,0);assert.equal(cancelListing(profile,profile.listings[0].id,1_000_001),true);
  const saved=validateProfile(profile);assert.equal(claimAll(saved),true);assert.deepEqual(ids(saved.stash),nestedIDs);assert.equal(saved.stash[0].value,value);assert.equal(claimAll(saved),false);
});

test('hub equipment actions remain locked while connected or in raid and preparing a custom kit does not alter the selected preset',async t=>{
  const profile=ownedProfile({weapon:'AR-4'});profile.loadout.mode='preset';profile.loadout.presetId='assault';
  const game=await setup(t,profile),gun=game.state.profile.stash[0];assert.equal(game.equipLoadout('weapon',gun.id),true);assert.equal(game.state.profile.loadout.mode,'preset');assert.equal(game.equipLoadout('medkits',4),true);assert.equal(game.equipLoadout('medkits',5),false);
  assert.equal(resolveLoadout(game.state.profile).weapon.id,'AR-4');assert.equal(normalizeSelection(game.state.profile,{kit:'scout'}).presetId,'scout');
  const locked=await setup(t,profile,{loadoutLocked:true});const before=locked.getSave();assert.equal(locked.selectLoadout({mode:'custom'}),false);assert.equal(locked.purchaseEquipment('optic-holo'),false);assert.equal(locked.equipLoadout('weapon',null),false);assert.deepEqual(locked.getSave(),before);
});
