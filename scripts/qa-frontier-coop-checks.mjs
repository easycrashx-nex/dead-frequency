import assert from 'node:assert/strict';
import path from 'node:path';

export async function checkFrontierCoop({host,guest,out,pass}) {
  const corpse=await host.app.evaluate(()=>{
    const session=global.__DF_HOST(),members=[...session.players.values()];
    const corpse=members[0].game.state.containers.find(c=>c.enemyId==='qa-guard');
    if(!corpse)throw Error('The shot enemy did not create its corpse');
    for(const member of members)member.game.teleport(corpse.x,corpse.z+1.4,corpse.y);
    return corpse;
  });
  assert.equal(corpse.kind,'corpse');
  await Promise.all([host,guest].map(({page})=>page.waitForFunction(corpse=>{
    const p=__DF.state.player;
    return __DF.state.prompt?.kind==='container'&&__DF.state.prompt.id===corpse.id&&Math.hypot(p.x-corpse.x,p.z-corpse.z-1.4)<.25;
  },corpse,{timeout:15000})));
  await Promise.all([host.page.evaluate(()=>__DF.game.interact()),guest.page.evaluate(()=>__DF.game.interact())]);
  for(const {page} of [host,guest])await page.waitForFunction(id=>__DF.state.activeContainerId===id&&__DF.state.containers.find(c=>c.id===id)?.searched,corpse.id);
  const ammo=corpse.items.find(item=>item.kind==='ammo');assert.ok(ammo);
  const reserves=await host.app.evaluate(()=>[...global.__DF_HOST().players.values()].reduce((sum,m)=>sum+m.game.state.player.reserve,0));
  await Promise.all([host.page.evaluate(({id,item})=>__DF.game.takeContainerItem(id,item),{id:corpse.id,item:ammo.id}),guest.page.evaluate(({id,item})=>__DF.game.takeContainerItem(id,item),{id:corpse.id,item:ammo.id})]);
  await Promise.all([host,guest].map(({page})=>page.waitForFunction(({id,item})=>__DF.state.containers.find(c=>c.id===id)?.items.find(i=>i.id===item)?.taken,{id:corpse.id,item:ammo.id},{timeout:15000})));
  assert.equal(await host.app.evaluate(()=>[...global.__DF_HOST().players.values()].reduce((sum,m)=>sum+m.game.state.player.reserve,0)),reserves+18);
  for(const {page} of [host,guest])assert.ok(await page.evaluate(({id,item})=>__DF.state.containers.find(c=>c.id===id).items.find(i=>i.id===item).taken,{id:corpse.id,item:ammo.id}));
  pass('A real killed bot becomes a shared searchable corpse; simultaneous Internet claims grant its ammunition exactly once');
  await Promise.all([host.page.evaluate(()=>__DF.game.closeContainer()),guest.page.evaluate(()=>__DF.game.closeContainer())]);
  const medkits=await host.app.evaluate(()=>{
    const members=[...global.__DF_HOST().players.values()];members[0].game.teleport(-142,130);members[1].game.teleport(-141,130);
    members[1].game.receiveDamage(1000,{x:-140,z:130});return members[0].game.state.player.medkits;
  });
  assert.ok(medkits>0);
  for(const [client,self] of [[host,false],[guest,true]])await client.page.waitForFunction(self=>self?__DF.state.player.downed:__DF.state.teammates[0].downed,self);
  assert.equal(await guest.page.evaluate(()=>__DF.state.phase==='dead'),false);
  // Closing the crate can open the local pause screen. Show the actual downed
  // view while the neutral controller remains selected, before focusing the helper.
  await guest.page.bringToFront();await guest.page.evaluate(()=>__DF.resume());
  await guest.page.waitForFunction(()=>__DF.state.phase==='raid'&&__DF.state.player.downed);
  await guest.page.screenshot({path:path.join(out,'05-downed-partner.png')});
  await host.page.bringToFront();await host.page.evaluate(()=>__DF.resume());await host.page.locator('#game').click().catch(()=>{});await host.page.waitForFunction(()=>document.pointerLockElement);
  await host.page.keyboard.down('KeyE');
  try{await host.page.waitForFunction(()=>__DF.state.player.reviveProgress>.6,null,{timeout:5000});}
  finally{await host.page.keyboard.up('KeyE');}
  await host.page.waitForFunction(()=>__DF.state.player.reviveProgress===0);
  assert.equal(await host.page.evaluate(()=>__DF.state.player.medkits),medkits);
  assert.equal(await guest.page.evaluate(()=>__DF.state.player.downed),true);
  pass('The colleague remains downed with their loadout; releasing the real revive key interrupts progress without spending medicine');
  await host.page.keyboard.down('KeyE');
  try{
    await host.page.waitForFunction(()=>__DF.state.player.reviveProgress>2,null,{timeout:5000});
    await host.page.screenshot({path:path.join(out,'06-held-revive.png')});
    await guest.page.waitForFunction(()=>!__DF.state.player.downed&&__DF.state.player.hp===35,null,{timeout:12000});
  }finally{await host.page.keyboard.up('KeyE');}
  await host.page.waitForFunction(()=>!__DF.state.teammates[0].downed);
  assert.equal(await host.page.evaluate(()=>__DF.state.player.medkits),medkits-1);
  assert.equal(await guest.page.evaluate(()=>__DF.state.player.weapon),'DMR-7');
  pass('Holding the real interact key completes a six-second authoritative Internet revive at 35 HP and consumes exactly one helper medkit');
  await guest.page.bringToFront();await guest.page.evaluate(()=>__DF.resume());await guest.page.locator('#game').click().catch(()=>{});await guest.page.waitForFunction(()=>document.pointerLockElement);
}
