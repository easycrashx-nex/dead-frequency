import {_electron} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {WEAPONS} from '../src/weapons.js';
import {isWalkable} from '../src/simulation.js';

// This tests the real packaged input/UI/gameplay path with a controlled browser
// Gamepad API. It does not claim physical Xbox/PlayStation or actuator testing.
const version=JSON.parse(await fs.readFile('package.json','utf8')).version;
const exe=process.env.DF_EXE||path.resolve(`../../outputs/v${version}/DEAD FREQUENCY-win32-x64/DEAD FREQUENCY.exe`);
const out=path.resolve(process.env.DF_CONTROLLER_QA_OUT||`../qa-controller-native-${version}`);
await fs.mkdir(out,{recursive:true});
const profile=await fs.mkdtemp(path.join(out,'profile-'));
const checks=[],errors=[],measurements={};let app,page;
const inputSource='simulated-gamepad-api';
const pass=name=>{checks.push(name);console.log('PASS',name);};
const ready=()=>page.waitForFunction(()=>window.__DF&&document.documentElement.dataset.ready==='true',null,{timeout:60000});

function installGamepadFixture(){
  let connected=false,timestamp=0,secondary=null;
  const pad={id:'Xbox Wireless Controller (STANDARD GAMEPAD Vendor:045e Product:0b13)',index:0,mapping:'standard',connected:false,
    axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,touched:false,value:0})),timestamp:0};
  const fixture={rumbleCalls:[],
    patch({axes,buttons}={}){if(axes)for(let i=0;i<4;i++)pad.axes[i]=Number(axes[i]||0);if(buttons)for(const [index,value]of Object.entries(buttons)){const v=Math.max(0,Math.min(1,Number(value)||0));pad.buttons[index]={pressed:v>=.5,touched:v>0,value:v};}pad.timestamp=++timestamp;},
    neutral(){pad.axes.fill(0);for(let i=0;i<pad.buttons.length;i++)pad.buttons[i]={pressed:false,touched:false,value:0};pad.timestamp=++timestamp;},
    connect(options={}){fixture.neutral();pad.id=options.id||'Xbox Wireless Controller (STANDARD GAMEPAD Vendor:045e Product:0b13)';pad.mapping=options.mapping??'standard';connected=pad.connected=true;fixture.patch(options);const event=new Event('gamepadconnected');Object.defineProperty(event,'gamepad',{value:pad});window.dispatchEvent(event);},
    disconnect(){connected=pad.connected=false;pad.timestamp=++timestamp;const event=new Event('gamepaddisconnected');Object.defineProperty(event,'gamepad',{value:pad});window.dispatchEvent(event);},
    secondary(enabled){secondary=enabled?{id:'DualSense (STANDARD GAMEPAD Vendor:054c Product:0ce6)',index:1,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))}:null;},
  };
  pad.vibrationActuator={type:'dual-rumble',playEffect:async(type,options)=>{fixture.rumbleCalls.push({type,...options});return 'complete';},reset:async()=> 'complete'};
  Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[connected?pad:null,secondary,null,null]});
  window.__fakePad=fixture;
}
const patch=value=>page.evaluate(value=>__fakePad.patch(value),value);
async function neutral(ms=130){await page.evaluate(()=>__fakePad.neutral());await page.waitForTimeout(ms);}
async function tap(button,ms=85){await patch({buttons:{[button]:1}});await page.waitForTimeout(ms);await patch({buttons:{[button]:0}});await page.waitForTimeout(110);}
async function hold(value,ms){await patch(value);await page.waitForTimeout(ms);await neutral();}
const controller=()=>page.evaluate(()=>structuredClone(__DF.controllerState));
const player=()=>page.evaluate(()=>({x:__DF.state.player.x,y:__DF.state.player.y,z:__DF.state.player.z,yaw:__DF.state.player.yaw,pitch:__DF.state.player.pitch,ammo:__DF.state.player.ammo,phase:__DF.state.phase}));
const separation=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const angleDifference=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
async function screenshot(name){await page.screenshot({path:path.join(out,`${name}.png`)});}

