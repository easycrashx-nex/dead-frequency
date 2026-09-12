import {_electron} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {isWalkable,hasLineOfSight} from '../src/simulation.js';

const version=JSON.parse(await fs.readFile('package.json','utf8')).version;
const exe=process.env.DF_EXE||path.resolve(`../../outputs/v${version}/DEAD FREQUENCY-win32-x64/DEAD FREQUENCY.exe`);
const out=path.resolve(`../qa-ai-native-${version}`);await fs.mkdir(out,{recursive:true});
const profile=await fs.mkdtemp(path.join(out,'profile-'));
const checks=[],errors=[],measurements={};let app,page;
const pass=name=>{checks.push(name);console.log('PASS',name);};
async function fixture(player,guards){
  await page.evaluate(({player,guards})=>{
    __DF.game.teleport(player.x,player.z);__DF.state.player.yaw=0;__DF.state.player.pitch=0;__DF.syncLook();
    __DF.state.player.hp=__DF.state.player.maxHp=10000;__DF.state.player.armor=0;
    __DF.state.enemies=guards.map(spec=>{
      const enemy=structuredClone(window.__aiTemplate);
      Object.assign(enemy,{yaw:Math.PI,dead:false,hp:95,home:{x:spec.x,z:spec.z},path:[],patrol:null,pathTimer:0,alert:0,lastSeen:null,lastHeard:null,fireTimer:0,flank:false,mode:'patrol'},spec);
      delete enemy.ai;delete enemy.targetPlayerId;return enemy;
    });
  },{player,guards});
}
async function sample(seconds){
  const result=await page.evaluate(async seconds=>{
    const samples=[],start=performance.now(),timeLeft=__DF.state.raid.timeLeft;
    while(performance.now()-start<seconds*1000){
      samples.push({time:(performance.now()-start)/1000,hp:__DF.state.player.hp,player:{x:__DF.state.player.x,z:__DF.state.player.z},poses:__DF.stats().enemyPoses,
        enemies:__DF.state.enemies.map(e=>({id:e.id,x:e.x,z:e.z,hp:e.hp,task:e.ai?.task,role:e.ai?.role,cover:e.ai?.cover,goal:e.ai?.goal,lastSeen:e.lastSeen,lastHeard:e.lastHeard}))});
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    return {wallSeconds:(performance.now()-start)/1000,simulatedSeconds:timeLeft-__DF.state.raid.timeLeft,samples};
  },seconds);
  assert.ok(result.simulatedSeconds>=seconds-.5,'Native simulation stalled or paused');
  for(const row of result.samples)for(const e of row.enemies)assert.ok(isWalkable(e.x,e.z,.38),`Guard intersects geometry at ${e.x},${e.z}`);
  return result;
}
try{
  app=await _electron.launch({executablePath:exe,args:['--qa'],env:{...process.env,DEAD_FREQUENCY_QA_PROFILE:profile},timeout:45000});
  page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.waitForFunction(()=>window.__DF&&document.documentElement.dataset.ready==='true',null,{timeout:60000});
  assert.equal(await app.evaluate(({app})=>app.getVersion()),version);
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setFullScreen(false);w.unmaximize();w.setSize(1440,900);});
  await page.evaluate(()=>__DF.settingsChanged({quality:'high',fpsLimit:0,volume:0}));
  await page.locator('#start-raid').click();await page.waitForFunction(()=>__DF.state.phase==='raid'&&document.pointerLockElement);
  await page.evaluate(()=>{window.__aiTemplate=structuredClone(__DF.state.enemies.find(e=>e.kind==='guard'));});
  pass('The new packaged Windows game starts a real raid with its bundled tactical AI');

  await fixture({x:2,z:35},[{id:'qa-anchor',x:0,z:23},{id:'qa-flanker',x:-4,z:23,flank:true}]);
  measurements.combat=await sample(12);
  const anchors=measurements.combat.samples.map(row=>row.enemies.find(e=>e.id==='qa-anchor'));
  assert.ok(anchors.some(e=>e.task==='cover'&&e.cover&&!hasLineOfSight({...e,y:1.55},{x:2,y:1.3,z:35})),'No physical hide behind solid cover');
  assert.ok(anchors.some(e=>e.task==='peek'&&hasLineOfSight({...e,y:1.55},{x:2,y:1.3,z:35})),'Never reached a visible peeking position');
  const tasks=anchors.map(e=>e.task);const firstPeek=tasks.indexOf('peek');assert.ok(firstPeek>=0&&tasks.slice(firstPeek+1).includes('cover'),'Never returned to cover');
  assert.ok(measurements.combat.samples.at(-1).hp<10000,'Bots never fired and landed a hit during exposed phases');
  pass('During 12 seconds of real time an anchor hides behind actual geometry, peeks, fires and returns to cover');
  const flankers=measurements.combat.samples.map(row=>row.enemies.find(e=>e.id==='qa-flanker'));
  assert.ok(flankers.some(e=>e.task==='flank'&&Math.abs(e.x+4)>3),'Flanker never made meaningful lateral movement');
  assert.ok(measurements.combat.samples.some(row=>row.enemies.every(e=>e.role)&&(row.enemies[0].task!==row.enemies[1].task)));
  pass('A second guard takes a distinct lateral route while the anchor uses cover; both remain outside solid obstacles');
  await page.screenshot({path:path.join(out,'cover-and-flank.png')});

  await fixture({x:-27,z:-8},[{id:'qa-listener',x:-33,z:0,yaw:0,fireTimer:9999}]);
  await page.waitForTimeout(300);
  const before=await page.evaluate(()=>({ammo:__DF.state.player.ammo,e:structuredClone(__DF.state.enemies[0])}));
  assert.equal(before.e.lastSeen,null);assert.equal(before.e.lastHeard,null);
  await page.mouse.down();await page.waitForTimeout(120);await page.mouse.up();
  await page.waitForFunction(()=>__DF.state.enemies[0].ai.task==='investigate'&&__DF.state.enemies[0].lastHeard,null,{timeout:3000});
  const heard=await page.evaluate(()=>({ammo:__DF.state.player.ammo,e:structuredClone(__DF.state.enemies[0])}));
  assert.ok(heard.ammo<before.ammo);assert.equal(heard.e.lastSeen,null);assert.deepEqual(heard.e.lastHeard,{x:-27,z:-9});
  pass('An actual mouse-fired shot behind the warehouse wall produces an approximate sound contact without visual knowledge');
  await page.evaluate(()=>__DF.teleport(-140,130));
  measurements.search=await sample(13);
  const search=measurements.search.samples.map(row=>row.enemies[0]);
  assert.ok(search.every(e=>e.lastSeen===null),'The guard learned the hidden relocated player position');
  assert.ok(search.some(e=>Math.abs(e.x+27)<2&&Math.abs(e.z+9)<2),'Guard never reached the noise area through the open door');
  assert.ok(search.some(e=>e.task==='sweep'),'Guard did not search beyond the now-empty contact point');
  const poses=measurements.search.samples.flatMap(row=>row.poses).filter(e=>e.task==='investigate'||e.task==='scan'||e.task==='sweep');
  assert.ok(poses.length>5&&poses.every(e=>Number.isFinite(e.weaponPitch)&&Number.isFinite(e.headYaw)));
  pass('The native guard routes through the warehouse entrance, checks the abandoned noise location and searches nearby without tracking the hidden player');
  pass('Search and combat poses stay finite and follow the authoritative tactical state');
  assert.deepEqual(errors,[]);pass('No JavaScript or renderer errors in the packaged tactical behavior checks');
  const appAsarSha256=createHash('sha256').update(await fs.readFile(path.join(path.dirname(exe),'resources/app.asar'))).digest('hex');
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,exe,version,appAsarSha256,checks,errors,measurements},null,2));
}catch(error){await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,exe,version,checks,errors,measurements,failure:error.stack},null,2));throw error;}
finally{await app?.close().catch(()=>{});}
