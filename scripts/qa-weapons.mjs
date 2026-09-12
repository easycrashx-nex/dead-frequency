import {_electron} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const exe=process.env.DF_EXE;
assert.ok(exe,'Set DF_EXE to the packaged Windows application');
const version=JSON.parse(await fs.readFile('package.json','utf8')).version;
const out=path.resolve(`../qa-weapons-${version}`);await fs.mkdir(out,{recursive:true});
const profile=await fs.mkdtemp(path.join(out,'profile-'));
const checks=[],errors=[],weapons=[];
const pass=name=>{checks.push(name);console.log('PASS',name);};
const app=await _electron.launch({executablePath:exe,args:['--qa'],env:{...process.env,DEAD_FREQUENCY_QA_PROFILE:profile},timeout:30000});
let page;
try{
  page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.waitForFunction(()=>window.__DF&&document.documentElement.dataset.ready==='true',null,{timeout:60000});
  assert.equal(await app.evaluate(({app})=>app.getVersion()),version);pass('New packaged version boots in an isolated profile');
  assert.equal(await page.evaluate(()=>__DF.audio.stats().loadedSamples),16);pass('All sixteen recorded sounds decode');
  await page.evaluate(()=>{
    window.__weaponFrames=[];
    const original=__DF.view.update;
    __DF.view.update=(state,dt,input)=>{
      original(state,dt,input);
      if(state.phase!=='raid')return;
      const stats=__DF.stats(),p=state.player;
      window.__weaponFrames.push({weapon:p.weapon,aim:!!input.aim,ammo:p.ammo,recoil:__DF.recoil.offset(),pitchError:Math.abs(stats.cameraPitch-p.pitch),yawError:Math.abs(stats.cameraYaw-p.yaw)});
    };
  });
  for(const [kit,weapon] of [['scout','VX-9'],['assault','AR-4']]){
    await page.locator(`#kit-${kit}`).click();await page.locator('#start-raid').click();
    await page.waitForFunction(()=>document.pointerLockElement&&__DF.state.phase==='raid');
    assert.equal(await page.evaluate(()=>__DF.state.player.weapon),weapon);pass(`${weapon}: kit starts and mouse is captured`);
    await page.evaluate(()=>{__DF.state.enemies.forEach(e=>e.dead=true);__DF.teleport(-7,48);__DF.state.player.yaw=0;__DF.state.player.pitch=-.06;__DF.syncLook();});
    await page.waitForTimeout(350);await page.screenshot({path:path.join(out,`${weapon}-hip.png`)});
    const initial=await page.evaluate(()=>__DF.state.player.ammo);
    await page.evaluate(()=>{window.__weaponFrames=[];});
    await page.mouse.down();await page.waitForTimeout(800);await page.mouse.up();
    const hip=await page.evaluate(()=>window.__weaponFrames);
    const hipPeak=Math.max(...hip.map(f=>f.recoil.pitch));
    assert.ok(hipPeak*180/Math.PI>.32&&hipPeak*180/Math.PI<.8,`${weapon} hip peak ${hipPeak*180/Math.PI}`);
    assert.ok(await page.evaluate(n=>__DF.state.player.ammo<n,initial));pass(`${weapon}: real firing produces a stronger bounded burst`);
    await page.waitForTimeout(650);assert.deepEqual(await page.evaluate(()=>__DF.recoil.offset()),{pitch:0,yaw:0});
    await page.mouse.down({button:'right'});await page.waitForTimeout(400);await page.screenshot({path:path.join(out,`${weapon}-ads.png`)});
    await page.evaluate(()=>{window.__weaponFrames=[];});
    await page.mouse.down();await page.waitForTimeout(800);await page.mouse.up();await page.mouse.up({button:'right'});
    const ads=await page.evaluate(()=>window.__weaponFrames);
    const adsPeak=Math.max(...ads.map(f=>f.recoil.pitch));
    assert.ok(adsPeak>hipPeak*.4&&adsPeak<hipPeak*.7);pass(`${weapon}: aiming reduces the recoil strength`);
    const all=[...hip,...ads];
    assert.ok(all.every(f=>f.pitchError<1e-7&&f.yawError<1e-7));pass(`${weapon}: camera angles stay aligned with actual aiming angles`);
    await page.waitForTimeout(650);assert.deepEqual(await page.evaluate(()=>__DF.recoil.offset()),{pitch:0,yaw:0});
    assert.ok(Math.abs(await page.evaluate(()=>__DF.state.player.pitch)+.06)<1e-8);pass(`${weapon}: releasing fire returns exactly to the original aim`);
    await page.keyboard.press('KeyR');await page.waitForTimeout(450);await page.screenshot({path:path.join(out,`${weapon}-reload.png`)});
    await page.waitForFunction(()=>__DF.state.player.reload===0,null,{timeout:3000});
    assert.ok(await page.evaluate(()=>__DF.state.player.ammo===__DF.state.player.magSize));
    await page.keyboard.down('KeyW');await page.keyboard.down('ShiftLeft');await page.waitForTimeout(350);
    assert.ok(await page.evaluate(()=>__DF.state.player.sprinting));await page.screenshot({path:path.join(out,`${weapon}-sprint.png`)});
    await page.keyboard.up('ShiftLeft');await page.keyboard.up('KeyW');pass(`${weapon}: reload and sprint poses render without interrupting their actions`);
    weapons.push({weapon,hipPeakDegrees:hipPeak*180/Math.PI,adsPeakDegrees:adsPeak*180/Math.PI,sampledFrames:all.length});
    await page.keyboard.press('Escape');await page.waitForFunction(()=>__DF.state.phase==='paused');
    await page.locator('#abandon-raid').click();await page.locator('#abandon-raid').click();await page.waitForFunction(()=>__DF.state.phase==='hub');
  }
  assert.deepEqual(errors,[]);pass('No JavaScript or rendering errors during both weapon checks');
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,exe,version,checks,errors,weapons},null,2));
}catch(error){if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,exe,version,checks,errors,failure:String(error.stack)},null,2));throw error;}
finally{await app.close();}
