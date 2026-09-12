import {_electron} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {MAX_RENDER_PIXELS,MAX_RENDER_EDGE} from '../src/render-resolution.js';
const version=JSON.parse(await fs.readFile('package.json','utf8')).version;
const exe=process.env.DF_EXE||path.resolve(`../../outputs/v${version}/DEAD FREQUENCY-win32-x64/DEAD FREQUENCY.exe`);
const out=path.resolve(`../qa-stability-native-${version}`);await fs.mkdir(out,{recursive:true});
const profile=await fs.mkdtemp(path.join(out,'profile-'));
const checks=[],errors=[],measurements={};let app,page;
const idleSeconds=Math.max(6,Math.min(600,Number(process.env.DF_QA_IDLE_SECONDS)||180));
const pass=name=>{checks.push(name);console.log('PASS',name);};
const ready=()=>page.waitForFunction(()=>window.__DF&&document.documentElement.dataset.ready==='true',null,{timeout:90000});
function sameSavedProgress(actual,expected){const {marketTime:actualTime,...actualProgress}=actual,{marketTime:expectedTime,...expectedProgress}=expected;assert.ok(actualTime>=expectedTime);assert.deepEqual(actualProgress,expectedProgress);}
async function shot(name){await page.screenshot({path:path.join(out,`${name}.png`)});}
try{
 app=await _electron.launch({executablePath:exe,args:['--qa'],env:{...process.env,DEAD_FREQUENCY_QA_PROFILE:profile},timeout:60000});
 page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await ready();assert.equal(await app.evaluate(({app})=>app.getVersion()),version);
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setFullScreen(false);w.unmaximize();w.setSize(1440,900);w.show();w.focus();});
 await page.evaluate(()=>{__DF.settingsChanged({volume:0,fullscreen:false});__DF.state.profile.credits=5432;__DF.persist();window.__reloadSentinel=true;location.reload();});
 await page.waitForFunction(()=>window.__DF&&document.documentElement.dataset.ready==='true'&&!window.__reloadSentinel);
 assert.equal(await page.evaluate(()=>__DF.state.profile.credits),5432);
 pass('An actual location.reload navigates the packaged game and preserves its save instead of leaving disposed graphics behind');
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:2560,height:1440,deviceScaleFactor:2,mobile:false});
 await page.evaluate(()=>__DF.settingsChanged({quality:'high',renderScale:1.5}));
 await page.waitForTimeout(500);
 const high=await page.evaluate(()=>({buffer:__DF.view.resolutionStats(),view:__DF.stats(),dpr:devicePixelRatio}));measurements.highDPI=high;
 assert.ok(Math.abs(high.dpr-2)<.001);assert.ok(high.buffer.limited);assert.ok(high.view.renderWidth*high.view.renderHeight<=MAX_RENDER_PIXELS);
 assert.ok(high.view.renderWidth<=MAX_RENDER_EDGE&&high.view.renderHeight<=MAX_RENDER_EDGE);assert.ok(high.view.drawCalls>0);
 await shot('01-high-dpi');
 pass('A real high-DPI Windows framebuffer at 150 percent render scale stays within the pixel and driver budget');
 const beforeChanges=await page.evaluate(()=>__DF.view.resolutionStats().changes);
 await page.evaluate(()=>{for(let i=0;i<40;i++)__DF.settingsChanged({renderScale:.5+(i%11)*.1});});
 await page.waitForTimeout(350);assert.ok(await page.evaluate(before=>__DF.view.resolutionStats().changes-before<=1,beforeChanges));
 for(const scale of [1.5,.5,1.25,.75,1]){await page.evaluate(scale=>__DF.settingsChanged({renderScale:scale}),scale);await page.waitForTimeout(250);}
 await cdp.send('Emulation.clearDeviceMetricsOverride');await page.waitForTimeout(250);
 assert.equal(await page.evaluate(()=>!!document.querySelector('#graphics-recovery')),false);
 pass('Rapid resolution input coalesces into one drawing-buffer allocation; subsequent real size changes remain usable');
 await page.locator('#start-raid').click();await page.waitForFunction(()=>__DF.state.phase==='raid');
 await page.evaluate(()=>{__DF.state.enemies=[];__DF.state.player.hp=83;__DF.state.player.ammo=9;__DF.pause();window.__contextSentinel=__DF.state;});
 const stateBefore=await page.evaluate(()=>({position:{x:__DF.state.player.x,z:__DF.state.player.z},profile:structuredClone(__DF.state.profile)}));
 await page.evaluate(()=>{const canvas=document.querySelector('#game'),gl=canvas.getContext('webgl2'),ext=gl.getExtension('WEBGL_lose_context');window.__restoreGraphics=()=>ext.restoreContext();ext.loseContext();});
 await page.locator('#graphics-recovery').waitFor({state:'visible'});await page.waitForTimeout(1200);
 await page.evaluate(()=>__restoreGraphics());await page.locator('#graphics-recovery').waitFor({state:'hidden',timeout:30000});
 await page.waitForTimeout(500);
 assert.equal(await page.evaluate(()=>window.__contextSentinel===__DF.state),true);
 assert.equal(await page.evaluate(()=>__DF.state.player.hp),83);assert.equal(await page.evaluate(()=>__DF.state.player.ammo),9);
 assert.deepEqual(await page.evaluate(()=>({x:__DF.state.player.x,z:__DF.state.player.z})),stateBefore.position);
 sameSavedProgress(await page.evaluate(()=>__DF.state.profile),stateBefore.profile);
 assert.equal(await page.evaluate(()=>document.querySelector('#game').getContext('webgl2').isContextLost()),false);
 assert.ok(await page.evaluate(()=>__DF.stats().drawCalls>0));await shot('02-context-restored');
 pass('Forced WebGL loss restores actual rendering in place with the same live raid, position, ammunition, health and profile');
 await page.locator('#resume-raid').click();await page.locator('#game').click();await page.waitForFunction(()=>__DF.state.phase==='raid'&&document.pointerLockElement);
 await page.mouse.down();await page.waitForTimeout(120);await page.mouse.up();assert.ok(await page.evaluate(()=>__DF.state.player.ammo<9));
 pass('The same raid remains playable after graphics recovery and can fire its existing weapon');
 await page.evaluate(()=>{__DF.game.endRaid('QA stability');});await page.locator('#result-hub').click();
 await page.evaluate(()=>__DF.settingsChanged({quality:'high',renderScale:1,fpsLimit:0}));
 measurements.idle=[];measurements.idleDurationSeconds=idleSeconds;
 for(let i=0;i<6;i++){
   await page.waitForTimeout(idleSeconds*1000/6);
   const sample=await page.evaluate(()=>({fps:__DF.stats().renderedFps,geometries:__DF.stats().geometries,textures:__DF.stats().textures,heap:performance.memory?.usedJSHeapSize,failed:!!document.querySelector('#graphics-recovery')}));
   measurements.idle.push(sample);assert.equal(sample.failed,false);assert.ok(sample.fps<=33);console.log('IDLE',idleSeconds*(i+1)/6,'seconds',JSON.stringify(sample));
 }
 // Slow menu motion can expose a handful of lazily uploaded scene resources.
 const first=measurements.idle[0],last=measurements.idle.at(-1);assert.ok(Math.max(...measurements.idle.map(s=>s.geometries))-Math.min(...measurements.idle.map(s=>s.geometries))<=16);assert.ok(Math.max(...measurements.idle.map(s=>s.textures))-Math.min(...measurements.idle.map(s=>s.textures))<=4);
 if(first.heap&&last.heap)assert.ok(last.heap-first.heap<64*1024*1024);
 pass(`${idleSeconds} real seconds in the Windows menu keep GPU resource counts bounded and menu rendering at 30 FPS or below`);
 const safeProfile=await page.evaluate(()=>{__DF.persist();return structuredClone(__DF.state.profile);});
 const previousWindow=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].id);
 const replacement=app.waitForEvent('window',{timeout:30000});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
 page=await replacement;page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 assert.ok(await app.evaluate(({BrowserWindow},id)=>BrowserWindow.getAllWindows().length===1&&BrowserWindow.getAllWindows()[0].id!==id,previousWindow));
 await page.waitForURL('**/launcher/recovery.html',{timeout:30000});await page.locator('#recover-graphics').waitFor();await shot('03-native-crash-recovery');
 await page.bringToFront();await page.evaluate(()=>{
   window.__recoveryPad={id:'Xbox Wireless Controller',index:0,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},(_,i)=>({pressed:i===0,value:i===0?1:0}))};
   Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[window.__recoveryPad]});
 });
 await page.waitForTimeout(500);assert.ok(page.url().endsWith('/launcher/recovery.html'),'A held confirmation must not restart');
 await page.evaluate(()=>{window.__recoveryPad.buttons[0]={pressed:false,value:0};});await page.waitForTimeout(350);
 await page.evaluate(()=>{window.__recoveryPad.buttons[0]={pressed:true,value:1};});await ready();
 sameSavedProgress(await page.evaluate(()=>__DF.state.profile),safeProfile);assert.ok(await page.evaluate(()=>__DF.settings.renderScale<=.75));
 await page.waitForFunction(()=>__DF.stats().drawCalls>0);
 pass('A crashed native renderer shows a working recovery page; neutral then confirm via simulated standard gamepad restarts at safe resolution with secured progress intact');
 assert.deepEqual(errors,[]);pass('No unhandled JavaScript or renderer errors in the tested recovery and menu workflow');
 const appAsarSha256=createHash('sha256').update(await fs.readFile(path.join(path.dirname(exe),'resources/app.asar'))).digest('hex');
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,exe,version,appAsarSha256,checks,errors,measurements},null,2));
}catch(error){await shot('failure').catch(()=>{});await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,exe,version,checks,errors,measurements,failure:error.stack},null,2));throw error;}
finally{await app?.close().catch(()=>{});}
