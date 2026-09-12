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
const checks=[],phases=[],errors=[];let initial,updating,browser,baselineVersion;
const pass=name=>{checks.push(name);console.log('PASS',name);};
try{
  initial=await _electron.launch(launchOptions('--play'));let page=await initial.firstWindow();
  await page.waitForFunction(()=>window.__DF&&document.documentElement.dataset.ready==='true',null,{timeout:60000});
  baselineVersion=await initial.evaluate(({app})=>app.getVersion());
  await page.evaluate(()=>{__DF.state.profile.credits=3456;__DF.persist();localStorage.setItem('dead-frequency.settings.v1',JSON.stringify({sensitivity:1.25,volume:.4,quality:'medium',fov:90}));});await initial.close();initial=null;
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
  const settings=await page.evaluate(()=>__DF.settings);
  for(const [key,value] of Object.entries({sensitivity:1.25,volume:.4,quality:'medium',fov:90}))assert.equal(settings[key],value);
  pass('Existing sensitivity, volume, graphics profile and field of view survive the automatic update');
  assert.equal(await page.evaluate(()=>__DF.state.phase),'hub');
  await page.screenshot({path:path.join(out,'02-updated-game.png')});
  for(const phase of ['downloading','verifying','extracting','starting'])assert.ok(phases.includes(phase),`Missing update phase ${phase}`);
  const {runUpdater}=require('../launcher/updater.cjs');
  const offline=await runUpdater({currentVersion:baselineVersion,bundledExe:baselineExe||require('electron'),installRoot:path.join(profile,'updates'),repository:'easycrashx-nex/dead-frequency',transport:async()=>{throw new Error('Explicit QA offline simulation');}});
  assert.equal(offline.source,'installed');assert.equal(offline.version,version);assert.equal(offline.fallback,true);pass('With the network unavailable the fully reverified installed version is selected');
  const manifest=JSON.parse(await fs.readFile(path.join(path.dirname(offline.exe),'update-manifest.json'),'utf8'));assert.equal(manifest.version,version);
  assert.deepEqual(errors,[]);pass('Launcher reports no JavaScript errors');
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,liveGitHub:true,baselineVersion,actualReleasedBaseline:!!baselineExe,version,checks,phases,errors,automaticRelaunch:true,preservedCredits:3456,preservedSettings:true,offlineVersion:offline.version},null,2));
}catch(error){await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,liveGitHub:true,version,checks,phases,errors,failure:error.stack,temporaryRoot:root},null,2));throw error;}
finally{
  if(browser){for(const page of browser.contexts().flatMap(context=>context.pages()))await page.close().catch(()=>{});await browser.close().catch(()=>{});}
  await initial?.close().catch(()=>{});await updating?.close().catch(()=>{});
  // Only the unique directory created above is removed; never a real profile.
  if(path.dirname(root)===path.resolve(os.tmpdir())&&path.basename(root).startsWith('dead-frequency-handoff-'))await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:250}).catch(()=>{});
}
