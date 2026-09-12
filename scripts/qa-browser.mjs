import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const out=path.resolve('../qa-browser');await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
const errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
async function check(name,fn){await fn();checks.push(name);console.log('PASS',name);}
const state=()=>page.evaluate(()=>JSON.parse(JSON.stringify(window.__DF.state)));
try{
  await page.goto(process.env.DF_QA_URL||'http://127.0.0.1:5195/?qa=1',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.documentElement.dataset.ready==='true',null,{timeout:60000});
  await check('First load, hub and rendered 3D scene',async()=>{assert.equal((await state()).phase,'hub');assert.ok(await page.evaluate(()=>window.__DF.stats().triangles>1000));});
  await page.screenshot({path:path.join(out,'01-hub.png')});
  await check('Hub fits at 1440 × 900',async()=>{assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight));});
  await page.locator('[data-action="start"]').click();
  await page.waitForFunction(()=>window.__DF.state.phase==='raid'&&document.pointerLockElement);
  await check('Start button and real pointer lock',async()=>{assert.equal((await state()).phase,'raid');});
  const before=await state();await page.keyboard.down('KeyW');await page.waitForTimeout(650);await page.keyboard.up('KeyW');
  await check('WASD moves authoritative player',async()=>{assert.ok((await state()).player.z<before.player.z-1);});
  await page.mouse.move(825,405);await page.waitForTimeout(120);
  await check('Mouse changes first-person look',async()=>{assert.notEqual((await state()).player.yaw,before.player.yaw);});
  await page.evaluate(()=>{window.__DF.state.player.yaw=0;window.__DF.state.player.pitch=-.04;window.__DF.syncLook();});
  const ammo=(await state()).player.ammo;await page.mouse.down();await page.waitForTimeout(360);await page.mouse.up();
  await check('Automatic firing consumes ammunition',async()=>{assert.ok((await state()).player.ammo<ammo);});
  await page.keyboard.press('KeyR');await page.waitForTimeout(2200);
  await check('Reload completes and draws from reserve',async()=>{const p=(await state()).player;assert.equal(p.ammo,p.magSize);assert.ok(p.reserve<before.player.reserve);});
  await page.screenshot({path:path.join(out,'02-raid.png')});
  await page.keyboard.press('KeyM');await page.waitForTimeout(200);await page.screenshot({path:path.join(out,'03-map.png')});
  await check('Field map opens without pausing simulation',async()=>{assert.equal((await state()).phase,'raid');assert.ok(await page.locator('#map-panel').isVisible());});
  await page.keyboard.press('KeyM');
  await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__DF.state.phase==='paused');
  const pausedTime=(await state()).raid.timeLeft;await page.waitForTimeout(600);
  await check('Pause freezes the raid and releases mouse',async()=>{assert.equal((await state()).raid.timeLeft,pausedTime);assert.equal(await page.evaluate(()=>document.pointerLockElement),null);});
  await page.screenshot({path:path.join(out,'04-pause.png')});
  await page.locator('[data-action="resume"]').click();await page.waitForFunction(()=>window.__DF.state.phase==='raid');
  // Controlled test placements below complement actual-input checks above.
  await page.evaluate(()=>{const g=window.__DF.game;g.state.enemies.forEach(e=>{e.dead=true;e.hp=0;});g.teleport(-10,47);});
  await page.waitForTimeout(100);await page.keyboard.press('KeyE');
  await check('Loot interaction adds actual backpack value',async()=>{assert.ok((await state()).raid.value>0);assert.equal((await state()).raid.loot.length,1);});
  await page.keyboard.press('Tab');await page.waitForTimeout(150);await page.screenshot({path:path.join(out,'05-backpack.png')});await page.keyboard.press('Tab');
  await page.evaluate(()=>window.__DF.game.teleport(-47,46));await page.waitForTimeout(100);await page.keyboard.press('KeyE');
  await page.waitForTimeout(500);await page.screenshot({path:path.join(out,'06-extraction.png')});
  await check('Extraction starts after interaction',async()=>{assert.ok((await state()).raid.extractionProgress>0);});
  const balance=(await state()).profile.credits;
  await page.waitForFunction(()=>window.__DF.state.phase==='extracted',null,{timeout:12000});
  await check('Timed extraction preserves recovered goods and only pays bonuses',async()=>{const s=await state();assert.equal(s.profile.credits,balance+s.result.bonus);assert.equal(s.profile.intake.length,1);assert.ok(s.result.success);});
  await page.screenshot({path:path.join(out,'07-result.png')});
  const savedBalance=(await state()).profile.credits;
  await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>window.__DF?.state.phase==='hub');
  await check('Progress survives reload',async()=>{assert.equal((await state()).profile.credits,savedBalance);});
  await page.setViewportSize({width:1280,height:720});await page.waitForTimeout(200);await page.screenshot({path:path.join(out,'08-hub-720p.png')});
  await check('Hub fits at 1280 × 720',async()=>{assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight));});
  await check('No browser or WebGL runtime errors',async()=>assert.deepEqual(errors,[]));
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({checks,errors,stats:await page.evaluate(()=>window.__DF.stats())},null,2));
}catch(error){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});await fs.writeFile(path.join(out,'result.json'),JSON.stringify({checks,errors,failure:String(error.stack)},null,2));throw error;}
finally{await browser.close();}
