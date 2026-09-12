import {chromium,_electron} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const native=!!process.env.DF_EXE;
const out=path.resolve(`../qa-expansion-${native?'native':'browser'}`);await fs.mkdir(out,{recursive:true});
const checks=[],errors=[];const pass=name=>{checks.push(name);console.log('PASS',name);};
let browser,app,page;
const snap=()=>page.evaluate(()=>JSON.parse(JSON.stringify(window.__DF.state)));
try{
  if(native){
    const profile=await fs.mkdtemp(path.join(out,'profile-'));
    app=await _electron.launch({executablePath:process.env.DF_EXE,args:['--qa'],env:{...process.env,DEAD_FREQUENCY_QA_PROFILE:profile},timeout:30000});
    page=await app.firstWindow();
  }else{
    browser=await chromium.launch({headless:true,args:['--use-angle=d3d11','--ignore-gpu-blocklist']});
    page=await browser.newPage({viewport:{width:1440,height:900}});
    await page.goto(process.env.DF_URL||'http://127.0.0.1:5195/?qa=1');
  }
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.waitForFunction(()=>document.documentElement.dataset.ready==='true'&&window.__DF,null,{timeout:60000});
  await page.addInitScript(()=>{if(sessionStorage.getItem('migration-fixture')){localStorage.removeItem('dead-frequency.profile.v2');sessionStorage.removeItem('migration-fixture');}});
  await page.evaluate(()=>{sessionStorage.setItem('migration-fixture','1');localStorage.setItem('dead-frequency.profile.v1',JSON.stringify({version:1,profile:{credits:750,raids:4,extracts:2,best:1200,upgrades:{armor:0,backpack:0,weapon:0}}}));});
  await page.reload();await page.waitForFunction(()=>window.__DF?.state.phase==='hub');
  assert.equal((await snap()).profile.raids,4);assert.equal((await snap()).profile.credits,750);pass('Version-one profile migrates without deleting the original save');
  assert.equal((await snap()).phase,'hub');assert.equal(await page.evaluate(()=>__DF.game.layout.size),300);pass('Updated game boots with the 300m world');
  if(native){const isolation=await app.evaluate(({BrowserWindow})=>{const p=BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();return {sandbox:p.sandbox,contextIsolation:p.contextIsolation,nodeIntegration:p.nodeIntegration};});assert.deepEqual(isolation,{sandbox:true,contextIsolation:true,nodeIntegration:false});pass('Packaged app retains sandbox and renderer isolation');}
  assert.equal(await page.evaluate(()=>__DF.audio.stats().loadedSamples),16);pass('All sixteen audio samples still decode');
  await page.screenshot({path:path.join(out,'01-home.png')});
  await page.locator('#start-raid').click();await page.waitForFunction(()=>__DF.state.phase==='raid'&&document.pointerLockElement);
  assert.equal((await snap()).enemies.length>=25,true);assert.equal((await snap()).raid.timeLeft>710,true);pass('Expanded raid has more patrols and twelve-minute timer');
  await page.evaluate(()=>{__DF.state.enemies.forEach(e=>e.dead=true);__DF.game.teleport(-7,48);__DF.syncLook();});
  const beforeAmmo=(await snap()).player.ammo;
  await page.mouse.down();await page.waitForTimeout(700);await page.mouse.up();
  const shotData=await page.evaluate(()=>({stats:__DF.stats(),p:__DF.state.player,recoil:__DF.recoil.offset()}));
  assert.ok(shotData.p.ammo<beforeAmmo);assert.ok(Math.abs(shotData.stats.cameraPitch-shotData.p.pitch)<1e-5);assert.ok(Math.abs(shotData.stats.cameraYaw-shotData.p.yaw)<1e-5);assert.ok(shotData.recoil.pitch<=.018);pass('Real burst uses the same small recoil angle for camera and aim');
  await page.waitForTimeout(650);assert.deepEqual(await page.evaluate(()=>__DF.recoil.offset()),{pitch:0,yaw:0});pass('Recoil returns fully after releasing fire');
  await page.evaluate(()=>{
    const g=__DF.game;
    for(const item of g.state.loot.filter(i=>!i.kind).slice(0,g.state.raid.capacity)){g.teleport(item.x,item.z);g.update(1/60,{});g.interact();}
    __DF.syncLook();
  });
  const full=await snap();assert.equal(full.raid.loot.length,full.raid.capacity);
  const droppedId=full.raid.loot[0].id;
  await page.keyboard.press('Tab');await page.waitForFunction(()=>!document.pointerLockElement&&!document.querySelector('#inventory-panel').hidden);
  assert.equal((await snap()).phase,'raid');
  const field=await snap();await page.keyboard.down('KeyW');await page.waitForTimeout(350);await page.keyboard.up('KeyW');
  const held=await snap();assert.ok(held.raid.timeLeft<field.raid.timeLeft);assert.ok(Math.hypot(held.player.x-field.player.x,held.player.z-field.player.z)<.05);pass('Backpack releases cursor while raid continues and movement stays blocked');
  await page.locator(`[data-drop-item="${droppedId}"]`).click();
  await page.waitForFunction(id=>!__DF.state.raid.loot.some(i=>i.id===id),droppedId);
  assert.equal((await snap()).raid.loot.length,full.raid.capacity-1);assert.ok((await snap()).loot.some(i=>i.id===droppedId&&!i.taken));
  await page.screenshot({path:path.join(out,'02-backpack-drop.png')});pass('Visible backpack button drops a real recoverable world item');
  await page.keyboard.press('Tab');await page.waitForFunction(()=>document.pointerLockElement);
  await page.keyboard.press('KeyE');await page.waitForFunction(id=>__DF.state.raid.loot.some(i=>i.id===id),droppedId);pass('Dropped item can be picked up again without duplication');
  await page.keyboard.press('Tab');await page.waitForFunction(()=>!document.pointerLockElement);
  await page.locator(`[data-drop-item="${droppedId}"]`).click();
  await page.keyboard.press('Escape');await page.waitForFunction(()=>document.pointerLockElement&&__DF.state.phase==='raid');
  await page.evaluate(id=>{const g=__DF.game,item=g.state.loot.find(i=>!i.kind&&!i.taken&&i.id!==id);g.teleport(item.x,item.z);g.update(1/60,{});g.interact();__DF.syncLook();},droppedId);
  assert.equal((await snap()).raid.loot.length,full.raid.capacity);assert.equal((await snap()).raid.loot.some(i=>i.id===droppedId),false);pass('Freed backpack slot accepts different loot');
  const credits=(await snap()).profile.credits;
  await page.evaluate(()=>{const g=__DF.game,ex=g.layout.extractions[0];g.teleport(ex.x,ex.z);g.update(1/60,{});g.interact();__DF.syncLook();});
  await page.waitForFunction(()=>__DF.state.phase==='extracted',null,{timeout:15000});
  const extracted=await snap();assert.equal(extracted.profile.credits,credits);assert.equal(extracted.profile.intake.length,full.raid.capacity);assert.equal(extracted.result.total,0);pass('Timed extraction preserves goods in intake without automatic sale');
  assert.equal(await page.evaluate(()=>__DF.game.startRaid()),false);pass('Fresh raid is blocked until recovered goods are stored');
  await page.locator('[data-action="hub"]').click();await page.locator('#tab-storage').click();
  await page.screenshot({path:path.join(out,'03-intake.png')});
  await page.locator('#store-all').click();await page.waitForFunction(()=>__DF.state.profile.intake.length===0);
  assert.equal((await snap()).profile.stash.length,full.raid.capacity);pass('Home inventory stores the recovered items through visible controls');
  await page.reload();await page.waitForFunction(()=>window.__DF?.state.phase==='hub');assert.equal((await snap()).profile.stash.length,full.raid.capacity);pass('Stored items persist through a full application reload');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('dead-frequency.profile.v1')).profile.raids),4);assert.ok(await page.evaluate(()=>JSON.parse(localStorage.getItem('dead-frequency.profile.v2')).profile.stash.length>0));pass('New inventory uses a separate save and preserves the old profile');
  await page.locator('#tab-market').click();
  const first=(await snap()).profile.stash[0];await page.locator('#market-item').selectOption(first.id);await page.locator('#market-price').fill('1');await page.locator('#market-duration').selectOption('10');
  await page.waitForTimeout(1300);assert.equal(await page.locator('#market-price').inputValue(),'1');pass('Live market refresh preserves the custom price being edited');
  await page.locator('#create-listing').click();await page.waitForFunction(()=>__DF.state.profile.listings.length===1);
  const offer=(await snap()).profile.listings[0];assert.equal(offer.price,1);assert.equal((await snap()).profile.mailbox.length,0);
  await page.screenshot({path:path.join(out,'04-market.png')});pass('Price and duration create an escrowed offer with no instant sale');
  // One actual wall-clock buyer tick validates integration; later long waits use persisted historical timestamps.
  await page.waitForFunction(()=>__DF.state.profile.listings[0]?.checks>0||__DF.state.profile.mailbox.length>0,null,{timeout:49000});pass('A buyer is evaluated automatically after the real thirty-second waiting period');
  await page.evaluate(()=>{const p=__DF.state.profile;for(const l of p.listings){l.createdAt-=900_000;l.expiresAt-=900_000;l.nextCheckAt-=900_000;}__DF.persist();});
  await page.reload();await page.waitForFunction(()=>window.__DF?.state.phase==='hub'&&__DF.state.profile.listings.length===0);
  const settled=await snap();assert.equal(settled.profile.mailbox.length,1);assert.equal(settled.profile.mailbox[0].type,'sale');assert.equal(settled.profile.credits,credits);pass('Reopening catches up elapsed offers and holds sale proceeds in mailbox');
  await page.locator('#tab-mailbox').click();await page.screenshot({path:path.join(out,'05-mailbox.png')});
  await page.locator('#claim-all').click();await page.waitForFunction(()=>__DF.state.profile.mailbox.length===0);assert.equal((await snap()).profile.credits,credits+1);pass('Mailbox claim credits exactly the user asking price once');
  await page.locator('#tab-market').click();const ret=(await snap()).profile.stash[0];await page.locator('#market-item').selectOption(ret.id);await page.locator('#market-price').fill('1000000');await page.locator('#market-duration').selectOption('2');await page.locator('#create-listing').click();
  await page.waitForFunction(()=>__DF.state.profile.listings.length===1);
  await page.evaluate(()=>{const p=__DF.state.profile,l=p.listings[0];l.createdAt-=300_000;l.expiresAt-=300_000;l.nextCheckAt=l.expiresAt+1;__DF.persist();});
  await page.reload();await page.waitForFunction(()=>window.__DF?.state.profile.mailbox.length===1);assert.equal((await snap()).profile.mailbox[0].type,'return');
  await page.locator('#tab-mailbox').click();await page.locator('#claim-all').click();await page.waitForFunction(id=>__DF.state.profile.stash.some(i=>i.id===id),ret.id);pass('Expired unsold item returns through mailbox and can be reclaimed');
  await page.locator('#tab-market').click();await page.locator('#market-item').selectOption(ret.id);await page.locator('#market-price').fill('999');await page.locator('#create-listing').click();await page.waitForFunction(()=>__DF.state.profile.listings.length===1);
  const cancel=(await snap()).profile.listings[0].id;await page.locator(`[data-cancel-listing="${cancel}"]`).click();await page.waitForFunction(()=>__DF.state.profile.listings.length===0);assert.equal((await snap()).profile.mailbox[0].reason,'Abgebrochen');pass('Offer cancellation safely returns goods to mailbox');
  if(native)await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1280,720));else await page.setViewportSize({width:1280,height:720});
  for(const tab of ['storage','market','mailbox']){await page.locator(`#tab-${tab}`).click();await page.waitForTimeout(100);assert.ok(await page.locator(`#hub-${tab}`).isVisible());await page.screenshot({path:path.join(out,`06-${tab}-720p.png`)});}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);pass('Storage, market and mailbox remain accessible at 720p');
  assert.deepEqual(errors,[]);pass('No JavaScript or renderer errors');
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native,exe:process.env.DF_EXE,checks,errors,stats:await page.evaluate(()=>__DF.stats())},null,2));
}catch(error){if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});await fs.writeFile(path.join(out,'result.json'),JSON.stringify({checks,errors,failure:String(error.stack)},null,2));throw error;}
finally{if(app)await app.close();if(browser)await browser.close();}
