import {_electron} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const version=JSON.parse(await fs.readFile('package.json','utf8')).version;
const exe=process.env.DF_EXE||path.resolve(`../../outputs/v${version}/DEAD FREQUENCY-win32-x64/DEAD FREQUENCY.exe`);
const internet=process.env.DF_QA_LAN!=='1';
const out=path.resolve(`../qa-coop-native-${version}${internet?'':'-lan'}`);await fs.mkdir(out,{recursive:true});
const apps=[],pages=[],checks=[],errors=[];const pass=name=>{checks.push(name);console.log('PASS',name);};
async function boot(label){
  const profile=await fs.mkdtemp(path.join(out,label+'-profile-'));
  const app=await _electron.launch({executablePath:exe,args:['--qa'],env:{...process.env,DEAD_FREQUENCY_QA_PROFILE:profile},timeout:45000});apps.push(app);
  const page=await app.firstWindow();pages.push(page);page.on('pageerror',e=>errors.push(label+': '+e.message));page.on('console',m=>{if(m.type()==='error')errors.push(label+': '+m.text());});
  await page.waitForFunction(()=>window.__DF&&document.documentElement.dataset.ready==='true',null,{timeout:60000});
  assert.equal(await app.evaluate(({app})=>app.getVersion()),version);return {app,page,profile};
}
try{
  const host=await boot('host'),guest=await boot('guest');pass('Two packaged Windows clients boot with isolated persistent profiles');
  for(const [client,weapon] of [[host,'SG-8'],[guest,'DMR-7']]){
    await client.page.locator('#tab-arsenal').click();await client.page.locator(`[data-select-weapon="${weapon}"]`).click();await client.page.locator('#tab-deploy').click();
  }
  await host.page.locator('#coop-open').click();await host.page.locator('#coop-name').fill('Alpha');
  if(!internet){await host.page.locator('.coop-options summary').click();await host.page.locator('#coop-internet').uncheck();}
  await host.page.locator('#coop-connect').click();
  await host.page.waitForFunction(()=>__DF.coop?.info.status==='lobby'||document.querySelector('#coop-status-label')?.textContent==='VERBINDUNG UNTERBROCHEN',null,{timeout:100000});
  const hostStatus=await host.page.locator('#coop-status-message').innerText();
  assert.equal(await host.page.evaluate(()=>__DF.coop?.info.status),'lobby',hostStatus);
  const invite=await host.page.locator('#coop-share-invite').inputValue();assert.match(invite,internet?/^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/coop\?token=[a-f0-9]{64}$/:/^ws:\/\/[\d.]+:\d+\/coop\?token=[a-f0-9]{64}$/);pass(internet?'Host creates a reachable encrypted Internet invitation automatically':'Host creates a local network invitation');
  await host.page.locator('#coop-copy').click();assert.equal(await host.app.evaluate(({clipboard})=>clipboard.readText()),invite);pass('The real Copy button copies the complete invitation');
  await guest.page.locator('#coop-open').click();await guest.page.locator('#coop-mode-join').click();await guest.page.locator('#coop-name').fill('Bravo');await guest.page.locator('#coop-invite').fill(invite);await guest.page.locator('#coop-connect').click();
  await guest.page.waitForFunction(()=>__DF.coop?.info.players.length===2,null,{timeout:75000});await host.page.waitForFunction(()=>__DF.coop?.info.players.length===2);
  pass(internet?'The colleague joins the shared lobby through the public Internet endpoint':'The colleague joins the shared lobby through the local network endpoint');
  assert.equal(await host.page.locator('#coop-start').isEnabled(),false);await host.page.locator('#coop-ready').click();await guest.page.locator('#coop-ready').click();await host.page.waitForFunction(()=>__DF.coop?.info.players.every(p=>p.ready));
  await host.page.locator('#coop-start').click();
  for(const {page} of [host,guest])await page.waitForFunction(()=>['raid','paused'].includes(__DF.state.phase)&&__DF.state.teammates?.length===1,null,{timeout:20000});
  assert.equal(await host.page.evaluate(()=>__DF.state.raid.seed),await guest.page.evaluate(()=>__DF.state.raid.seed));pass('Only a ready team can start; both enter the same seeded raid');
  assert.equal(await host.page.evaluate(()=>__DF.state.player.weapon),'SG-8');assert.equal(await guest.page.evaluate(()=>__DF.state.player.weapon),'DMR-7');
  assert.equal(await host.page.evaluate(()=>__DF.state.teammates[0].weapon),'DMR-7');assert.equal(await guest.page.evaluate(()=>__DF.state.teammates[0].weapon),'SG-8');pass('Distinct shotgun and marksman loadouts selected in the arsenal survive the Internet lobby and replicate to the teammate');
  await host.app.evaluate(()=>{const members=[...global.__DF_HOST().players.values()];global.__DF_QAEnemy=structuredClone(members[0].game.state.enemies[0]);for(const member of members)member.game.state.enemies.splice(0);});
  await host.app.evaluate(()=>{
    const members=[...global.__DF_HOST().players.values()];members[0].game.teleport(-142,130);members[1].game.teleport(-10,-15);
    const guard={...global.__DF_QAEnemy,id:'qa-listener',x:-39,z:-15,y:0,yaw:-Math.PI/2,home:{x:-39,z:-15},dead:false,hp:95,fireTimer:9999,alert:0,lastSeen:null,lastHeard:null,path:[],pathTimer:0,flank:false,mode:'patrol'};
    delete guard.ai;delete guard.targetPlayerId;members[0].game.state.enemies.push(guard);
  });
  await guest.page.bringToFront();await guest.page.evaluate(()=>{__DF.resume();__DF.state.player.yaw=0;__DF.state.player.pitch=0;__DF.syncLook();});
  await guest.page.locator('#game').click().catch(()=>{});await guest.page.waitForFunction(()=>document.pointerLockElement);await guest.page.waitForTimeout(450);
  await guest.page.mouse.down();await guest.page.waitForTimeout(100);await guest.page.mouse.up();
  for(const {page} of [host,guest])await page.waitForFunction(()=>__DF.state.enemies.find(e=>e.id==='qa-listener')?.ai?.task==='investigate',null,{timeout:5000});
  const heard=await host.app.evaluate(()=>{const e=[...global.__DF_HOST().players.values()][0].game.state.enemies[0];return {lastSeen:e.lastSeen,lastHeard:e.lastHeard,x:e.x,z:e.z};});
  assert.equal(heard.lastSeen,null);assert.ok(heard.lastHeard);assert.equal(await guest.page.evaluate(()=>__DF.state.player.hp),100);
  await guest.page.waitForTimeout(1100);
  const searched=await host.app.evaluate(()=>{const e=[...global.__DF_HOST().players.values()][0].game.state.enemies[0];return {lastSeen:e.lastSeen,x:e.x,z:e.z};});
  assert.equal(searched.lastSeen,null);assert.ok(Math.hypot(searched.x-heard.x,searched.z-heard.z)>.5);
  const publicAI=await guest.page.evaluate(()=>__DF.state.enemies[0].ai);assert.deepEqual(Object.keys(publicAI).sort(),['role','task']);
  pass('A real shot by the second Windows player reaches the host AI through cover; both clients see its investigation without invented visual contact or exposed private memory');
  await host.app.evaluate(()=>{for(const member of global.__DF_HOST().players.values()){member.game.state.enemies.splice(0);member.game.teleport(-142,130);}});
  await guest.page.bringToFront();await guest.page.evaluate(()=>__DF.resume());await guest.page.locator('#game').click().catch(()=>{});
  await guest.page.waitForTimeout(350);const before=await guest.page.evaluate(()=>__DF.state.player.z);
  await guest.page.keyboard.down('KeyW');await guest.page.keyboard.down('ShiftLeft');await guest.page.waitForTimeout(800);await guest.page.keyboard.up('KeyW');await guest.page.keyboard.up('ShiftLeft');
  await guest.page.waitForTimeout(300);const after=await guest.page.evaluate(()=>__DF.state.player.z);assert.ok(Math.abs(after-before)>1,`Movement ${before} -> ${after}`);
  const replicated=await host.page.evaluate(()=>__DF.state.teammates[0].z);assert.ok(Math.abs(replicated-after)<.7);pass('Real keyboard movement replicates between the two Windows clients');
  assert.equal(await host.page.evaluate(()=>__DF.stats().teammates),1);assert.equal(await guest.page.evaluate(()=>__DF.stats().teammates),1);pass('Both clients render the remote operator');
  await host.app.evaluate(()=>{const members=[...global.__DF_HOST().players.values()];members[0].game.teleport(-142,122);members[1].game.teleport(-142,130);});
  await guest.page.waitForTimeout(500);await guest.page.evaluate(()=>{__DF.state.player.yaw=0;__DF.state.player.pitch=0;__DF.syncLook();});await guest.page.waitForTimeout(200);
  await host.page.screenshot({path:path.join(out,'01-host-coop.png')});await guest.page.screenshot({path:path.join(out,'02-guest-coop.png')});
  const beforeTriggerAmmo=await guest.page.evaluate(()=>__DF.state.player.ammo);
  await guest.page.mouse.down();await guest.page.waitForTimeout(100);await guest.page.mouse.up();await guest.page.waitForTimeout(350);assert.equal(await host.page.evaluate(()=>__DF.state.player.hp),100);pass('Shooting directly at the teammate causes no friendly fire');
  await host.app.evaluate(()=>{const members=[...global.__DF_HOST().players.values()];members[0].game.teleport(-145,130);const enemy={...global.__DF_QAEnemy,id:'qa-guard',x:-142,z:118,y:0,hp:45,dead:false,fireTimer:9999,alert:10,lastSeen:{x:-142,z:130},mode:'attack',path:[],pathTimer:9999,flank:false};members[0].game.state.enemies.push(enemy);});
  await guest.page.waitForTimeout(350);await guest.page.mouse.down();await guest.page.waitForTimeout(250);await guest.page.mouse.up();
  for(const {page} of [host,guest])await page.waitForFunction(()=>__DF.state.enemies.find(e=>e.id==='qa-guard')?.dead,null,{timeout:5000});
  assert.equal(await guest.page.evaluate(()=>__DF.state.player.ammo),beforeTriggerAmmo-2);assert.equal(await host.page.evaluate(()=>__DF.state.player.ammo===__DF.state.player.magSize),true);pass('Two real semi-automatic trigger presses synchronize enemy damage and death while ammunition stays per player');
  await guest.page.keyboard.press('Escape');await guest.page.waitForFunction(()=>__DF.state.phase==='paused');const raidTime=await guest.page.evaluate(()=>__DF.state.raid.timeLeft);await guest.page.waitForTimeout(700);assert.ok(await guest.page.evaluate(t=>__DF.state.raid.timeLeft<t-.4,raidTime));pass('The shared raid continues while one player opens the local menu');
  await host.app.evaluate(()=>{for(const member of global.__DF_HOST().players.values())member.game.state.enemies.splice(0);});
  const interiorDoor=await host.app.evaluate(()=>{const members=[...global.__DF_HOST().players.values()];const room=members[0].game.layout.interiors.find(room=>room.id==='warehouse'),door=room.doors.find(door=>door.side==='south');members.forEach((member,index)=>member.game.teleport(door.outside.x+(index? .45:-.45),door.outside.z));return door;});
  await guest.page.waitForTimeout(500);
  for(const client of [host,guest]){
    await client.page.bringToFront();await client.page.evaluate(()=>{__DF.state.player.yaw=0;__DF.state.player.pitch=0;__DF.syncLook();__DF.resume();});
    await client.page.locator('#game').click().catch(()=>{});await client.page.waitForFunction(()=>document.pointerLockElement);
    await client.page.keyboard.down('KeyW');
    try{await client.page.waitForFunction(z=>__DF.state.player.z<z-1.25,interiorDoor.z,{timeout:10000});}finally{await client.page.keyboard.up('KeyW');}
  }
  await guest.page.waitForTimeout(400);
  const indoorPositions=await Promise.all([host.page.evaluate(()=>({self:__DF.state.player.z,partner:__DF.state.teammates[0].z})),guest.page.evaluate(()=>({self:__DF.state.player.z,partner:__DF.state.teammates[0].z}))]);
  assert.ok(indoorPositions.every(positions=>positions.self<interiorDoor.z-1&&positions.partner<interiorDoor.z-1));
  assert.ok(Math.abs(indoorPositions[0].partner-indoorPositions[1].self)<.7&&Math.abs(indoorPositions[1].partner-indoorPositions[0].self)<.7);
  pass('Both actual Windows players enter the warehouse through its doorway and see matching indoor partner positions');
  await guest.page.screenshot({path:path.join(out,'04-coop-interior.png')});
  const crate = await host.app.evaluate(()=>{const session=global.__DF_HOST(),primary=[...session.players.values()][0].game;const container=primary.state.containers.find(c=>c.id==='warehouse-parts');if(!container)throw new Error('No shared warehouse container');for(const member of session.players.values())member.game.teleport(container.x,container.z+container.d/2+.9);return container;});
  await host.page.waitForTimeout(500);
  await Promise.all([host.page.evaluate(()=>__DF.game.interact()),guest.page.evaluate(()=>__DF.game.interact())]);
  for(const {page} of [host,guest])await page.waitForFunction(id=>__DF.state.activeContainerId===id&&__DF.state.containers.find(c=>c.id===id).searched,crate.id);
  const inventories=await Promise.all([host.page.evaluate(id=>__DF.state.containers.find(c=>c.id===id).items,crate.id),guest.page.evaluate(id=>__DF.state.containers.find(c=>c.id===id).items,crate.id)]);
  assert.deepEqual(inventories[0],inventories[1]);pass('Both Windows players open and search the same warehouse crate with matching shared contents');
  const lootId=crate.items.find(item=>!item.kind).id;
  await Promise.all([host.page.evaluate(({id,item})=>__DF.game.takeContainerItem(id,item),{id:crate.id,item:lootId}),guest.page.evaluate(({id,item})=>__DF.game.takeContainerItem(id,item),{id:crate.id,item:lootId})]);await host.page.waitForTimeout(400);
  const bags=await Promise.all([host.page.evaluate(()=>__DF.state.raid.loot),guest.page.evaluate(()=>__DF.state.raid.loot)]);assert.equal(bags.flat().filter(x=>x.id===lootId).length,1);pass('Simultaneous container claims give the shared warehouse item to exactly one player');
  const owner=bags[0].some(x=>x.id===lootId)?host:guest,receiver=owner===host?guest:host;
  await Promise.all([host.page.evaluate(()=>__DF.game.closeContainer()),guest.page.evaluate(()=>__DF.game.closeContainer())]);
  await host.app.evaluate(()=>{for(const member of global.__DF_HOST().players.values())member.game.teleport(-7,48);});
  await owner.page.waitForTimeout(500);await owner.page.evaluate(id=>__DF.game.dropItem(id),lootId);await receiver.page.waitForTimeout(400);await receiver.page.evaluate(()=>__DF.game.interact());await receiver.page.waitForTimeout(400);
  assert.ok(await receiver.page.evaluate(id=>__DF.state.raid.loot.some(x=>x.id===id),lootId));assert.equal(await owner.page.evaluate(id=>__DF.state.raid.loot.some(x=>x.id===id),lootId),false);pass('A container-sourced backpack item can be dropped and picked up by the teammate without duplication');
  await host.app.evaluate(()=>{for(const member of global.__DF_HOST().players.values()){member.game.teleport(-47,46);member.game.state.loot.forEach(item=>{if(Math.hypot(item.x+47,item.z-46)<4)item.taken=true;});}});
  await host.page.waitForTimeout(500);const prompts=await Promise.all([host.page.evaluate(()=>__DF.state.prompt),guest.page.evaluate(()=>__DF.state.prompt)]);assert.ok(prompts.every(p=>p?.kind==='extract'),JSON.stringify(prompts));
  await Promise.all([host.page.evaluate(()=>__DF.game.interact()),guest.page.evaluate(()=>__DF.game.interact())]);
  for(const {page} of [host,guest])await page.waitForFunction(()=>__DF.state.phase==='extracted',null,{timeout:15000});pass('Both players complete the extraction timer in the shared raid');
  const recovered=await receiver.page.evaluate(()=>__DF.state.profile.intake);assert.ok(recovered.some(item=>item.name===bags.flat().find(x=>x.id===lootId).name));
  assert.equal(await owner.page.evaluate(()=>__DF.state.profile.intake.length),0);pass('Extracted loot goes only into its owner’s persistent intake');
  await host.page.screenshot({path:path.join(out,'03-coop-extraction.png')});
  await Promise.all([host.page.evaluate(()=>__DF.persist()),guest.page.evaluate(()=>__DF.persist())]);
  assert.deepEqual(errors,[]);pass('No JavaScript or renderer errors in the tested multiplayer flow');
  const appAsarSha256=createHash('sha256').update(await fs.readFile(path.join(path.dirname(exe),'resources/app.asar'))).digest('hex');
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,internet,exe,version,appAsarSha256,checks,errors},null,2));
}catch(error){for(let i=0;i<pages.length;i++)await pages[i].screenshot({path:path.join(out,`failure-${i}.png`)}).catch(()=>{});await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,internet,exe,version,checks,errors,failure:error.stack},null,2));throw error;}
finally{for(const app of apps.reverse())await app.close().catch(()=>{});}
