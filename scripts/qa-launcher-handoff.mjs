import {_electron,chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),version=JSON.parse(await fs.readFile('package.json','utf8')).version;
const root=await fs.mkdtemp(path.join(os.tmpdir(),'dead-frequency-handoff-'));
const bootstrap=path.join(root,'bootstrap'),profile=path.join(root,'profile'),out=path.resolve(`../qa-launcher-handoff-${version}`);
const baselineExe=process.env.DF_QA_BASELINE_EXE?path.resolve(process.env.DF_QA_BASELINE_EXE):null;
await fs.mkdir(out,{recursive:true});
if(!baselineExe){
  await fs.cp('.package-stage',bootstrap,{recursive:true});
  const metadata=JSON.parse(await fs.readFile(path.join(bootstrap,'package.json'),'utf8'));metadata.version='1.2.2';
  await fs.writeFile(path.join(bootstrap,'package.json'),JSON.stringify(metadata));
}
const env={...process.env,DEAD_FREQUENCY_QA_PROFILE:profile};
const launchOptions=mode=>baselineExe?{executablePath:baselineExe,args:['--qa',mode],env,timeout:45000}:{args:[bootstrap,'--qa',mode],env,timeout:45000};
const checks=[],phases=[],errors=[];let initial,updating,browser,baselineVersion,expectedSettings,expectedInventory,legacyUpgradeMigration=false;
const pass=name=>{checks.push(name);console.log('PASS',name);};
try{
  initial=await _electron.launch(launchOptions('--play'));let page=await initial.firstWindow();
  await page.waitForFunction(()=>window.__DF&&document.documentElement.dataset.ready==='true',null,{timeout:60000});
  baselineVersion=await initial.evaluate(({app})=>app.getVersion());
  legacyUpgradeMigration=await page.evaluate(()=>{
    if(__DF.state.profile.progression)return false;
    __DF.state.profile.upgrades={armor:2,backpack:1,weapon:3};__DF.persist();return true;
  });
  expectedInventory=await page.evaluate(()=>{
    const p=__DF.state.profile,e=__DF.economy;
    const goods=e.createItem(p,{name:'Quantenprozessor',value:780,rarity:'epic'});p.stash.push(goods);
    const sold=e.createItem(p,{name:'Funkmodul',value:340,rarity:'rare'});
    p.mailbox.push({id:`mail-${p.nextItemId++}`,type:'sale',item:sold,credits:1200,reason:'Verkauft',createdAt:Date.now()});
    __DF.game.selectWeapon?.('RV-6');__DF.game.unlockSkill?.('weapon-1');__DF.persist();
    return {stash:p.stash,intake:p.intake,mailbox:p.mailbox,...(p.progression?{progression:p.progression,selectedWeapon:p.selectedWeapon}:{})};
  });
  expectedSettings=await page.evaluate(()=>{
    __DF.state.profile.credits=3456;__DF.persist();
    const chosen={sensitivity:1.25,volume:.4,quality:'medium',fov:90};
    if(__DF.settings.bindings)Object.assign(chosen,{headBob:.35,crosshairColor:'#75dce8',bindings:{...__DF.settings.bindings,forward:'KeyZ'}});
    // Keep the old runtime consistent with the seed, including delayed native
    // fullscreen events that legitimately persist current settings.
    Object.assign(__DF.settings,chosen);
    localStorage.setItem('dead-frequency.settings.v1',JSON.stringify(__DF.settings));return chosen;
  });await initial.close();initial=null;
  pass(baselineExe?'The actual previously released EXE has an isolated player save and old settings':'An isolated older-version bootstrap has an existing player save');
  updating=await _electron.launch(launchOptions('--qa-launcher'));page=await updating.firstWindow();
  let rejectFallback;
  const fallback=new Promise((_,reject)=>{rejectFallback=reject;});fallback.catch(()=>{});
  await page.exposeFunction('recordUpdatePhase',phase=>{
    if(phases.at(-1)!==phase){phases.push(phase);console.log('UPDATE',phase);}
    if(phase==='fallback')rejectFallback(new Error('Live update fell back instead of installing the published version'));
  });
  await page.evaluate(()=>window.launcher.onProgress(event=>window.recordUpdatePhase(event.phase)));
  page.on('pageerror',error=>errors.push(error.message));
  await page.screenshot({path:path.join(out,'01-launcher-checking.png')});
  await Promise.race([updating.waitForEvent('close',{timeout:180000}),fallback]);updating=null;
  pass('The launcher downloads and exits for automatic handoff without any button click');
  const deadline=Date.now()+45000;
  while(Date.now()<deadline){
    try{
      const port=Number((await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);
      browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:1500});
      page=browser.contexts()[0]?.pages()[0];
      if(page&&decodeURI(page.url()).replaceAll('\\','/').includes(`/updates/versions/${version}/`))break;
      await browser.close();browser=null;
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  assert.ok(browser,'Updated game did not relaunch automatically');
  await page.waitForFunction(()=>window.__DF&&document.documentElement.dataset.ready==='true',null,{timeout:60000});
  assert.equal(await page.evaluate(()=>__DF.state.profile.credits),3456);pass('The newly installed GitHub version starts automatically and preserves the player save');
  const updatedProfile=await page.evaluate(()=>__DF.state.profile);
  for(const [key,value] of Object.entries(expectedInventory))assert.deepEqual(updatedProfile[key],value,key);
  pass('Existing secured item values, settled mail and any learned skills and weapon selection survive the real update unchanged');
  if(legacyUpgradeMigration){
    const unlocked=await page.evaluate(()=>__DF.state.profile.progression.unlocked);
    assert.deepEqual([...unlocked].sort(),['armor-1','armor-2','backpack-1','weapon-1','weapon-2','weapon-3'].sort());
    await page.locator('#tab-skills').click();assert.match(await page.locator('#skill-points').innerText(),/3/);await page.locator('#tab-deploy').click();
    pass('Six previously purchased permanent upgrade ranks migrate to the new tree with three available starter points');
  }
  const settings=await page.evaluate(()=>__DF.settings);
  for(const [key,value] of Object.entries(expectedSettings))assert.deepEqual(settings[key],value,key);
  pass('Existing settings, including customized motion, crosshair and bindings when supported, survive the automatic update');
  assert.equal(await page.evaluate(()=>__DF.state.phase),'hub');
  await page.screenshot({path:path.join(out,'02-updated-game.png')});
  for(const phase of ['downloading','verifying','extracting','starting'])assert.ok(phases.includes(phase),`Missing update phase ${phase}`);
  const {runUpdater}=require('../launcher/updater.cjs');
  const offline=await runUpdater({currentVersion:baselineVersion,bundledExe:baselineExe||require('electron'),installRoot:path.join(profile,'updates'),repository:'easycrashx-nex/dead-frequency',transport:async()=>{throw new Error('Explicit QA offline simulation');}});
  assert.equal(offline.source,'installed');assert.equal(offline.version,version);assert.equal(offline.fallback,true);pass('With the network unavailable the fully reverified installed version is selected');
  const manifest=JSON.parse(await fs.readFile(path.join(path.dirname(offline.exe),'update-manifest.json'),'utf8'));assert.equal(manifest.version,version);
  assert.deepEqual(errors,[]);pass('Launcher reports no JavaScript errors');
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,liveGitHub:true,baselineVersion,actualReleasedBaseline:!!baselineExe,version,checks,phases,errors,automaticRelaunch:true,preservedCredits:3456,preservedInventory:true,preservedProgression:!!expectedInventory.progression,preservedSettings:true,preservedSettingKeys:Object.keys(expectedSettings),legacyUpgradeMigration,offlineVersion:offline.version},null,2));
}catch(error){await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,liveGitHub:true,version,checks,phases,errors,failure:error.stack,temporaryRoot:root},null,2));throw error;}
finally{
  if(browser){for(const page of browser.contexts().flatMap(context=>context.pages()))await page.close().catch(()=>{});await browser.close().catch(()=>{});}
  await initial?.close().catch(()=>{});await updating?.close().catch(()=>{});
  // Only the unique directory created above is removed; never a real profile.
  if(path.dirname(root)===path.resolve(os.tmpdir())&&path.basename(root).startsWith('dead-frequency-handoff-'))await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:250}).catch(()=>{});
}
