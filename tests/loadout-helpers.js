import assert from 'node:assert/strict';
import { validateProfile } from '../src/simulation.js';
import { normalizeSelection, purchaseEquipment, equipLoadout, mountAttachment, getEquipment, getAttachment } from '../src/loadouts.js';

// Build fixtures through the same catalog purchase/equip/mount operations as the
// hub. Credits are explicit test funding, never invented item stats or ownership.
export function ownedProfile({weapon='RV-6',gear=[],attachments=[],credits=25_000,medkits=2,...saved}={}) {
  const profile=validateProfile({...saved,credits});
  profile.loadout=normalizeSelection(profile,{mode:'custom'});
  const buy=id=>{
    const item=purchaseEquipment(profile,id,()=>`item-${profile.nextItemId++}`);
    assert.ok(item,`Fixture could not purchase ${id}`);return item;
  };
  const rifle=buy(weapon);assert.equal(equipLoadout(profile,'weapon',rifle.id),true);
  for(const id of gear){const item=buy(id);assert.equal(equipLoadout(profile,getEquipment(id).slot,item.id),true);}
  for(const id of attachments){const item=buy(id);assert.equal(mountAttachment(profile,rifle.id,getAttachment(id).slot,item.id),true);}
  assert.equal(equipLoadout(profile,'medkits',medkits),true);
  return profile;
}
