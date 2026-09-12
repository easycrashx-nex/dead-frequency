import {_electron} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {WEAPONS,getWeapon} from '../src/weapons.js';
import {ATTACHMENTS,EQUIPMENT,PRESET_KITS,getCatalogItem,getAttachment,deriveWeapon} from '../src/loadouts.js';
import {EXTRACTIONS} from '../src/layout.js';

const version=JSON.parse(await fs.readFile('package.json','utf8')).version;
const exe=process.env.DF_EXE||path.resolve(`../../outputs/v${version}/DEAD FREQUENCY-win32-x64/DEAD FREQUENCY.exe`);
const out=path.resolve(`../qa-loadouts-native-${version}`);await fs.mkdir(out,{recursive:true});
const profile=await fs.mkdtemp(path.join(out,'profile-'));
const checks=[],errors=[],measurements={};let app,page;
const pass=name=>{checks.push(name);console.log('PASS',name);};
const ready=()=>page.waitForFunction(()=>window.__DF&&document.documentElement.dataset.ready==='true',null,{timeout:60000});
const snapshot=name=>page.screenshot({path:path.join(out,`${name}.png`)});
const profileState=()=>page.evaluate(()=>structuredClone(__DF.state.profile));
async function arsenal(tab){await page.locator('#tab-arsenal').click();await page.locator(`.armory-tabs [data-armory-tab="${tab}"]`).click();}
async function buy(id){
  await arsenal('shop');await page.locator('#shop-kind').selectOption(getCatalogItem(id).kind);await page.locator('#shop-category').selectOption('all');await page.locator('#shop-search').fill(getCatalogItem(id).name);
  await page.locator(`[data-shop-item="${id}"]`).click();const before=await profileState();
  await page.locator('#purchase-equipment').click();
  await page.waitForFunction(({id,count})=>__DF.state.profile.stash.filter(item=>item.catalogId===id).length===count+1,{id,count:before.stash.filter(item=>item.catalogId===id).length});
  const after=await profileState();assert.equal(after.credits,before.credits-getCatalogItem(id).purchaseCost);
  return after.stash.filter(item=>item.catalogId===id).at(-1).id;
}
async function mount(weaponId,partId){
  await arsenal('editor');await page.locator('#editor-weapon').selectOption(weaponId);
  await page.locator(`[data-attachment-slot="${getAttachment(partId).slot}"]`).click();
  const profile=await profileState(),item=profile.stash.find(item=>item.catalogId===partId);assert.ok(item);
  await page.locator('#editor-attachment').selectOption(item.id);await page.locator('#mount-attachment').click();
  await page.waitForFunction(({weaponId,slot,partId})=>__DF.state.profile.stash.find(item=>item.id===weaponId)?.attachments?.[slot]?.catalogId===partId,{weaponId,slot:getAttachment(partId).slot,partId});
}
async function resume(){
  if(await page.evaluate(()=>__DF.state.phase==='paused'))await page.locator('#resume-raid').click();
  if(!await page.evaluate(()=>!!document.pointerLockElement))await page.locator('#game').click();
  await page.waitForFunction(()=>__DF.state.phase==='raid'&&document.pointerLockElement);
}