// Navigate through the game's controller API, never HTMLElement.focus/click.
// DOM reads choose the next D-pad direction and produce useful failure evidence.
async function focusWithPad(selector){
  const target=page.locator(selector).first();await target.waitFor({state:'visible'});
  const history=[];
  for(let step=0;step<75;step++){
    if(await target.evaluate(node=>node===document.activeElement||node.classList.contains('controller-focused')))return;
    const route=await target.evaluate(goal=>{
      const area=goal.closest('#controller-keyboard-overlay,#utility-overlay,#coop-overlay,#container-panel,#inventory-panel,#map-panel,#pause-screen,#result-screen,#hub-screen');
      const items=[...area.querySelectorAll('button,input:not([type="hidden"]),select,textarea,summary')].filter(node=>!node.closest('[hidden]')&&node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden'&&!node.disabled&&node.getAttribute('aria-disabled')!=='true');
      const current=document.querySelector('.controller-focused')||document.activeElement,start=items.indexOf(current),end=items.indexOf(goal),rects=items.map(node=>node.getBoundingClientRect());
      const queue=[{index:start,path:[]}],seen=new Set([start]);
      while(queue.length){const {index,path}=queue.shift();if(index===end)return {path,key:current.id||current.textContent?.slice(0,70)};if(index<0)break;
        const node=items[index],r=rects[index],cx=r.x+r.width/2,cy=r.y+r.height/2;
        for(const [button,x,y]of [[12,0,-1],[13,0,1],[14,-1,0],[15,1,0]]){
          // Left/right changes a slider/list/number instead of moving focus.
          if(x&&(node.tagName==='SELECT'||node.matches('input[type="range"],input[type="number"]')))continue;
          const candidates=rects.map((q,next)=>{const dx=q.x+q.width/2-cx,dy=q.y+q.height/2-cy,along=x?dx*x:dy*y,across=x?Math.abs(dy):Math.abs(dx);return {next,along,score:along+across*2+across*across/Math.max(20,along)};}).filter(item=>item.next!==index&&item.along>3).sort((a,b)=>a.score-b.score);
          const next=candidates[0]?.next;if(next!=null&&!seen.has(next)){seen.add(next);queue.push({index:next,path:[...path,button]});}
        }
      }
      return {path:null,key:current?.id||current?.textContent?.slice(0,70),target:goal.id||goal.textContent?.slice(0,70),candidates:items.length};
    });
    assert.ok(route.path?.length,`No controller navigation path to ${selector}: ${JSON.stringify(route)}`);
    history.push({key:route.key,button:route.path[0]});await tap(route.path[0]);
  }
  throw new Error(`Controller could not focus ${selector}: ${JSON.stringify(history)}`);
}
async function confirm(selector){await focusWithPad(selector);await tap(0);}
async function setFixtureWeapon(id){
  const weapon=WEAPONS.find(w=>w.id===id);assert.ok(weapon);
  await page.evaluate(w=>{Object.assign(__DF.state.player,{weapon:w.id,weaponStats:{...w,attachments:{},noiseMultiplier:(w.soundRadius??36)/36},attachments:{},adsSeconds:w.adsSeconds,adsZoom:w.adsZoom,ammo:w.magSize,magSize:w.magSize,reserve:w.reserve,reload:0,reloadDuration:w.reloadSeconds,shotTimer:0,cycleDuration:w.fireInterval,heal:0});},weapon);
  await neutral(180);
}
async function safeField(){
  await neutral();await page.evaluate(()=>{__DF.state.enemies=[];__DF.teleport(-142,135);__DF.state.player.yaw=0;__DF.state.player.pitch=0;__DF.syncLook();});await page.waitForTimeout(160);
}
async function ensureRaid(){
  await neutral();if(await page.evaluate(()=>__DF.state.phase==='paused'))await tap(9);
  await page.waitForFunction(()=>__DF.state.phase==='raid');await neutral();
}

try{
  app=await _electron.launch({executablePath:exe,args:['--qa'],env:{...process.env,DEAD_FREQUENCY_QA_PROFILE:profile},timeout:45000});
  page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await app.context().addInitScript(installGamepadFixture);await page.reload();await ready();
  assert.equal(await app.evaluate(({app})=>app.getVersion()),version);
  await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.setFullScreen(false);window.unmaximize();window.setSize(1440,900);window.show();window.focus();});
  await page.evaluate(()=>__DF.settingsChanged({volume:0,fpsLimit:60,autoReload:false,controllerEnabled:true,controllerAimMode:'hold',controllerSprintMode:'hold',controllerCrouchMode:'hold'}));
  await page.evaluate(()=>__fakePad.connect({axes:[0,-1,.7,0],buttons:{0:1,7:1}}));await page.waitForTimeout(450);
  assert.equal(await page.evaluate(()=>__DF.state.phase),'hub');assert.equal((await controller()).blocked,true);
  await neutral(250);await tap(13);await page.waitForFunction(()=>__DF.inputDevice==='controller');
  assert.equal((await controller()).connected,true);assert.equal((await controller()).family,'xbox');assert.equal((await controller()).blocked,false);
  pass('A held gamepad on first connection cannot start/fire; neutral then fresh D-pad input activates Xbox control');

  await confirm('#hub-screen [data-action="settings"]');await page.locator('#settings-content').waitFor({state:'visible'});
  await confirm('[data-settings-category="controller"]');
  assert.equal(await page.locator('#controller-status').isVisible(),true);
  await focusWithPad('#setting-controllerSensitivity');const sensitivityBefore=await page.evaluate(()=>__DF.settings.controllerSensitivity);await tap(15);
  assert.notEqual(await page.evaluate(()=>__DF.settings.controllerSensitivity),sensitivityBefore);
  measurements.savedSensitivity=await page.evaluate(()=>__DF.settings.controllerSensitivity);
  await screenshot('01-controller-settings-xbox');await tap(1);await page.waitForFunction(()=>!__DF.ui.isUtilityOpen());

  await confirm('#coop-open');await confirm('#coop-name');await page.locator('#controller-keyboard-overlay').waitFor({state:'visible'});
  await confirm('[data-keyboard-key="clear"]');await confirm('[data-keyboard-key="q"]');await confirm('[data-keyboard-key="a"]');await confirm('#controller-keyboard-apply');
  assert.equal(await page.locator('#coop-name').inputValue(),'qa');await tap(1);await page.locator('#coop-overlay').waitFor({state:'hidden'});
  // A scoped item enables the real market form without making the controller QA
  // depend on a prior extraction. It remains inside this isolated save profile.
  await page.evaluate(()=>{__DF.state.profile.stash.push({id:'qa-controller-cargo',name:'QA Ratschenkasten',value:145,rarity:'common'});});
  await confirm('.hub-navigation [data-hub-tab="storage"]');await confirm('[data-market-item="qa-controller-cargo"]');
  await focusWithPad('#market-price');const priceBefore=Number(await page.locator('#market-price').inputValue());await tap(15);assert.equal(Number(await page.locator('#market-price').inputValue()),priceBefore+1);
  await tap(0);await page.locator('#controller-keyboard-overlay').waitFor({state:'visible'});await confirm('[data-keyboard-key="clear"]');
  for(const digit of ['1','2','3'])await confirm(`[data-keyboard-key="${digit}"]`);await screenshot('01b-controller-number-entry');await confirm('#controller-keyboard-apply');
  assert.equal(await page.locator('#market-price').inputValue(),'123');await tap(5);assert.equal(await page.locator('#hub-screen').getAttribute('data-tab'),'mailbox');await tap(4);assert.equal(await page.locator('#hub-screen').getAttribute('data-tab'),'market');
  await confirm('.hub-navigation [data-hub-tab="deploy"]');
  pass('Controller-only on-screen text/number entry applies a callsign and market price; shoulder buttons switch hub areas');

  await confirm('#start-raid');await page.waitForFunction(()=>__DF.state.phase==='raid');
  assert.equal(await page.evaluate(()=>document.pointerLockElement),null);assert.equal(await page.evaluate(()=>__DF.inputDevice),'controller');
  pass('Controller-only D-pad/A/B navigation changes a real setting and starts a raid without mouse pointer lock');
  await safeField();

  const driftBefore=await player();await hold({axes:[.04,-.04,.04,-.04]},550);const driftAfter=await player();
  assert.ok(separation(driftBefore,driftAfter)<.025);assert.ok(Math.abs(angleDifference(driftAfter.yaw,driftBefore.yaw))<.001);assert.ok(Math.abs(driftAfter.pitch-driftBefore.pitch)<.001);
  const halfBefore=await player();await hold({axes:[0,-.6,0,0]},550);const halfAfter=await player();
  const fullBefore=await player();await hold({axes:[0,-1,0,0]},550);const fullAfter=await player();
  measurements.movement={half:separation(halfBefore,halfAfter),full:separation(fullBefore,fullAfter),drift:separation(driftBefore,driftAfter)};
  assert.ok(measurements.movement.half>.25);assert.ok(measurements.movement.full>measurements.movement.half*1.25);
  pass('Stick drift is blocked and analog movement genuinely varies with stick magnitude');

  const lookBefore=await player();await hold({axes:[0,0,.6,-.4]},500);const lookAfter=await player();
  assert.ok(Math.abs(angleDifference(lookAfter.yaw,lookBefore.yaw))>.08);assert.ok(lookAfter.pitch>lookBefore.pitch+.025);
  await patch({buttons:{6:1}});await page.waitForFunction(()=>__DF.inputState().aim===true);await page.waitForTimeout(280);
  assert.ok(await page.evaluate(()=>__DF.stats().fov<__DF.settings.fov-10));await neutral();
  await setFixtureWeapon('VX-9');const autoBefore=await player();await hold({buttons:{7:1}},460);const autoAfter=await player();assert.ok(autoBefore.ammo-autoAfter.ammo>=3);
  await setFixtureWeapon('RV-6');const semiBefore=await player();await hold({buttons:{7:1}},1100);const semiHeld=await player();assert.equal(semiBefore.ammo-semiHeld.ammo,1);await tap(7);assert.equal((await player()).ammo,semiHeld.ammo-1);
  pass('Right stick, trigger ADS and real automatic/semiautomatic firing work; a held revolver trigger fires once');
  await setFixtureWeapon('VX-9');await safeField();

  await patch({buttons:{0:1}});await page.waitForFunction(()=>__DF.state.player.y>.15);await neutral();await page.waitForFunction(()=>__DF.state.player.grounded);
  await patch({buttons:{1:1}});await page.waitForFunction(()=>__DF.state.player.crouching);await neutral();await page.waitForFunction(()=>!__DF.state.player.crouching);
  await patch({buttons:{11:1}});await page.waitForFunction(()=>__DF.state.player.crouching);await neutral();
  await patch({axes:[0,-1,0,0],buttons:{10:1}});await page.waitForFunction(()=>__DF.state.player.sprinting);await neutral();await page.waitForFunction(()=>!__DF.state.player.sprinting);
  await page.evaluate(()=>{__DF.state.player.ammo=3;__DF.state.player.reserve=60;});await tap(2);await page.waitForFunction(()=>__DF.state.player.reload>.1);await page.waitForFunction(()=>__DF.state.player.reload===0,null,{timeout:5000});assert.equal((await player()).ammo,24);
  await page.evaluate(()=>{__DF.state.player.hp=40;__DF.state.player.medkits=2;});await tap(4);await page.waitForFunction(()=>__DF.state.player.heal>.1);await page.waitForFunction(()=>__DF.state.player.heal===0,null,{timeout:5000});assert.ok(await page.evaluate(()=>__DF.state.player.hp>=95&&__DF.state.player.medkits===1));
  pass('Face buttons/stick clicks jump, crouch both ways, sprint, reload and complete a real medkit treatment');

  await page.evaluate(()=>__DF.settingsChanged({controllerAimMode:'toggle',controllerSprintMode:'toggle',controllerCrouchMode:'toggle'}));await neutral(200);
  await tap(6);assert.equal(await page.evaluate(()=>__DF.inputState().aim),true);await tap(6);assert.equal(await page.evaluate(()=>__DF.inputState().aim),false);
  await tap(1);await page.waitForFunction(()=>__DF.state.player.crouching);await tap(1);await page.waitForFunction(()=>!__DF.state.player.crouching);
  await patch({axes:[0,-1,0,0]});await tap(10);await page.waitForFunction(()=>__DF.state.player.sprinting);await page.evaluate(()=>{__DF.state.player.stamina=2;});
  await page.waitForFunction(()=>__DF.state.player.sprintExhausted&&!__DF.state.player.sprinting);await page.waitForTimeout(450);assert.equal(await page.evaluate(()=>__DF.state.player.sprinting||__DF.inputState().sprint),false);
  await neutral();await page.evaluate(()=>__DF.settingsChanged({controllerAimMode:'hold',controllerSprintMode:'hold',controllerCrouchMode:'hold'}));await neutral(200);
  pass('Controller hold/toggle modes both work and stamina exhaustion cancels the sprint toggle without flicker');

  const spots=await page.evaluate(()=>__DF.game.layout.containers);let approach;
  for(const spot of spots){for(const [dx,dz]of [[0,spot.d/2+1],[spot.w/2+1,0],[0,-spot.d/2-1],[-spot.w/2-1,0]])if(isWalkable(spot.x+dx,spot.z+dz,.34)){approach={id:spot.id,x:spot.x+dx,z:spot.z+dz};break;}if(approach)break;}
  assert.ok(approach);await page.evaluate(point=>__DF.teleport(point.x,point.z),approach);await page.waitForFunction(id=>__DF.state.prompt?.id===id,approach.id);
  await tap(3);await page.waitForFunction(()=>!!__DF.state.activeContainerId);await page.waitForFunction(()=>__DF.state.containerSearchRemaining===0,null,{timeout:6000});
  const cargoId=await page.evaluate(()=>__DF.state.containers.find(box=>box.id===__DF.state.activeContainerId).items.find(item=>!item.kind&&!item.taken)?.id);assert.ok(cargoId);
  await confirm(`[data-take-container-item="${cargoId}"]`);await page.waitForFunction(()=>__DF.state.raid.loot.length>0);await tap(1);await page.waitForFunction(()=>!__DF.state.activeContainerId);
  await tap(5);await page.locator('#inventory-panel').waitFor({state:'visible'});const bagBefore=await player();await hold({axes:[0,-1,0,0],buttons:{7:1}},400);const bagAfter=await player();assert.equal(bagAfter.ammo,bagBefore.ammo);assert.ok(separation(bagBefore,bagAfter)<.025);await tap(1);await page.locator('#inventory-panel').waitFor({state:'hidden'});
  await tap(8);await page.locator('#map-panel').waitFor({state:'visible'});assert.equal((await player()).phase,'raid');await tap(1);await page.locator('#map-panel').waitFor({state:'hidden'});
  await tap(9);await page.waitForFunction(()=>__DF.state.phase==='paused');const pausedBefore=await player();await hold({axes:[0,-1,0,0],buttons:{7:1}},350);const pausedAfter=await player();assert.equal(pausedBefore.ammo,pausedAfter.ammo);assert.ok(separation(pausedBefore,pausedAfter)<.025);await ensureRaid();
  pass('Controller interaction searches/takes real container loot; backpack, map and pause block gameplay input and close with controller buttons');
  await screenshot('02-controller-raid-xbox');

  await safeField();await setFixtureWeapon('VX-9');await page.evaluate(()=>__fakePad.secondary(true));await neutral();
  await patch({axes:[0,-1,0,0],buttons:{7:1}});await page.waitForTimeout(260);await page.evaluate(()=>__fakePad.disconnect());
  await page.waitForFunction(()=>__DF.state.phase==='paused'&&__DF.controllerState.index===1);
  await page.waitForTimeout(120);const unplugged=await player();await page.waitForTimeout(400);const unpluggedLater=await player();assert.equal(unplugged.ammo,unpluggedLater.ammo);assert.ok(separation(unplugged,unpluggedLater)<.025);
  assert.equal((await controller()).connected,true);pass('Losing the active gamepad pauses the raid even when another neutral controller is still connected');
  await page.evaluate(()=>__fakePad.secondary(false));await page.waitForFunction(()=>!__DF.controllerState.connected);
  await page.evaluate(()=>__fakePad.connect({id:'DualSense Wireless Controller (STANDARD GAMEPAD Vendor:054c Product:0ce6)',axes:[0,-1,0,0],buttons:{7:1}}));await page.waitForTimeout(400);assert.equal((await controller()).blocked,true);assert.equal((await player()).ammo,unpluggedLater.ammo);
  await neutral(200);await ensureRaid();await tap(14);await page.waitForFunction(()=>__DF.inputDevice==='controller'&&__DF.controllerState.family==='playstation');
  await page.waitForFunction(()=>document.querySelector('[data-controller-glyph="interact"]')?.dataset.glyphFamily==='playstation');await screenshot('03-controller-raid-playstation');
  await page.evaluate(()=>__DF.settingsChanged({controllerPrompts:'xbox'}));await page.waitForFunction(()=>document.querySelector('[data-controller-glyph="interact"]')?.dataset.glyphFamily==='xbox');
  await page.evaluate(()=>__DF.settingsChanged({controllerPrompts:'playstation'}));await page.waitForFunction(()=>document.querySelector('[data-controller-glyph="interact"]')?.dataset.glyphFamily==='playstation');
  pass('Hot-unplug stops movement/fire; held reconnect is neutral-gated; PlayStation identification and manual Xbox/PS prompt overrides are applied');

  await safeField();measurements.lookRates=[];
  for(const fpsLimit of [30,60]){
    await page.evaluate(fpsLimit=>__DF.settingsChanged({fpsLimit}),fpsLimit);await neutral(500);
    const sample=await page.evaluate(async()=>{const yaw=__DF.state.player.yaw,start=performance.now();__fakePad.patch({axes:[0,0,.7,0]});await new Promise(resolve=>setTimeout(resolve,1000));const end=performance.now(),next=__DF.state.player.yaw;__fakePad.neutral();return{seconds:(end-start)/1000,delta:Math.atan2(Math.sin(next-yaw),Math.cos(next-yaw)),fps:__DF.stats().renderedFps};});
    sample.limit=fpsLimit;sample.radiansPerSecond=Math.abs(sample.delta)/sample.seconds;measurements.lookRates.push(sample);await neutral();
  }
  const [slow,fast]=measurements.lookRates;assert.ok(slow.fps<40&&fast.fps>45,JSON.stringify(measurements.lookRates));assert.ok(Math.abs(slow.radiansPerSecond-fast.radiansPerSecond)/Math.max(slow.radiansPerSecond,fast.radiansPerSecond)<.13,JSON.stringify(measurements.lookRates));
  pass('Actual 30/60-FPS native runs retain the same right-stick angular speed within13 percent');

  const cdp=await app.context().newCDPSession(page);await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:false});
  await safeField();await patch({axes:[0,-1,0,0],buttons:{7:1}});await page.waitForTimeout(180);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].minimize());await page.waitForFunction(()=>document.hidden||!document.hasFocus());await page.waitForTimeout(160);const blurred=await player();await page.waitForTimeout(350);assert.equal((await player()).ammo,blurred.ammo);assert.ok(separation(blurred,await player())<.03);
  await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.restore();window.show();window.focus();});await page.waitForFunction(()=>document.hasFocus()&&!document.hidden);await page.waitForTimeout(400);assert.equal((await controller()).blocked,true);assert.equal((await player()).ammo,blurred.ammo);await neutral(200);await ensureRaid();const restored=await player();await page.waitForTimeout(350);assert.equal((await player()).ammo,restored.ammo);await tap(7);assert.ok((await player()).ammo<restored.ammo);
  pass('Native minimize/focus restore clears held fire/movement and requires neutral plus a fresh action');

  // A genuine mouse click reclaims pointer lock; then keyboard/mouse shooting
  // must still work while a connected controller is left neutral.
  await neutral();await page.mouse.click(500,360);await page.waitForFunction(()=>document.pointerLockElement&&__DF.inputDevice==='keyboard');
  await safeField();const keyboardBefore=await player();await page.keyboard.down('KeyW');await page.waitForTimeout(350);await page.keyboard.up('KeyW');assert.ok(separation(keyboardBefore,await player())>.7);
  const mouseBefore=await player();await page.mouse.down();await page.waitForTimeout(220);await page.mouse.up();assert.ok((await player()).ammo<mouseBefore.ammo);
  pass('Mouse reclaim, pointer lock and keyboard movement/fire continue to work after controller play');

  await page.evaluate(()=>__DF.persist());await page.reload();await ready();assert.equal(await page.evaluate(()=>__DF.settings.controllerSensitivity),measurements.savedSensitivity);assert.equal(await page.evaluate(()=>__DF.settings.controllerPrompts),'playstation');
  pass('Controller sensitivity and manual prompt-family settings survive native document restart in the isolated profile');
  assert.deepEqual(errors,[]);pass('No renderer or JavaScript errors during the simulated-controller native workflow');
  const appAsarSha256=createHash('sha256').update(await fs.readFile(path.join(path.dirname(exe),'resources/app.asar'))).digest('hex');
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,inputSource,physicalHardwareTested:false,exe,version,appAsarSha256,checks,errors,measurements},null,2));
}catch(error){await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,inputSource,physicalHardwareTested:false,exe,version,checks,errors,measurements,failure:error.stack},null,2));throw error;}
finally{await app?.close().catch(()=>{});}
