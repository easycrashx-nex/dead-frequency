import {_electron} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CONTAINER_TYPES,NEW_ITEMS,ITEM_CATALOG} from '../src/loot-catalog.js';

const version=JSON.parse(await fs.readFile('package.json','utf8')).version;
const exe=process.env.DF_EXE||path.resolve(`../../outputs/v${version}/DEAD FREQUENCY-win32-x64/DEAD FREQUENCY.exe`);
const out=path.resolve(`../qa-containers-native-${version}`);await fs.mkdir(out,{recursive:true});
const profile=await fs.mkdtemp(path.join(out,'profile-'));
const checks=[],errors=[],measurements=[];let app,page;
const pass=name=>{checks.push(name);console.log('PASS',name);};
async function approach(container){
  const result=await page.evaluate(c=>{
    for(const [dx,dz] of [[0,c.d/2+.9],[0,-c.d/2-.9],[c.w/2+.9,0],[-c.w/2-.9,0]]){
      if(!__DF.game.teleport(c.x+dx,c.z+dz))continue;
      __DF.state.player.yaw=Math.atan2(dx,dz);__DF.state.player.pitch=-.38;__DF.syncLook();__DF.step(.05);
      if(__DF.state.prompt?.id===c.id)return true;
    }return false;
  },container);
  assert.equal(result,true,`Reachable container ${container.id}`);
}
async function close(){await page.keyboard.press('Escape');await page.waitForFunction(()=>!__DF.state.activeContainerId&&document.pointerLockElement&&__DF.state.phase==='raid');}
try{
  app=await _electron.launch({executablePath:exe,args:['--qa'],env:{...process.env,DEAD_FREQUENCY_QA_PROFILE:profile},timeout:45000});
  page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.waitForFunction(()=>window.__DF&&document.documentElement.dataset.ready==='true',null,{timeout:60000});
  assert.equal(await app.evaluate(({app})=>app.getVersion()),version);
  assert.equal(CONTAINER_TYPES.length,7);assert.equal(NEW_ITEMS.length,100);assert.equal(ITEM_CATALOG.length,109);
  assert.equal(new Set(NEW_ITEMS.map(item=>item.name)).size,100);pass('Exactly seven container types and 100 distinct new trade items, with nine legacy items retained');
  await page.locator('#start-raid').click();await page.waitForFunction(()=>__DF.state.phase==='raid'&&document.pointerLockElement);
  await page.evaluate(()=>{__DF.state.enemies=[];});
  const containers=await page.evaluate(()=>__DF.state.containers);
  assert.equal(await page.evaluate(()=>__DF.state.loot.length),0);assert.equal(new Set(containers.map(c=>c.type)).size,7);
  pass('The packaged raid starts with seven placed container types and no scattered static ground items');
  const interiors=await page.evaluate(()=>__DF.game.layout.interiors);
  assert.ok(interiors.every(room=>containers.some(c=>Math.abs(c.x-room.x)<room.w/2&&Math.abs(c.z-room.z)<room.d/2)));
  pass('All five accessible buildings contain searchable supplies');
  for(const type of CONTAINER_TYPES){
    const container=containers.find(c=>c.type===type.id);assert.ok(container);
    await approach(container);await page.waitForTimeout(180);await page.screenshot({path:path.join(out,`${type.id}-closed.png`)});
    const initialIds=container.items.map(item=>item.id);
    await page.keyboard.press('KeyE');await page.locator('[data-panel="container"]').waitFor();
    assert.equal(await page.evaluate(()=>document.pointerLockElement),null);assert.equal(await page.evaluate(()=>__DF.state.phase),'raid');
    assert.ok(await page.evaluate(()=>__DF.state.containerSearchRemaining>0));
    const before=await page.evaluate(()=>({x:__DF.state.player.x,z:__DF.state.player.z,ammo:__DF.state.player.ammo,time:__DF.state.raid.timeLeft}));
    await page.keyboard.down('KeyW');await page.waitForTimeout(180);await page.keyboard.up('KeyW');
    const blocked=await page.evaluate(()=>({x:__DF.state.player.x,z:__DF.state.player.z,ammo:__DF.state.player.ammo,time:__DF.state.raid.timeLeft}));
    assert.ok(Math.hypot(blocked.x-before.x,blocked.z-before.z)<.02);assert.ok(blocked.time<before.time);assert.equal(blocked.ammo,before.ammo);
    await page.waitForFunction(id=>__DF.state.containers.find(c=>c.id===id).searched,container.id);
    const trade=container.items.find(item=>!item.kind);assert.ok(trade);
    await page.locator(`[data-take-container-item="${trade.id}"]`).click();
    await page.waitForFunction(id=>__DF.state.raid.loot.some(item=>item.id===id),trade.id);
    await page.locator(`[data-take-container-item="${trade.id}"]`).waitFor({state:'detached'});
    await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.querySelector('[data-panel="container"]').contains(document.activeElement)),true);
    await page.screenshot({path:path.join(out,`${type.id}-searched.png`)});
    await close();await page.keyboard.press('KeyE');await page.locator('[data-panel="container"]').waitFor();
    assert.equal(await page.evaluate(()=>__DF.state.containerSearchRemaining),0);
    assert.deepEqual(await page.evaluate(id=>__DF.state.containers.find(c=>c.id===id).items.map(item=>item.id),container.id),initialIds);
    assert.equal(await page.locator(`[data-take-container-item="${trade.id}"]`).count(),0);
    await close();pass(`${type.name}: keyboard opening, timed search, take, focused controls and persistent content after reopening`);
  }
  const current=await page.evaluate(()=>__DF.state.containers.find(c=>c.id===__DF.state.prompt?.id));assert.ok(current);
  await page.keyboard.press('KeyE');await page.locator('[data-panel="container"]').waitFor();
  await page.locator('[data-action="take-all-container"]').click();
  await page.waitForFunction(()=>__DF.state.raid.loot.length===__DF.state.raid.capacity);
  pass('Take all fills only the available backpack capacity');
  const dropId=await page.evaluate(()=>__DF.state.raid.loot[0].id);
  await page.locator(`[data-panel="container"] [data-drop-item="${dropId}"]`).click();
  await page.waitForFunction(id=>__DF.state.loot.some(item=>item.id===id&&!item.taken),dropId);
  const next=await page.evaluate(()=>__DF.state.containers.find(c=>c.id===__DF.state.activeContainerId).items.find(item=>!item.kind&&!item.taken));assert.ok(next);
  await page.locator(`[data-take-container-item="${next.id}"]`).click();await page.waitForFunction(id=>__DF.state.raid.loot.some(item=>item.id===id),next.id);
  assert.equal(await page.evaluate(id=>__DF.state.raid.loot.some(item=>item.id===id),dropId),false);
  pass('Backpack items can be discarded inside the crate panel and immediately replaced with another find');
  await close();
  // Carry the new item through the real extraction and existing home interface.
  await page.evaluate(()=>{__DF.game.teleport(-47,46);__DF.syncLook();});await page.waitForFunction(()=>__DF.state.prompt?.kind==='extract');
  await page.keyboard.press('KeyE');await page.waitForFunction(()=>__DF.state.phase==='extracted',null,{timeout:15000});
  const intake=await page.evaluate(()=>__DF.state.profile.intake);assert.ok(intake.some(item=>item.name===next.name));
  await page.locator('#result-hub').click();await page.locator('#tab-storage').click();await page.locator('#store-all').click();
  await page.waitForFunction(()=>__DF.state.profile.intake.length===0&&__DF.state.profile.stash.length>0);
  const stored=await page.evaluate(name=>__DF.state.profile.stash.find(item=>item.name===name),next.name);assert.ok(stored);
  await page.locator('#tab-market').click();await page.locator('#market-item').selectOption(stored.id);await page.locator('#market-price').fill('1000000');await page.locator('#market-duration').selectOption('2');await page.locator('#create-listing').click();
  await page.waitForFunction(()=>__DF.state.profile.listings.length===1);
  await page.locator('[data-cancel-listing]').click();
  await page.locator('#tab-mailbox').click();await page.locator('#claim-all').click();
  await page.waitForFunction(name=>__DF.state.profile.stash.some(item=>item.name===name),stored.name);
  pass('A new crate item extracts into intake, stores, lists on the market, returns through the mailbox after cancellation and can be reclaimed');
  await page.screenshot({path:path.join(out,'mailbox-return.png')});
  await page.reload();await page.waitForFunction(()=>window.__DF&&document.documentElement.dataset.ready==='true');
  assert.ok(await page.evaluate(name=>__DF.state.profile.stash.some(item=>item.name===name),stored.name));
  pass('The reclaimed new item survives reloading the packaged game');
  assert.deepEqual(errors,[]);pass('No JavaScript or renderer errors in the packaged crate and economy flow');
  const appAsarSha256=createHash('sha256').update(await fs.readFile(path.join(path.dirname(exe),'resources/app.asar'))).digest('hex');
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,exe,version,appAsarSha256,checks,errors,containerCount:containers.length,containerTypes:CONTAINER_TYPES.map(({id,name})=>({id,name})),newItemCount:NEW_ITEMS.length,totalTradeItemCount:ITEM_CATALOG.length,measurements},null,2));
}catch(error){await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,exe,version,checks,errors,failure:error.stack},null,2));throw error;}
finally{await app?.close().catch(()=>{});}