try{
  app=await _electron.launch({executablePath:exe,args:['--qa'],env:{...process.env,DEAD_FREQUENCY_QA_PROFILE:profile},timeout:45000});
  page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await ready();assert.equal(await app.evaluate(({app})=>app.getVersion()),version);
  await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.setFullScreen(false);window.unmaximize();window.setSize(1440,900);window.show();window.focus();});
  await page.evaluate(()=>{
    __DF.settingsChanged({volume:0,quality:'high',fpsLimit:60,autoReload:false,fullscreen:false});
    Object.assign(__DF.state.profile,{credits:100000,raids:8,extracts:3,upgrades:{armor:2,backpack:1,weapon:2}});
    delete __DF.state.profile.progression;delete __DF.state.profile.loadout;__DF.persist();
  });
  await page.reload();await ready();const migrated=await profileState();
  assert.equal(migrated.credits,100000);assert.equal(migrated.loadout.mode,'preset');
  for(const id of ['armor-1','armor-2','backpack-1','weapon-1','weapon-2'])assert.ok(migrated.progression.unlocked.includes(id));
  pass('An isolated legacy Windows save retains credits and learned upgrades and receives a usable fixed starting kit');
  assert.equal(WEAPONS.length,32);assert.equal(ATTACHMENTS.length,36);assert.equal(EQUIPMENT.length,24);assert.equal(PRESET_KITS.length,6);
  await arsenal('kits');assert.equal(await page.locator('[data-preset-kit]').count(),6);
  await page.locator('[data-preset-kit="assault"]').click();
  const kitBefore=await profileState();
  assert.equal(await page.evaluate(()=>__DF.game.startRaid({loadout:__DF.state.profile.loadout,weapon:'SR-90'})),false);
  assert.equal((await profileState()).credits,kitBefore.credits);
  await page.locator('#tab-deploy').click();await page.locator('#start-raid').click();await page.waitForFunction(()=>__DF.state.phase==='raid');
  assert.equal((await profileState()).credits,kitBefore.credits-350);
  assert.equal(await page.evaluate(()=>__DF.state.player.weapon),'AR-4');
  assert.equal(await page.evaluate(()=>__DF.game.dropEquipment('weapon')),false);
  await page.evaluate(()=>{__DF.state.enemies=[];__DF.game.endRaid('QA fixed kit complete');});
  await page.waitForFunction(()=>__DF.state.phase==='dead');await page.locator('#result-hub').click();
  assert.equal((await profileState()).stash.length,0);assert.equal((await profileState()).intake.length,0);
  pass('The real UI purchases a fixed kit once; overrides and issued-item resale/drop farming are rejected');

  const weapon='AK-74',parts=['optic-acog','mag-drum','muzzle-suppressor','grip-vertical','stock-heavy','barrel-long'];
  const gear=['pack-patrol','carrier-assault','plate-ceramic','helmet-ballistic'];
  const owned={weapon:await buy(weapon)};
  for(const id of [...parts,...gear])owned[id]=await buy(id);
  for(const id of parts)await mount(owned.weapon,id);
  await snapshot('01-weapon-editor');
  const fitted=(await profileState()).stash.find(item=>item.id===owned.weapon);
  assert.equal(Object.keys(fitted.attachments).length,6);
  assert.equal((await profileState()).stash.filter(item=>item.kind==='attachment').length,0);
  const expected=deriveWeapon(weapon,fitted.attachments);measurements.assembledStats=expected;
  assert.equal(expected.magSize,getWeapon(weapon).magSize*2);assert.ok(expected.recoilPitch<getWeapon(weapon).recoilPitch);assert.ok(expected.reloadSeconds>getWeapon(weapon).reloadSeconds);
  await page.locator('[data-attachment-slot="magazine"]').click();await page.locator('#unmount-attachment').click();
  const removed=(await profileState()).stash.find(item=>item.catalogId==='mag-drum');assert.equal(removed.id,owned['mag-drum']);
  await mount(owned.weapon,'mag-drum');
  pass('Native shop purchases and six editor mounts change owned instances; unmount/remount preserves the same attachment without duplication');
  await arsenal('loadout');
  await page.locator('[data-equip-slot="weapon"]').selectOption(owned.weapon);
  for(const id of gear)await page.locator(`[data-equip-slot="${getCatalogItem(id).slot}"]`).selectOption(owned[id]);
  await page.locator('#custom-medkits').selectOption('3');await page.locator('#use-custom-loadout').click();
  await page.waitForFunction(()=>__DF.state.profile.loadout.mode==='custom');await snapshot('02-custom-loadout');
  const prepared=await profileState();await page.evaluate(()=>__DF.persist());await page.reload();await ready();
  assert.deepEqual((await profileState()).loadout,prepared.loadout);assert.deepEqual((await profileState()).stash,prepared.stash);
  pass('The equipped custom weapon, mounted parts, four gear slots and supply selection survive native restart');

  // Deterministic crate contents and safe positioning are explicit QA fixtures;
  // the actual deployment button, purchasing, combat and inventory paths run.
  await page.evaluate(()=>{const start=__DF.game.startRaid;__DF.game.startRaid=options=>{__DF.game.startRaid=start;return start({...options,seed:110111});};});
  await page.locator('#start-raid').click();await page.waitForFunction(()=>__DF.state.phase==='raid');
  await page.evaluate(()=>{__DF.state.enemies=[];__DF.teleport(-142,135);__DF.syncLook();});
  const player=await page.evaluate(()=>structuredClone(__DF.state.player));
  assert.equal(player.weapon,weapon);assert.equal(player.magSize,60);assert.deepEqual(player.attachments,expected.attachments);
  assert.ok(Math.abs(player.weaponStats.recoilPitch-expected.recoilPitch)<1e-12);
  assert.equal((await profileState()).credits,prepared.credits-getWeapon(weapon).ammoCost-75);
  assert.equal((await profileState()).stash.filter(item=>Object.values(owned).includes(item.id)).length,0);
  assert.equal(player.equipment.backpack.catalogId,'pack-patrol');assert.ok(await page.evaluate(()=>__DF.state.raid.capacity>=16));
  await page.waitForTimeout(250);const rendered=await page.evaluate(()=>__DF.stats());measurements.rendered=rendered;
  assert.equal(rendered.actualWeaponId,weapon);assert.deepEqual(rendered.weaponAttachments,expected.attachments);
  pass('The paid custom deployment consumes supplies once, transfers ownership and renders the authoritative six-part build with its real magazine and recoil stats');
  await resume();const beforeAmmo=await page.evaluate(()=>__DF.state.player.ammo);
  await page.mouse.down();await page.waitForTimeout(230);await page.mouse.up();
  assert.ok(await page.evaluate(ammo=>__DF.state.player.ammo<ammo,beforeAmmo));
  await page.keyboard.press('KeyR');await page.waitForFunction(()=>__DF.state.player.reload>0);
  const duration=await page.evaluate(()=>__DF.state.player.reloadDuration);assert.ok(duration>getWeapon(weapon).reloadSeconds*.85);
  await page.waitForFunction(()=>__DF.state.player.reload===0,null,{timeout:10000});assert.equal(await page.evaluate(()=>__DF.state.player.ammo),60);
  await page.mouse.down({button:'right'});await page.waitForTimeout(1600);
  const aiming=await page.evaluate(()=>__DF.stats());assert.equal(aiming.adsZoom,4);assert.ok(Math.abs(aiming.fov-aiming.adsTargetFov)<2);await snapshot('03-assembled-ads');await page.mouse.up({button:'right'});
  pass('Real mouse firing, enlarged-magazine reload and the mounted 4x optic work in the Windows raid');

  const crate=await page.evaluate(()=>{const c=__DF.state.containers.find(c=>c.id==='arrival-medical');__DF.teleport(c.x,c.z+c.d/2+.9);return structuredClone(c);});
  const pack=crate.items.find(item=>item.catalogId==='pack-sling');assert.ok(pack);
  await page.keyboard.press('KeyE');await page.waitForFunction(()=>__DF.state.containers.find(c=>c.id==='arrival-medical').searched);
  await page.locator(`[data-take-container-item="${pack.id}"]`).click();
  await page.waitForFunction(id=>__DF.state.raid.loot.some(item=>item.id===id),pack.id);
  await page.locator(`#container-backpack-list [data-equip-raid-item="${pack.id}"]`).click();
  await page.waitForFunction(()=>__DF.state.player.equipment.backpack.catalogId==='pack-sling');
  assert.ok(await page.evaluate(()=>__DF.state.raid.loot.some(item=>item.catalogId==='pack-patrol')));
  await snapshot('04-raid-equipment');
  await page.keyboard.press('Escape');await page.locator('#container-panel').waitFor({state:'hidden'});await resume();
  await page.evaluate(()=>__DF.game.receiveDamage(90,{x:__DF.state.player.x,z:__DF.state.player.z-4}));
  const plateCondition=await page.evaluate(()=>__DF.state.player.equipment.plate.condition);assert.ok(plateCondition<1&&plateCondition>0);
  pass('A real searched crate supplies a usable backpack; swapping retains the previous owned pack and incoming damage wears the equipped protection');

  await page.keyboard.press('Tab');await page.locator('#inventory-panel [data-drop-equipment="weapon"]').click();
  await page.waitForFunction(()=>__DF.state.player.weapon===null);await page.keyboard.press('Tab');
  await page.waitForTimeout(200);assert.equal((await page.evaluate(()=>__DF.stats())).actualWeaponId,null);
  const ground=await page.evaluate(()=>{const item=__DF.state.loot.find(item=>item.kind==='weapon'&&!item.taken);__DF.teleport(item.x,item.z);return item.id;});
  await resume();await page.keyboard.press('KeyE');await page.waitForFunction(id=>__DF.state.raid.loot.some(item=>item.id===id),ground);
  await page.keyboard.press('Tab');await page.locator(`#inventory-panel [data-equip-raid-item="${ground}"]`).click();await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>__DF.state.player.weapon),weapon);assert.equal(await page.evaluate(()=>__DF.state.player.ammo),60);
  pass('Dropping the owned weapon makes the player visibly unarmed; picking up and equipping the same build preserves its magazine and parts');

  await resume();await page.evaluate(exit=>__DF.teleport(exit.x,exit.z),EXTRACTIONS[0]);await page.keyboard.press('KeyE');
  await page.waitForFunction(()=>__DF.state.phase==='extracted',null,{timeout:16000});
  const recovered=await profileState();assert.equal(recovered.intake.filter(item=>item.kind==='weapon').length,1);
  assert.equal(Object.keys(recovered.intake.find(item=>item.kind==='weapon').attachments).length,6);
  assert.equal(recovered.intake.find(item=>item.catalogId==='plate-ceramic').condition,plateCondition);
  await page.locator('#result-hub').click();await page.locator('#store-all').click();
  const secured=await profileState();assert.equal(secured.intake.length,0);assert.ok(secured.stash.some(item=>item.id===secured.loadout.custom.weapon));
  await page.evaluate(()=>__DF.persist());await page.reload();await ready();
  assert.deepEqual((await profileState()).stash,secured.stash);assert.deepEqual((await profileState()).loadout,secured.loadout);
  pass('Extraction, manual storage and restart preserve the complete weapon build, both backpacks, protection wear and the selected custom loadout');

  await page.locator('#tab-deploy').click();await page.locator('#start-raid').click();await page.waitForFunction(()=>__DF.state.phase==='raid');
  await page.evaluate(()=>{__DF.state.enemies=[];__DF.game.endRaid('QA equipment loss');});await page.waitForFunction(()=>__DF.state.phase==='dead');
  assert.equal((await profileState()).stash.filter(item=>item.kind==='weapon').length,0);
  assert.ok((await profileState()).stash.some(item=>item.catalogId==='pack-patrol'),'Unequipped secured possessions survive a later death');
  await page.locator('#result-hub').click();await arsenal('kits');await page.locator('[data-preset-kit="scout"]').click();
  await page.locator('#tab-deploy').click();await page.locator('#start-raid').click();await page.waitForFunction(()=>__DF.state.phase==='raid');
  assert.equal(await page.evaluate(()=>__DF.state.player.weapon),'VX-9');
  pass('A later failed custom raid loses only carried equipment; secured stash survives and the free recovery kit remains playable');
  assert.deepEqual(errors,[]);pass('No JavaScript or renderer errors in the native loadout lifecycle');
  const appAsarSha256=createHash('sha256').update(await fs.readFile(path.join(path.dirname(exe),'resources/app.asar'))).digest('hex');
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,exe,version,appAsarSha256,checks,errors,catalog:{weapons:WEAPONS.length,attachments:ATTACHMENTS.length,equipment:EQUIPMENT.length,presets:PRESET_KITS.length},measurements},null,2));
}catch(error){await snapshot('failure').catch(()=>{});await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,exe,version,checks,errors,failure:error.stack,measurements},null,2));throw error;}
finally{await app?.close().catch(()=>{});}
