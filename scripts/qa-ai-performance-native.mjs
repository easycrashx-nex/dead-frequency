import {_electron} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {isWalkable} from '../src/simulation.js';
import {ENEMY_SPAWNING} from '../src/enemies.js';
const version=process.env.DF_QA_VERSION||JSON.parse(await fs.readFile('package.json','utf8')).version;
const exe=process.env.DF_EXE||path.resolve(`../../outputs/v${version}/DEAD FREQUENCY-win32-x64/DEAD FREQUENCY.exe`);
const out=path.resolve(`../qa-ai-performance-native-${version}`);await fs.mkdir(out,{recursive:true});
const profile=await fs.mkdtemp(path.join(out,'profile-'));
const checks=[],errors=[];let app,page;
const pass=name=>{checks.push(name);console.log('PASS',name);};
try{
  app=await _electron.launch({executablePath:exe,args:['--qa'],env:{...process.env,DEAD_FREQUENCY_QA_PROFILE:profile},timeout:45000});
  page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.waitForFunction(()=>window.__DF&&document.documentElement.dataset.ready==='true',null,{timeout:60000});
  assert.equal(await app.evaluate(({app})=>app.getVersion()),version);
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setFullScreen(false);w.unmaximize();w.setSize(1440,900);});
  await page.evaluate(()=>__DF.settingsChanged({quality:'high',fpsLimit:0,volume:0}));
  await page.locator('#start-raid').click();await page.waitForFunction(()=>__DF.state.phase==='raid'&&document.pointerLockElement);
  const positions=[];
  for(let z=-32;z<=24&&positions.length<ENEMY_SPAWNING.maxAlive;z+=4)for(let x=-146;x<=-108&&positions.length<ENEMY_SPAWNING.maxAlive;x+=3)if(isWalkable(x,z,.58))positions.push({x,z});
  assert.equal(positions.length,ENEMY_SPAWNING.maxAlive);
  await page.evaluate(positions=>{
    const s=__DF.state;__DF.game.teleport(-143,30);__DF.syncLook();s.player.hp=s.player.maxHp=1_000_000;s.player.armor=0;
    while(s.enemies.length<positions.length)s.enemies.push({...structuredClone(s.enemies[0]),id:`qa-stress-${s.enemies.length}`});
    s.enemies.forEach((e,i)=>{Object.assign(e,positions[i],{y:0,yaw:Math.PI,home:{...positions[i],y:0},path:[],pathTimer:0,alert:0,lastSeen:null});delete e.ai;delete e.lastHeard;});
  },positions);
  await page.waitForTimeout(3500);pass('The actual Windows renderer and the maximum 72 live enemy simulations warm up together in a 1440 by 900 outer window on high quality');
  const sample=await page.evaluate(async()=>{
    const frames=[],start=performance.now(),raidStart=__DF.state.raid.timeLeft;let previous=start;
    await new Promise(resolve=>{function sample(now){frames.push(now-previous);previous=now;if(now-start>=15000)resolve();else requestAnimationFrame(sample);}requestAnimationFrame(sample);});
    frames.shift();frames.sort((a,b)=>a-b);
    return {elapsedMs:performance.now()-start,frames:frames.length,meanFrameMs:frames.reduce((a,b)=>a+b,0)/frames.length,p95FrameMs:frames[Math.floor(frames.length*.95)],p99FrameMs:frames[Math.floor(frames.length*.99)],simulatedSeconds:raidStart-__DF.state.raid.timeLeft,
      viewport:{width:innerWidth,height:innerHeight},stats:__DF.stats(),enemyCount:__DF.state.enemies.length,
      positions:__DF.state.enemies.map(e=>({x:e.x,y:e.y,z:e.z,task:e.ai?.task,role:e.ai?.role})),heapBytes:performance.memory?.usedJSHeapSize??null};
  });
  for(const p of sample.positions)assert.ok(isWalkable(p.x,p.z,.38,p.y),`Guard crossed geometry at ${p.x},${p.z}`);
  assert.ok(sample.simulatedSeconds>=14,'Simulation fell behind the 15-second wall clock');
  assert.equal(sample.enemyCount,ENEMY_SPAWNING.maxAlive);
  assert.ok(sample.meanFrameMs<=1000/60&&sample.p95FrameMs<=34,JSON.stringify(sample));
  pass('A 15-second native combat sample keeps simulation time in sync and every guard outside solid geometry');
  await page.screenshot({path:path.join(out,'combat.png')});assert.deepEqual(errors,[]);pass('The native stress sample has no JavaScript or renderer errors');
  const appAsarSha256=createHash('sha256').update(await fs.readFile(path.join(path.dirname(exe),'resources/app.asar'))).digest('hex');
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,exe,version,appAsarSha256,checks,errors,sample},null,2));
  console.log(JSON.stringify({version,fps:1000/sample.meanFrameMs,p95Ms:sample.p95FrameMs,simulatedSeconds:sample.simulatedSeconds}));
}catch(error){await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,exe,version,checks,errors,failure:error.stack},null,2));throw error;}
finally{await app?.close().catch(()=>{});}
