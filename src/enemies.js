import { ITEM_POOLS } from './loot-catalog.js';
import { SHOP_ITEMS, makeCatalogItem, ATTACHMENTS } from './loadouts.js';
import { ECONOMY_BALANCE } from './economy.js';

export const ENEMY_TYPES = {
  guard: { name:'Sektorwache',hp:145,armor:20,damage:13,interval:.92,xp:50,searchSeconds:2.2,pool:'provisions' },
  elite: { name:'Veteran',hp:210,armor:45,damage:18,interval:.65,xp:100,searchSeconds:2.5,pool:'security' },
  bodyguard: { name:'Leibwache',hp:240,armor:60,damage:18,interval:.72,xp:125,searchSeconds:2.8,pool:'ammo' },
  boss: { name:'Kommandant Voss',hp:650,armor:140,damage:22,interval:.88,xp:350,searchSeconds:4,pool:'security' },
};
export const ENEMY_SPAWNING = Object.freeze({initialPatrols:54,maxAlive:72,interval:150,waveSize:6,maxReinforcements:72,minPlayerDistance:85,visibilityDistance:360,corpseLimit:120});
const pick = (list,random) => list[Math.min(list.length-1,Math.floor(random()*list.length))];
export function rollCorpseItems(enemy,random) {
  const type=ENEMY_TYPES[enemy.kind]??ENEMY_TYPES.guard, prefix=`corpse-${enemy.id}`,items=[];
  const tradePool=[...ITEM_POOLS[type.pool]], count=enemy.kind==='boss'?3:1+Math.floor(random()*2);
  for(let i=0;i<count&&tradePool.length;i++){
    const selected=pick(tradePool,random);tradePool.splice(tradePool.indexOf(selected),1);
    items.push({id:`${prefix}-goods-${i}`,name:selected.name,value:Math.round(selected.value*ECONOMY_BALANCE.lootValueMultiplier),rarity:selected.rarity,taken:false});
  }
  items.push({id:`${prefix}-ammo`,name:'Geborgene Munition · +18',kind:'ammo',amount:18,value:0,rarity:'common',taken:false});
  if(random()<(enemy.kind==='guard'?.12:.4))items.push({id:`${prefix}-medkit`,name:'Feld-Medkit · +1',kind:'medkit',amount:1,value:0,rarity:'rare',taken:false});
  const grade=enemy.kind==='boss'?3:enemy.kind==='bodyguard'?2:enemy.kind==='elite'?1:0;
  if(random()<[.07,.18,.28,1][grade]){
    const weapons=SHOP_ITEMS.filter(item=>item.kind==='weapon'&&(grade===3?item.purchaseCost>=2500:grade>0?item.purchaseCost>=1300&&item.purchaseCost<=4200:item.purchaseCost<=2300));
    items.push({...makeCatalogItem(pick(weapons,random).id,`${prefix}-weapon`),taken:false});
  }
  if(random()<[.12,.28,.4,.8][grade]){
    const parts=ATTACHMENTS.filter(item=>grade===3?item.purchaseCost>=500:grade>0?item.purchaseCost>=250:true);
    items.push({...makeCatalogItem(pick(parts,random).id,`${prefix}-part`),taken:false});
  }
  if(random()<[.07,.18,.3,.65][grade]){
    const gear=SHOP_ITEMS.filter(item=>item.kind==='equipment'&&(grade===3?item.purchaseCost>=1250:grade>0?item.purchaseCost>=450&&item.purchaseCost<=2100:item.purchaseCost<=650));
    items.push({...makeCatalogItem(pick(gear,random).id,`${prefix}-gear`,{condition:.45+random()*.45}),taken:false});
  }
  return items;
}
