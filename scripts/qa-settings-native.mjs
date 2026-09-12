import {_electron} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SETTINGS_FIELDS,SETTINGS_CATEGORIES,BINDING_ACTIONS,defaultSettings} from '../src/settings.js';
const version=JSON.parse(await fs.readFile('package.json','utf8')).version;
const exe=process.env.DF_EXE||path.resolve(`../../outputs/v${version}/DEAD FREQUENCY-win32-x64/DEAD FREQUENCY.exe`);
const out=path.resolve(`../qa-settings-native-${version}`);await fs.mkdir(out,{recursive:true});
const profile=await fs.mkdtemp(path.join(out,'profile-'));
const checks=[],errors=[];let app,page;
const pass=name=>{checks.push(name);console.log('PASS',name);};
const ready=()=>page.waitForFunction(()=>window.__DF&&document.documentElement.dataset.ready==='true',null,{timeout:60000});
async function category(id){await page.locator(`[data-settings-category="${id}"]`).click();}
async function setField(field,value){
  await category(field.category);
  const input=page.locator(`#setting-${field.key}`);
  if(field.type==='toggle'){
    if(await input.isChecked()!==value)await page.locator(`label[for="setting-${field.key}"]`).click();
  }else if(field.type==='select')await input.selectOption(String(value));
  else await input.evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));},value);
  await page.waitForFunction(({key,value})=>__DF.settings[key]===value,{key:field.key,value});
}
const setting=(key,value)=>setField(SETTINGS_FIELDS.find(field=>field.key===key),value);
const openSettings=async()=>{await page.locator('[data-action="settings"]:visible').first().click();await page.locator('#settings-search').waitFor();};
const closeSettings=()=>page.locator('.settings-done').click();
try{
  app=await _electron.launch({executablePath:exe,args:['--qa'],env:{...process.env,DEAD_FREQUENCY_QA_PROFILE:profile},timeout:45000});
  page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await ready();assert.equal(await app.evaluate(({app})=>app.getVersion()),version);
  // Seed before the new document boots: a delayed native fullscreen event in
  // the old document legitimately persists its current runtime settings.
  await page.addInitScript(()=>{if(!sessionStorage.getItem('df-qa-legacy-seeded')){localStorage.setItem('dead-frequency.settings.v1',JSON.stringify({sensitivity:1.25,volume:.4,quality:'medium',fov:90}));sessionStorage.setItem('df-qa-legacy-seeded','1');}});
  await page.reload();await ready();
  for(const [key,value] of Object.entries({sensitivity:1.25,volume:.4,quality:'medium',fov:90}))assert.equal(await page.evaluate(key=>__DF.settings[key],key),value);
  pass('The packaged EXE migrates all four existing settings and adds safe defaults');
  await openSettings();assert.equal(await page.locator('[data-settings-category]').count(),6);
  assert.equal(await page.locator('[data-settings-row]').count(),55);
  await page.locator('#settings-search').fill('fadenkreuz');
  assert.ok(await page.locator('[data-settings-row]:visible').count()>=4);
  await page.locator('#settings-search').fill('keineoptionxyz');assert.equal(await page.locator('#settings-empty').isVisible(),true);
  await page.locator('[data-clear-settings-search]').click();pass('Six categories, all 55 controls, cross-category search and empty results work');
  const chosen={};
  for(const field of SETTINGS_FIELDS){
    if(field.key==='fullscreen')continue;
    const current=await page.evaluate(key=>__DF.settings[key],field.key);
    const value=field.type==='toggle'?!current:field.type==='select'?field.options.find(option=>option.value!==current).value:current===field.min?field.max:field.min;
    await setField(field,value);chosen[field.key]=value;
  }
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('dead-frequency.settings.v1')));
  for(const [key,value] of Object.entries(chosen))assert.equal(saved[key],value,key);
  pass('Every one of the 42 non-window options changes the real runtime value and persists');
  await setting('fullscreen',true);await page.waitForTimeout(450);assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen()),true);
  // Electron's before-input-event handles F11 before the renderer; CDP keyboard
  // injection bypasses that native hook, so exercise its native input path.
  await app.evaluate(({BrowserWindow})=>{const contents=BrowserWindow.getAllWindows()[0].webContents;contents.sendInputEvent({type:'keyDown',keyCode:'F11'});contents.sendInputEvent({type:'keyUp',keyCode:'F11'});});await page.waitForFunction(()=>__DF.settings.fullscreen===false);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen()),false);
  pass('Fullscreen changes the native window and F11 synchronizes the saved checkbox');
  await page.reload();await ready();
  for(const [key,value] of Object.entries(chosen))assert.equal(await page.evaluate(key=>__DF.settings[key],key),value,key);
  await openSettings();await category('audio');await page.locator('#reset-settings-category').click();
  assert.equal(await page.evaluate(()=>__DF.settings.volume),.65);assert.equal(await page.evaluate(()=>__DF.settings.headBob),chosen.headBob);
  const beforeReset=await page.evaluate(()=>JSON.stringify(__DF.settings));await page.locator('#reset-settings-all').click();
  assert.equal(await page.evaluate(()=>JSON.stringify(__DF.settings)),beforeReset);await page.locator('#reset-settings-all').click();
  assert.deepEqual(await page.evaluate(()=>__DF.settings),defaultSettings());
  pass('Restart persistence, category-only reset and two-click global reset are correct');
  await category('tasten');await page.locator('#setting-binding-forward').click();await page.keyboard.press('KeyD');
  assert.match(await page.locator('#binding-capture-note').innerText(),/bereits/);assert.equal(await page.evaluate(()=>__DF.settings.bindings.forward),'KeyW');
  await page.keyboard.press('Escape');assert.equal(await page.locator('#settings-search').isVisible(),true);
  await page.locator('#setting-binding-forward').click();await page.keyboard.press('KeyZ');
  await page.locator('#setting-binding-map').click();await page.keyboard.press('KeyN');
  assert.equal(await page.evaluate(()=>__DF.settings.bindings.forward),'KeyZ');assert.equal(await page.evaluate(()=>__DF.settings.bindings.map),'KeyN');
  pass('Rebinding captures physical keys, rejects conflicts and Escape cancels only capture');
  await category('hud');await setting('crosshairColor','#75dce8');await setting('crosshairSize',1.5);
  await page.screenshot({path:path.join(out,'01-settings-hud.png')});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(960,600));await page.waitForTimeout(300);
  const layout=await page.evaluate(()=>{
    const selectors=['.utility-dialog','.settings-footer','.settings-done','#settings-search'];
    return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,rects:selectors.map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {selector,x:r.x,y:r.y,right:r.right,bottom:r.bottom};})};
  });
  assert.ok(layout.scrollWidth<=layout.width);
  for(const rect of layout.rects)assert.ok(rect.x>=-1&&rect.y>=-1&&rect.right<=layout.width+1&&rect.bottom<=layout.height+1,JSON.stringify({layout,rect}));
  await page.screenshot({path:path.join(out,'02-settings-minimum-window.png')});
  pass('Categories, search and action footer fit the actual minimum Windows content area');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,900));await closeSettings();
  await page.locator('#start-raid').click();await page.waitForFunction(()=>__DF.state.phase==='raid'&&document.pointerLockElement);
  await page.evaluate(()=>{__DF.state.enemies=[];__DF.teleport(-142,135);});
  const startZ=await page.evaluate(()=>__DF.state.player.z);
  await page.keyboard.down('KeyW');await page.waitForTimeout(300);await page.keyboard.up('KeyW');assert.ok(Math.abs(await page.evaluate(()=>__DF.state.player.z)-startZ)<.05);
  await page.keyboard.down('KeyZ');await page.waitForTimeout(450);await page.keyboard.up('KeyZ');assert.ok(Math.abs(await page.evaluate(()=>__DF.state.player.z)-startZ)>1);
  await page.keyboard.down('KeyZ');await page.keyboard.press('KeyN');await page.waitForFunction(()=>!document.pointerLockElement);
  assert.equal(await page.evaluate(()=>__DF.state.phase),'raid');await page.keyboard.press('KeyN');await page.waitForFunction(()=>document.pointerLockElement);
  await page.keyboard.down('KeyZ');assert.equal(await page.evaluate(()=>__DF.inputState().forward),1);await page.keyboard.up('KeyZ');
  pass('The rebound movement key moves the player, the old key stops working, and the new map key toggles the actual map');
  await page.keyboard.press('Escape');await openSettings();
  await setting('aimMode','toggle');await setting('sprintMode','toggle');await setting('crouchMode','toggle');
  await setting('headBob',0);await setting('weaponSway',0);await setting('screenShake',0);await setting('adsZoom',0);await setting('fov',100);
  await setting('fpsLimit',30);await closeSettings();
  await page.keyboard.press('Escape');await page.waitForFunction(()=>__DF.state.phase==='raid'&&document.pointerLockElement);
  await page.mouse.click(500,350,{button:'right'});assert.equal(await page.evaluate(()=>__DF.inputState().aim),true);
  await page.waitForTimeout(250);assert.ok(Math.abs(await page.evaluate(()=>__DF.stats().fov)-100)<.1);
  await page.mouse.click(500,350,{button:'right'});assert.equal(await page.evaluate(()=>__DF.inputState().aim),false);
  await page.keyboard.press('ControlLeft');await page.waitForFunction(()=>__DF.state.player.crouching);await page.keyboard.press('ControlLeft');await page.waitForFunction(()=>!__DF.state.player.crouching);
  await page.keyboard.down('KeyZ');await page.keyboard.press('ShiftLeft');await page.waitForFunction(()=>__DF.state.player.sprinting);
  await page.waitForTimeout(650);const motion=await page.evaluate(()=>({state:__DF.inputState(),stats:__DF.stats()}));
  assert.equal(motion.state.sprint,true);assert.equal(motion.stats.headBobAmplitude,0);assert.equal(motion.stats.weaponBobAmplitude,0);assert.ok(motion.stats.renderedFps>=25&&motion.stats.renderedFps<=33,JSON.stringify(motion.stats));
  await page.evaluate(()=>{__DF.state.player.stamina=.1;});await page.waitForFunction(()=>__DF.state.player.sprintExhausted);
  await page.waitForTimeout(1600);assert.equal(await page.evaluate(()=>__DF.inputState().sprint),false);assert.equal(await page.evaluate(()=>__DF.state.player.sprinting),false);
  await page.keyboard.up('KeyZ');
  pass('Aim, crouch and sprint toggles work; exhaustion releases sprint; cosmetic motion and a 30-FPS cap preserve simulation');
  await page.keyboard.press('Escape');await openSettings();
  await setting('invertY',true);await setting('autoReload',true);await setting('muteOnBlur',true);await setting('weaponVolume',0);await setting('dynamicRange','night');
  await page.waitForFunction(()=>Math.abs(__DF.audio.stats().compressor.threshold+20)<.01);
  const audio=await page.evaluate(()=>__DF.audio.stats());assert.equal(audio.settings.weaponVolume,0);assert.ok(Math.abs(audio.compressor.threshold+20)<.01);
  await setting('showWeapon',false);assert.equal(await page.evaluate(()=>__DF.stats().weaponVisible),false);
  await setting('showWeapon',true);await closeSettings();await page.keyboard.press('Escape');await page.waitForFunction(()=>__DF.state.phase==='raid'&&document.pointerLockElement);
  await page.mouse.move(500,420);await page.waitForTimeout(50);
  await page.evaluate(()=>{__DF.state.player.pitch=0;__DF.syncLook();});await page.mouse.move(500,450);
  await page.waitForTimeout(120);assert.ok(await page.evaluate(()=>__DF.state.player.pitch>0));
  await page.evaluate(()=>{__DF.state.player.ammo=0;});await page.waitForFunction(()=>__DF.state.player.reload>0);
  const cdp=await app.context().newCDPSession(page);await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:false});
  // Give Windows an actual focus destination; blur() alone need not deactivate
  // the sole visible window on this desktop.
  await app.evaluate(async({BrowserWindow})=>{const focusWindow=new BrowserWindow({width:320,height:160,show:false,title:'DEAD FREQUENCY — Fokusprüfung',webPreferences:{sandbox:true,nodeIntegration:false}});global.__DF_QA_FOCUS=focusWindow;await focusWindow.loadURL('data:text/html,<title>Fokuspruefung</title>');focusWindow.show();focusWindow.focus();});await page.waitForFunction(()=>__DF.audio.stats().muted);
  await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows().find(window=>window!==global.__DF_QA_FOCUS).focus();global.__DF_QA_FOCUS.destroy();delete global.__DF_QA_FOCUS;});await page.waitForFunction(()=>!__DF.audio.stats().muted);
  pass('Inverted look, automatic reload, live weapon visibility, audio buses, night mode and native focus muting are active');
  assert.equal(await page.evaluate(()=>__DF.state.phase),'paused');await openSettings();await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>__DF.state.phase),'paused');
  await page.screenshot({path:path.join(out,'03-configured-game.png')});
  assert.deepEqual(errors,[]);pass('Settings close safely inside a paused raid and the tested native flow has no renderer errors');
  const appAsarSha256=createHash('sha256').update(await fs.readFile(path.join(path.dirname(exe),'resources/app.asar'))).digest('hex');
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,exe,version,settingsCount:SETTINGS_FIELDS.length+BINDING_ACTIONS.length,categories:SETTINGS_CATEGORIES.length,appAsarSha256,checks,errors,minimumWindow:layout},null,2));
}catch(error){await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,exe,version,checks,errors,failure:error.stack},null,2));throw error;}
finally{await app?.close().catch(()=>{});}
