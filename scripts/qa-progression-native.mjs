import {_electron} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {WEAPONS} from '../src/weapons.js';
import {SKILL_NODES,getProgression,getSkillEffects} from '../src/progression.js';

const version=JSON.parse(await fs.readFile('package.json','utf8')).version;
const exe=process.env.DF_EXE||path.resolve(`../../outputs/v${version}/DEAD FREQUENCY-win32-x64/DEAD FREQUENCY.exe`);
const out=path.resolve(`../qa-progression-native-${version}`);await fs.mkdir(out,{recursive:true});
const profile=await fs.mkdtemp(path.join(out,'profile-'));
const checks=[],errors=[],weapons=[];let app,page;
const pass=name=>{checks.push(name);console.log('PASS',name);};
const profileState=()=>page.evaluate(()=>__DF.state.profile);
try{
  app=await _electron.launch({executablePath:exe,args:['--qa'],env:{...process.env,DEAD_FREQUENCY_QA_PROFILE:profile},timeout:45000});
  page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.waitForFunction(()=>window.__DF&&document.documentElement.dataset.ready==='true',null,{timeout:60000});
  assert.equal(await app.evaluate(({app})=>app.getVersion()),version);
  // Keep the outgoing runtime consistent with the old save: unload and visibility
  // events both legitimately persist the active profile before the next boot.
  await page.evaluate(()=>{Object.assign(__DF.state.profile,{credits:25000,raids:8,extracts:3,upgrades:{armor:2,backpack:1,weapon:2}});delete __DF.state.profile.progression;delete __DF.state.profile.selectedWeapon;__DF.persist();});
  await page.reload();await page.waitForFunction(()=>window.__DF&&document.documentElement.dataset.ready==='true');
  let saved=await profileState(),progress=getProgression(saved);
  assert.equal(saved.credits,25000);assert.equal(progress.availablePoints,3);
  for(const id of ['armor-1','armor-2','backpack-1','weapon-1','weapon-2'])assert.ok(progress.unlocked.includes(id));
  pass('An actual legacy save migrates paid armor, backpack and weapon ranks without losing credits or starter skill points');
  await page.locator('#tab-skills').click();
  assert.equal(await page.locator('[data-skill-node]').count(),24);
  await page.locator('[data-skill-branch="combat"]').click();await page.locator('[data-skill-node="combat-master"]').click();
  assert.equal(await page.locator('#unlock-skill').isEnabled(),false);
  await page.locator('[data-skill-node="weapon-3"]').click();await page.locator('#unlock-skill').click();
  await page.waitForFunction(()=>__DF.state.profile.progression.unlocked.includes('weapon-3'));
  await page.locator('[data-skill-branch="field"]').click();await page.locator('[data-skill-node="endurance"]').click();await page.locator('#unlock-skill').click();
  await page.waitForFunction(()=>__DF.state.profile.progression.unlocked.includes('endurance'));
  await page.locator('[data-skill-node="triage"]').click();await page.locator('#unlock-skill').click();
  await page.waitForFunction(()=>__DF.state.profile.progression.unlocked.includes('triage'));
  await page.locator('[data-skill-node="breathing"]').click();assert.equal(await page.locator('#unlock-skill').isEnabled(),false);
  assert.equal(getProgression(await profileState()).availablePoints,0);
  pass('Real skill controls enforce prerequisites, spend points exactly once and disable unaffordable skills');
  // Deterministic earned-XP fixture gives enough points to exercise every graph node.
  await page.evaluate(()=>{__DF.state.profile.progression.xp=8000;__DF.persist();});
  for(const skill of SKILL_NODES){
    if((await profileState()).progression.unlocked.includes(skill.id))continue;
    await page.locator(`[data-skill-branch="${skill.branch}"]`).click();
    await page.locator(`[data-skill-node="${skill.id}"]`).click();await page.locator('#unlock-skill').click();
    await page.waitForFunction(id=>__DF.state.profile.progression.unlocked.includes(id),skill.id);
  }
  assert.equal((await profileState()).progression.unlocked.length,24);
  for(const branch of ['combat','protection','field','logistics']){
    await page.locator(`[data-skill-branch="${branch}"]`).click();await page.screenshot({path:path.join(out,`tree-${branch}.png`)});
  }
  pass('All 24 connected skills can be learned through the real four-branch tree');
  const effects=getSkillEffects(await profileState());
  for(const weapon of WEAPONS){
    await page.locator('#tab-arsenal').click();await page.locator(`[data-select-weapon="${weapon.id}"]`).click();
    await page.waitForFunction(id=>__DF.state.profile.selectedWeapon===id,weapon.id);
    const credits=(await profileState()).credits;
    await page.locator('#tab-deploy').click();await page.locator('#start-raid').click();
    await page.waitForFunction(()=>__DF.state.phase==='raid'&&document.pointerLockElement);
    await page.evaluate(()=>{window.__weaponEnemy=structuredClone(__DF.state.enemies[0]);__DF.state.enemies=[];__DF.game.teleport(-142,130);__DF.state.player.yaw=0;__DF.state.player.pitch=0;__DF.syncLook();});
    const initial=await page.evaluate(()=>({...__DF.state.player}));
    assert.equal(initial.weapon,weapon.id);assert.equal(initial.ammo,weapon.magSize);
    assert.equal((await profileState()).credits,credits-weapon.cost);
    assert.equal(initial.maxHp,120);assert.equal(initial.hp,120);assert.equal(initial.maxStamina,130);
    assert.equal(await page.evaluate(()=>__DF.state.raid.capacity),14);
    assert.ok(Math.abs(initial.recoilMultiplier-.85)<1e-8);
    await page.waitForTimeout(180);
    const stats=await page.evaluate(()=>__DF.stats());assert.equal(stats.weaponId,weapon.id);assert.equal(stats.weaponModel,weapon.model);
    await page.screenshot({path:path.join(out,`${weapon.id}-hip.png`)});
    await page.mouse.down({button:'right'});await page.waitForTimeout(260);await page.screenshot({path:path.join(out,`${weapon.id}-ads.png`)});await page.mouse.up({button:'right'});
    await page.mouse.down();await page.waitForTimeout(weapon.automatic?420:weapon.fireInterval*1000+250);await page.mouse.up();
    const after=await page.evaluate(()=>__DF.state.player.ammo),fired=initial.ammo-after;
    if(weapon.automatic)assert.ok(fired>=2,`${weapon.id}: automatic burst`);else assert.equal(fired,1,`${weapon.id}: one shot per press`);
    await page.waitForTimeout(weapon.fireInterval*1000+70);
    await page.mouse.down();await page.mouse.up();await page.waitForFunction(ammo=>__DF.state.player.ammo===ammo-1,after);
    const beforeReload=await page.evaluate(()=>({ammo:__DF.state.player.ammo,reserve:__DF.state.player.reserve}));
    await page.keyboard.press('KeyR');await page.waitForFunction(()=>__DF.state.player.reload>0);
    const duration=await page.evaluate(()=>__DF.state.player.reloadDuration);
    assert.ok(Math.abs(duration-weapon.reloadSeconds*effects.reloadMultiplier)<.001);
    await page.waitForTimeout(duration*300);await page.screenshot({path:path.join(out,`${weapon.id}-reload.png`)});
    await page.waitForFunction(()=>__DF.state.player.reload===0,null,{timeout:7000});
    assert.equal(await page.evaluate(()=>__DF.state.player.ammo),weapon.magSize);
    assert.equal(await page.evaluate(()=>__DF.state.player.reserve),beforeReload.reserve-(weapon.magSize-beforeReload.ammo));
    const xpBefore=(await profileState()).progression.xp;
    await page.evaluate(()=>{const p=__DF.state.player;__DF.state.enemies=[{...window.__weaponEnemy,id:'qa-weapon-target',kind:'guard',x:-142,z:125,y:0,hp:1,dead:false,fireTimer:9999,pathTimer:9999,alert:0}];p.yaw=0;p.pitch=0;__DF.syncLook();});
    await page.mouse.down();await page.mouse.up();await page.waitForFunction(()=>__DF.state.enemies[0].dead,null,{timeout:3000});
    assert.equal((await profileState()).progression.xp,xpBefore+50);
    weapons.push({id:weapon.id,model:stats.weaponModel,automatic:weapon.automatic,burstShots:fired,magSize:weapon.magSize,reloadDuration:duration});
    pass(`${weapon.id}: selected model, real fire mode, second trigger, trained reload, damage and personal combat XP`);
    await page.evaluate(()=>__DF.game.endRaid('QA complete'));await page.waitForFunction(()=>__DF.state.phase==='dead');
    assert.equal((await profileState()).progression.xp,xpBefore+50);
    await page.locator('#result-hub').click();await page.waitForFunction(()=>__DF.state.phase==='hub');
  }
  pass('Learned health, stamina, recoil and backpack effects are applied in actual raids; earned combat XP survives death');
  saved=await profileState();await page.reload();await page.waitForFunction(()=>window.__DF&&document.documentElement.dataset.ready==='true');
  assert.deepEqual((await profileState()).progression,saved.progression);assert.equal((await profileState()).selectedWeapon,'RV-6');
  pass('All learned skills, XP and weapon selection survive reopening the packaged game');
  assert.deepEqual(errors,[]);pass('No JavaScript or renderer errors in native weapon and progression checks');
  const appAsarSha256=createHash('sha256').update(await fs.readFile(path.join(path.dirname(exe),'resources/app.asar'))).digest('hex');
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,exe,version,appAsarSha256,checks,errors,weapons,skillCount:SKILL_NODES.length,migratedLegacyRanks:5},null,2));
}catch(error){await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,exe,version,checks,errors,weapons,failure:error.stack},null,2));throw error;}
finally{await app?.close().catch(()=>{});}
