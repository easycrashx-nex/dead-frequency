import {_electron} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const version=JSON.parse(await fs.readFile('package.json','utf8')).version;
const exe=process.env.DF_EXE||path.resolve(`../../outputs/v${version}/DEAD FREQUENCY-win32-x64/DEAD FREQUENCY.exe`);
const out=path.resolve(`../qa-interiors-native-${version}`);await fs.mkdir(out,{recursive:true});
const profile=await fs.mkdtemp(path.join(out,'profile-'));
const checks=[],errors=[],measurements=[];let app,page;
const pass=name=>{checks.push(name);console.log('PASS',name);};
async function position(point,yaw=0){
  assert.equal(await page.evaluate(({point,yaw})=>{const ok=__DF.game.teleport(point.x,point.z);__DF.state.player.yaw=yaw;__DF.state.player.pitch=0;__DF.syncLook();return ok;},{point,yaw}),true,JSON.stringify(point));
}
async function walkTo(point){
  await page.keyboard.down('KeyW');
  try{await page.waitForFunction(point=>Math.hypot(__DF.state.player.x-point.x,__DF.state.player.z-point.z)<.55,point,{timeout:14000});}
  finally{await page.keyboard.up('KeyW');}
}
try{
  app=await _electron.launch({executablePath:exe,args:['--qa'],env:{...process.env,DEAD_FREQUENCY_QA_PROFILE:profile},timeout:45000});
  page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.waitForFunction(()=>window.__DF&&document.documentElement.dataset.ready==='true',null,{timeout:60000});
  assert.equal(await app.evaluate(({app})=>app.getVersion()),version);
  const interiors=await page.evaluate(()=>__DF.game.layout.interiors);
  assert.deepEqual(interiors.map(room=>room.id).sort(),['entry-booth','warehouse','rail-office','customs-office','south-workshop'].sort());
  assert.ok(interiors.every(room=>room.doors.length===2));pass('The new Windows EXE contains five interiors with ten real entrances');
  await page.locator('#start-raid').click();await page.waitForFunction(()=>__DF.state.phase==='raid'&&document.pointerLockElement);
  await page.evaluate(()=>{window.__interiorEnemy=structuredClone(__DF.state.enemies[0]);__DF.state.enemies=[];});
  for(const room of interiors){
    const south=room.doors.find(door=>door.side==='south'),north=room.doors.find(door=>door.side==='north');
    assert.ok(south&&north);
    await position(south.outside);await page.waitForTimeout(150);
    await page.screenshot({path:path.join(out,`${room.id}-entrance.png`)});
    await walkTo(south.inside);
    const entered=await page.evaluate(()=>({...__DF.state.player}));
    assert.ok(Math.abs(entered.x-room.x)<room.w/2&&Math.abs(entered.z-room.z)<room.d/2);
    assert.ok(entered.y>-.05&&entered.y<.2);pass(`${room.name}: actual keyboard movement crosses the open doorway without a step or loading transition`);
    await page.screenshot({path:path.join(out,`${room.id}-interior.png`)});
    await walkTo(north.outside);
    const exited=await page.evaluate(()=>({...__DF.state.player}));assert.ok(exited.z<north.z);
    pass(`${room.name}: the continuous central route reaches the second exit`);
    const container=await page.evaluate(room=>__DF.state.containers.find(c=>c.interiorId===room.id),room);
    assert.ok(container,`${room.name}: missing interior container`);
    const reached=await page.evaluate(c=>{for(const [dx,dz] of [[0,c.d/2+.9],[0,-c.d/2-.9],[c.w/2+.9,0],[-c.w/2-.9,0]]){if(!__DF.game.teleport(c.x+dx,c.z+dz))continue;__DF.state.player.yaw=Math.atan2(dx,dz);__DF.syncLook();__DF.step(.05);if(__DF.state.prompt?.id===c.id)return true;}return false;},container);assert.ok(reached);
    await page.keyboard.press('KeyE');await page.waitForFunction(id=>__DF.state.containers.find(c=>c.id===id).searched,container.id);
    const loot=container.items.find(item=>!item.kind);assert.ok(loot);
    await page.locator(`[data-take-container-item="${loot.id}"]`).click();await page.waitForFunction(id=>__DF.state.raid.loot.some(item=>item.id===id),loot.id);
    await page.locator(`[data-panel="container"] [data-drop-item="${loot.id}"]`).click();await page.waitForFunction(id=>!__DF.state.raid.loot.some(item=>item.id===id),loot.id);
    await page.keyboard.press('Escape');await page.waitForFunction(()=>document.pointerLockElement);
    const dropped=await page.evaluate(id=>__DF.state.loot.find(item=>item.id===id&&!item.taken),loot.id);assert.ok(dropped);await position(dropped);
    await page.waitForFunction(id=>__DF.state.prompt?.id===id,loot.id);await page.keyboard.press('KeyE');await page.waitForFunction(id=>__DF.state.raid.loot.some(item=>item.id===id),loot.id);
    pass(`${room.name}: its container can be searched, looted and the dropped item recovered`);
  }
  const warehouse=interiors.find(room=>room.id==='warehouse'),door=warehouse.doors.find(door=>door.side==='south');
  const wallX=door.x+door.width/2+1.2;
  await position({x:wallX,z:door.z+1.4});
  await page.keyboard.down('KeyW');await page.waitForTimeout(850);await page.keyboard.up('KeyW');
  assert.ok(await page.evaluate(z=>__DF.state.player.z>z+.2,door.z));pass('A closed wall section stops the actual player controller beside the doorway');
  async function guardAt(x,z){await page.evaluate(({x,z})=>{__DF.state.enemies=[{...window.__interiorEnemy,id:'qa-interior-guard',x,z,y:0,hp:95,dead:false,fireTimer:9999,alert:99,path:[],pathTimer:9999,flank:false}];__DF.state.player.ammo=24;},{x,z});}
  await position({x:wallX,z:door.z+1.4});await guardAt(wallX,door.z-1.8);
  await page.mouse.down();await page.waitForTimeout(160);await page.mouse.up();
  assert.ok(await page.evaluate(()=>__DF.state.player.ammo<24));assert.equal(await page.evaluate(()=>__DF.state.enemies[0].hp),95);
  pass('Real shots consume ammunition but cannot damage a target through a closed wall');
  await position(door.outside);await guardAt(door.x,door.z-3);await page.waitForTimeout(200);
  await page.mouse.down();await page.waitForTimeout(160);await page.mouse.up();
  assert.ok(await page.evaluate(()=>__DF.state.enemies[0].hp<95));await page.evaluate(()=>{__DF.state.enemies=[];});
  pass('The same weapon can hit a target through the open entrance');
  await position(door.inside);await page.waitForTimeout(300);
  const performance=await page.evaluate(()=>new Promise(resolve=>{
    const times=[];let first,last;function frame(now){first??=now;if(last!==undefined)times.push(now-last);last=now;
      if(now-first>=2000){const sorted=[...times].sort((a,b)=>a-b);resolve({...__DF.stats(),sampleSeconds:(now-first)/1000,frames:times.length,measuredFps:times.length*1000/(now-first),p95FrameMs:sorted[Math.floor(sorted.length*.95)]});}else requestAnimationFrame(frame);
    }requestAnimationFrame(frame);
  }));measurements.push({building:warehouse.id,...performance});
  assert.ok(performance.measuredFps>30,JSON.stringify(performance));pass('The furnished interior remains interactive during the measured native rendering sample');
  await page.keyboard.press('KeyM');await page.locator('#map-panel').waitFor();
  assert.match(await page.locator('#map-panel').innerText(),/BEGEHBARES GEBÄUDE/i);
  await page.screenshot({path:path.join(out,'map-interiors.png')});await page.keyboard.press('KeyM');
  pass('The in-raid map explains the accessible buildings and their entrance markings');
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>__DF.state.phase),'paused');
  await page.locator('[data-action="settings"]:visible').click();await page.locator('#settings-search').fill('Schatten');
  assert.equal(await page.locator('#setting-shadows').isVisible(),true);await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>__DF.state.phase),'paused');pass('Existing categorized settings remain usable from an indoor paused raid');
  assert.deepEqual(errors,[]);pass('No JavaScript or renderer errors in the native interior checks');
  const appAsarSha256=createHash('sha256').update(await fs.readFile(path.join(path.dirname(exe),'resources/app.asar'))).digest('hex');
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,exe,version,appAsarSha256,checks,errors,buildings:interiors.map(({id,name,doors})=>({id,name,entrances:doors.length})),measurements},null,2));
}catch(error){await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,exe,version,checks,errors,measurements,failure:error.stack},null,2));throw error;}
finally{await app?.close().catch(()=>{});}
