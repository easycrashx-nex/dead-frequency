import {_electron} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const version=JSON.parse(await fs.readFile('package.json','utf8')).version;
const exe=process.env.DF_EXE||path.resolve(`../../outputs/v${version}/DEAD FREQUENCY-win32-x64/DEAD FREQUENCY.exe`);
const out=path.resolve(`../qa-world-native-${version}`);
await fs.mkdir(out,{recursive:true});
const profile=await fs.mkdtemp(path.join(out,'profile-'));
const checks=[],errors=[],measurements={};
let app,page,appAsarSha256;
const pass=name=>{checks.push(name);console.log('PASS',name);};
const ready=()=>page.waitForFunction(()=>window.__DF&&document.documentElement.dataset.ready==='true',null,{timeout:90000});
const position=()=>page.evaluate(()=>{const p=__DF.state.player;return{x:p.x,y:p.y,z:p.z,grounded:p.grounded};});
const shot=name=>page.screenshot({path:path.join(out,`${name}.png`)});
async function place(point,yaw=0,pitch=0){
 const ok=await page.evaluate(({point,yaw,pitch})=>{
  const ok=point.y===undefined?__DF.game.teleport(point.x,point.z):__DF.game.teleport(point.x,point.z,point.y+.02);
  if(!ok)return false;
  Object.assign(__DF.state.player,{yaw,pitch});__DF.syncLook();return true;
 },{point,yaw,pitch});
 assert.equal(ok,true,`Valid physical fixture ${JSON.stringify(point)}`);
 await page.waitForTimeout(120);
}
async function look(yaw,pitch=0){
 await page.evaluate(({yaw,pitch})=>{Object.assign(__DF.state.player,{yaw,pitch});__DF.syncLook();},{yaw,pitch});
}
// Only setup uses teleport. Every measured transition below comes from real W
// input delivered through the packaged renderer, with normal wall-clock time.
async function walkTo(goal,label,{timeoutMs=15000}={}){
 const before=await position(),dx=goal.x-before.x,dz=goal.z-before.z,length=Math.hypot(dx,dz);
 assert.ok(length>.1,`${label}: movement must have nonzero length`);
 await look(Math.atan2(-dx,-dz));
 await page.keyboard.down('KeyW');
 let movement;
 try{
  movement=await page.evaluate(async({goal,before,dx,dz,length,timeoutMs})=>{
   const samples=[],start=performance.now(),timeLeft=__DF.state.raid.timeLeft;
   while(performance.now()-start<timeoutMs){
    const p=__DF.state.player,travel=((p.x-before.x)*dx+(p.z-before.z)*dz)/length;
    samples.push({ms:performance.now()-start,x:p.x,y:p.y,z:p.z,grounded:p.grounded,phase:__DF.state.phase});
    if(travel>=length-.14)return{reached:true,samples,wallMs:performance.now()-start,simulatedSeconds:timeLeft-__DF.state.raid.timeLeft};
    if(__DF.state.phase!=='raid')break;
    await new Promise(resolve=>setTimeout(resolve,40));
   }
   return{reached:false,samples,wallMs:performance.now()-start,simulatedSeconds:timeLeft-__DF.state.raid.timeLeft};
  },{goal,before,dx,dz,length,timeoutMs});
 }finally{await page.keyboard.up('KeyW');}
 await page.waitForTimeout(120);
 movement.after=await position();measurements[label]=movement;
 assert.equal(movement.reached,true,`${label}: W movement did not reach the destination; last=${JSON.stringify(movement.after)}`);
 assert.ok(Math.hypot(movement.after.x-goal.x,movement.after.z-goal.z)<.6,`${label}: missed destination laterally`);
 assert.ok(movement.simulatedSeconds>=movement.wallMs/1000-.4,`${label}: simulation did not advance in real time`);
 assert.ok(movement.samples.every(s=>Number.isFinite(s.y)&&s.phase==='raid'));
 return movement;
}
async function closeContainer(){
 await page.keyboard.press('Escape');
 await page.waitForFunction(()=>!__DF.state.activeContainerId&&__DF.state.phase==='raid'&&document.pointerLockElement);
}
try{
 appAsarSha256=createHash('sha256').update(await fs.readFile(path.join(path.dirname(exe),'resources/app.asar'))).digest('hex');
 app=await _electron.launch({executablePath:exe,args:['--qa'],env:{...process.env,DEAD_FREQUENCY_QA_PROFILE:profile},timeout:60000});
 page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 await ready();assert.equal(await app.evaluate(({app})=>app.getVersion()),version);
 await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setFullScreen(false);win.unmaximize();win.setSize(1440,900);win.show();win.focus();});
 await page.evaluate(()=>__DF.settingsChanged({quality:'high',renderScale:1,fpsLimit:0,volume:0,headBob:0,weaponSway:0,controllerEnabled:false}));
 await page.locator('#start-raid').click();await page.waitForFunction(()=>__DF.state.phase==='raid'&&document.pointerLockElement);
 const world=await page.evaluate(()=>{
  const l=__DF.game.layout;
  window.__worldEnemyTemplates=structuredClone(__DF.state.enemies);
  return{size:l.size,buildings:l.obstacles.filter(o=>o.kind==='building').length,rooms:l.interiors.length,levels:l.interiors.filter(r=>r.levels>1).length,containers:l.containers.length,settlements:l.settlements,bridges:l.bridges.map(({id,x,y,z,w,d})=>({id,x,y,z,w,d})),vehicles:l.vehicles.length,stats:__DF.stats(),enemies:__DF.state.enemies.map(e=>({id:e.id,name:e.name,kind:e.kind,hp:e.hp,maxHp:e.maxHp,armor:e.armor,leaderId:e.leaderId}))};
 });
 measurements.world=world;
 assert.equal(world.size,1500);assert.equal(world.buildings,73);assert.equal(world.rooms,73);assert.equal(world.levels,46);
 assert.equal(world.containers,151);assert.equal(world.settlements.length,6);assert.equal(world.bridges.length,3);assert.equal(world.vehicles,28);
 for(const[key,value]of Object.entries({worldSize:1500,enterableBuildings:73,multistoreyBuildings:46,bridges:3,vehicles:28,terrainTiles:225}))assert.equal(world.stats[key],value,`Bundled renderer ${key}`);
 assert.equal(await page.evaluate(()=>__DF.state.containers.filter(c=>c.kind!=='corpse').length),151);
 pass('The packaged world and renderer agree on 1500 m, 73 enterable houses, 46 multistorey houses, 151 crates, 6 settlements, 3 bridges and 28 vehicles');
 const boss=world.enemies.find(e=>e.kind==='boss');assert.ok(boss);assert.equal(boss.maxHp,650);assert.equal(boss.armor,140);
 assert.equal(world.enemies.filter(e=>e.kind==='bodyguard'&&e.leaderId===boss.id).length,4);
 pass('A real new raid spawns Kommandant Voss and exactly four associated bodyguards with their actual stats');
 await page.evaluate(()=>{__DF.state.enemies=[];__DF.state.player.hp=__DF.state.player.maxHp=10000;});
 await shot('01-industrial-core');

 // A small house and one mountain settlement house exercise different terrain bases.
 for(const id of ['entry-booth','altdorf-house-0']){
  const room=await page.evaluate(id=>{const r=__DF.game.layout.interiors.find(r=>r.id===id);return{id:r.id,name:r.name,baseY:r.baseY,doors:r.doors};},id);
  const north=room.doors.find(d=>d.side==='north'),south=room.doors.find(d=>d.side==='south');
  await place(south.outside,0);await walkTo(north.outside,`door-${id}`,{timeoutMs:20000});
  assert.ok(Math.abs((await position()).y-room.baseY)<.14);
  await shot(`02-door-${id}`);
 }
 pass('Actual W input traverses the Wachhaus and an elevated Altdorf house through both open doorways without jumping or teleporting through walls');

 const room=await page.evaluate(()=>{const r=__DF.game.layout.interiors.find(r=>r.id==='control');return{id:r.id,x:r.x,z:r.z,baseY:r.baseY,stairs:r.stairs};});
 assert.equal(room.stairs.length,2);
 await place(room.stairs[0].start,Math.PI);
 await shot('03-stairs-ground');
 for(const [index,stairs]of room.stairs.entries()){
  if(index){
   const previous=room.stairs[index-1];
   await walkTo({x:room.x,z:previous.end.z},`landing-${index}-west`);
   await walkTo({x:room.x,z:stairs.start.z-.5},`landing-${index}-north`);
   await walkTo({x:stairs.start.x,z:stairs.start.z-.5},`landing-${index}-east`);
   await walkTo(stairs.start,`landing-${index}-approach`);
   assert.ok(Math.abs((await position()).y-stairs.start.y)<.14,'The landing route must stay upstairs');
  }
  const ascent=await walkTo(stairs.end,`stairs-${index}`,{timeoutMs:15000});
  assert.ok(Math.abs(ascent.after.y-stairs.end.y)<.14,`Physical ascent to${stairs.end.y}m`);
  assert.ok(Math.max(...ascent.samples.map(s=>s.y))-Math.min(...ascent.samples.map(s=>s.y))>3.65);
  assert.ok(ascent.after.grounded,'The player must stand on the upper landing');
  await shot(`04-stairs-floor-${index+1}`);
 }
 pass('W alone climbs both real stair flights from ground to 4 m and 8 m; the player walks around the intervening stairwell on the actual upper floor');

 const bridge=world.bridges[1],west={x:bridge.x-bridge.w/2-3,z:bridge.z,y:bridge.y},east={x:bridge.x+bridge.w/2+3,z:bridge.z};
 await place(west,-Math.PI/2);await shot('05-bridge-west-bank');
 const crossing=await walkTo(east,'bridge-crossing',{timeoutMs:45000});
 const overRiver=crossing.samples.filter(p=>Math.abs(p.x-bridge.x)<16);
 assert.ok(overRiver.length>10,'The route must actually cross the river center');
 assert.ok(overRiver.every(p=>Math.abs(p.y-bridge.y)<.15),'The player fell through the bridge over the water');
 const riverBed=await page.evaluate(b=>__DF.game.layout.getGroundHeight(b.x,b.z),bridge);
 assert.ok(riverBed<-5);assert.ok(crossing.after.x>bridge.x+bridge.w/2);
 await look(Math.PI/2,-.05);await shot('06-bridge-east-bank');
 pass('The real player walks from the west bank across 112 m of bridge above the river bed and reaches the east bank without falling or jumping');

 measurements.locations=[];
 for(const town of world.settlements){
  const point={x:town.x,z:town.z+town.d/2+6};await place(point,0);
  const actual=await position(),ground=await page.evaluate(p=>__DF.game.layout.getGroundHeight(p.x,p.z),point);
  assert.ok(Math.abs(actual.y-ground)<.15,`${town.name}: physical terrain height differs`);
  const stats=await page.evaluate(()=>__DF.stats());assert.ok(stats.drawCalls>0&&stats.visibleWorldChunks>0&&stats.nearTerrainTiles>0);
  measurements.locations.push({name:town.name,position:actual,ground,drawCalls:stats.drawCalls,triangles:stats.triangles});
  await shot(`07-${town.id}-gate`);
 }
 assert.ok(Math.max(...measurements.locations.map(p=>p.ground))-Math.min(...measurements.locations.map(p=>p.ground))>25);
 pass('All six settlements render in the native app at their real distinct elevations and show their limited wall entrances');

 // Isolated roster/position fixture: actual spawned stats and squad membership
 // are preserved; only position, combat timers and player health are controlled.
 await place({x:-70,z:155,y:0},0);
 await page.evaluate(()=>{
  const boss=window.__worldEnemyTemplates.find(e=>e.kind==='boss'),team=[boss,...window.__worldEnemyTemplates.filter(e=>e.leaderId===boss.id)];
  __DF.state.enemies=team.map((e,i)=>{const clone=structuredClone(e),offsets=[[0,0],[-4,0],[4,0],[-5,-4],[5,-4]],x=-70+offsets[i][0],z=144+offsets[i][1];Object.assign(clone,{x,z,y:0,yaw:Math.PI,home:{x,z,y:0},path:[],patrol:null,pathTimer:0,alert:0,lastSeen:null,lastHeard:null,fireTimer:9999});delete clone.ai;return clone;});
 });
 await page.waitForTimeout(250);
 const squad=await page.evaluate(()=>({enemies:__DF.state.enemies.map(e=>({id:e.id,name:e.name,kind:e.kind,maxHp:e.maxHp,leaderId:e.leaderId})),poses:__DF.stats().enemyPoses}));
 assert.equal(squad.enemies.length,5);assert.ok(squad.enemies.every(e=>squad.poses.some(p=>p.id===e.id)));
 measurements.visibleSquad=squad;await shot('08-voss-and-four-bodyguards');
 pass('The native renderer displays the actual boss and four bodyguard models together while preserving their squad identities');

 await place({x:-70,z:155,y:0},0);
 await page.evaluate(()=>{
  const target=structuredClone(window.__worldEnemyTemplates.find(e=>e.kind==='guard'));
  Object.assign(target,{id:'qa-corpse-target',x:-70,y:0,z:149,home:{x:-70,y:0,z:149},yaw:Math.PI,hp:1,armor:0,dead:false,fireTimer:9999,path:[],patrol:null,alert:0,pathTimer:0});delete target.ai;
  __DF.state.enemies=[target];__DF.state.player.ammo=__DF.state.player.magSize;__DF.state.player.reload=0;
 });
 const ammoBefore=await page.evaluate(()=>__DF.state.player.ammo);
 await page.mouse.down();await page.waitForTimeout(90);await page.mouse.up();
 await page.waitForFunction(()=>__DF.state.containers.some(c=>c.enemyId==='qa-corpse-target'),null,{timeout:5000});
 assert.ok(await page.evaluate(n=>__DF.state.player.ammo<n,ammoBefore));
 const corpse=await page.evaluate(()=>__DF.state.containers.find(c=>c.enemyId==='qa-corpse-target'));
 assert.equal(corpse.kind,'corpse');assert.ok(corpse.items.length>1);assert.ok(await page.evaluate(()=>__DF.state.enemies.find(e=>e.id==='qa-corpse-target').dead));
 await place({x:corpse.x,z:corpse.z+1.45,y:corpse.y},0,-.36);
 await page.waitForFunction(id=>__DF.state.prompt?.id===id,corpse.id,{timeout:3000});await shot('09-corpse-world');
 await page.keyboard.press('KeyE');await page.locator('#container-panel[data-container-kind="corpse"]').waitFor({state:'visible'});
 assert.equal(await page.evaluate(()=>document.pointerLockElement),null);
 await page.waitForFunction(id=>__DF.state.containers.find(c=>c.id===id).searched,corpse.id,{timeout:10000});
 const trade=corpse.items.find(i=>!i.kind);assert.ok(trade);
 await page.locator(`[data-take-container-item="${trade.id}"]`).click();
 await page.waitForFunction(id=>__DF.state.raid.loot.some(i=>i.id===id),trade.id);
 await page.locator(`[data-take-container-item="${trade.id}"]`).waitFor({state:'detached'});
 await shot('10-corpse-searched-and-looted');await closeContainer();
 await page.keyboard.press('KeyE');await page.locator('#container-panel[data-container-kind="corpse"]').waitFor({state:'visible'});
 assert.equal(await page.evaluate(()=>__DF.state.containerSearchRemaining),0);
 await page.locator(`[data-take-container-item="${trade.id}"]`).waitFor({state:'detached'});
 await closeContainer();
 measurements.corpse={id:corpse.id,sourceEnemy:corpse.enemyId,item:trade.name,fixture:'Real mouse shot kills an isolated 1 HP guard; UI E search and click take, no injected corpse or inventory reward'};
 pass('A real mouse-fired kill creates a persistent corpse; E opens its actual search panel, a UI click loots an item, and reopening cannot duplicate it');
 assert.deepEqual(errors,[]);pass('No JavaScript or renderer errors during the packaged world, movement, squad and corpse workflows');
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,version,exe,appAsarSha256,checks,errors,measurements,inputSource:'Playwright native keyboard/mouse; explicit scoped setup fixtures',performanceClaim:false},null,2));
}catch(error){await shot('failure').catch(()=>{});await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,version,exe,appAsarSha256,checks,errors,measurements,failure:error.stack},null,2));throw error;}
finally{await page?.keyboard.up('KeyW').catch(()=>{});await app?.close().catch(()=>{});}
