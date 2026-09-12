import './style.css';
import { createGame } from './simulation.js';
import { createRenderer } from './render.js';
import { createUI } from './ui.js';
import { createAudio } from './audio.js';
import { createRecoil } from './recoil.js';
import * as economy from './economy.js';
import {createCoopClient,parseInvite} from './coop-client.js';
import {sanitizeSettings,bindingAction,rebindSetting,resetSettingsCategory} from './settings.js';
import {createGamepadInput} from './gamepad.js';
import {resolveLoadout} from './loadouts.js';
import {createRuntimeRecovery} from './runtime-recovery.js';
import {createOnlineClient,createOnlineHub,onlineError} from './online-client.js';

const SAVE_KEY='dead-frequency.profile.v2', LEGACY_SAVE_KEY='dead-frequency.profile.v1', SETTINGS_KEY='dead-frequency.settings.v1';
const canvas=document.querySelector('#game'),root=document.querySelector('#ui');
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const read=(key)=>{try{return JSON.parse(localStorage.getItem(key));}catch{return null;}};
const stored=read(SETTINGS_KEY)||{};
const settings=sanitizeSettings(stored);
if(new URLSearchParams(location.search).has('graphicsRecovery'))settings.renderScale=Math.min(settings.renderScale,.75);
const keys=new Set();
let game,view,ui,audio,lookYaw=0,lookPitch=0,fire=false,firePressed=false,aim=false,jump=false,lookDX=0,lookDY=0;
let sprintToggle=false,crouchToggle=false,renderElapsed=0,autoReloadDelay=0;
let mapOpen=false,inventoryOpen=false,lastContainerId=null,lastPhase='hub',lastDowned=false,savingFailed=false;
let frames=0,fps=60,fpsTime=0,uiTime=0,clock=0,raf,hidden=false;
const recoil=createRecoil();
const controller=createGamepadInput();
let controllerState={connected:false,supported:false,held:{},pressed:{},menu:{x:0,y:0}},inputDevice='keyboard',lastUtilityOpen=false;
let marketTimer;
let contextLost=false,frameFailed=false;
const recovery=createRuntimeRecovery({restart(){persist();settingsChanged({renderScale:.75});location.reload();}});
let localGame,coop=null,coopBusy=false,coopGeneration=0;
let onlineHub=null,lastOnlinePoll=0;
const online=createOnlineClient({request:window.platform?.onlineRequest?.bind(window.platform),
  onProfile(profile){if(onlineHub)onlineHub.state.profile=structuredClone(profile);},
  onSession(active){
    closePanels();clearInputs();unlock();recoil.reset();
    if(active){onlineHub=createOnlineHub(localGame,online.profile);game=onlineHub;}
    else{onlineHub=null;game=localGame;game.returnToHub();}
    lastPhase='';
  },
});
const coopStatus={status:'offline',players:[],name:read('dead-frequency.operator')||'Operator',invite:'',message:''};
function persist() {
  // Never serialize an online snapshot into the separate offline save.
  if(!localGame||online.info.authenticated||online.info.restoring||onlineHub)return;
  try{localStorage.setItem(SAVE_KEY,JSON.stringify(localGame.getSave()));savingFailed=false;}
  catch{if(!savingFailed)ui?.events([{type:'notice',text:'Speicher nicht verfügbar. Fortschritt gilt für diese Sitzung.'}]);savingFailed=true;}
}
function clearInputs(resetController=true){
  keys.clear();fire=firePressed=false;aim=false;jump=false;sprintToggle=crouchToggle=false;lookDX=lookDY=0;
  if(resetController){controller.reset();controllerState={...controllerState,moveX:0,moveY:0,lookX:0,lookY:0,held:{},pressed:{},menu:{x:0,y:0}};}
  coop?.clearInput?.();
}
function controllerPresent(){return inputDevice==='controller'&&controllerState.connected&&controllerState.supported;}
function controllerActive(){return controllerPresent()&&settings.controllerEnabled;}
function controllerRaidEnabled(){
  if(controllerPresent()&&!settings.controllerEnabled){ui.events([{type:'notice',text:'Aktiviere die Controller-Steuerung unter Einstellungen → Controller.'}]);return false;}
  return true;
}
function setInputDevice(device){
  if(inputDevice===device)return;
  clearInputs(device!=='controller');inputDevice=device;
  document.body.classList.toggle('controller-active',device==='controller');
  if(device==='controller')unlock();
}
function gameplayInputActive(){return !contextLost&&!frameFailed&&game?.state.phase==='raid'&&!mapOpen&&!inventoryOpen&&!containerOpen()&&!ui?.isUtilityOpen?.()&&document.hasFocus()&&(controllerActive()||document.pointerLockElement===canvas);}
function containerOpen(){return !!game?.state.activeContainerId;}
function closePanels(){mapOpen=inventoryOpen=false;game?.closeContainer?.();lastContainerId=null;ui?.closePanels();}
function closeFieldPanel(){closePanels();clearInputs();if(game.state.phase==='raid')lock();}
function toggleFieldPanel(kind){
  const open=kind==='map'?mapOpen:inventoryOpen;
  if(open){closeFieldPanel();return;}
  game.closeContainer();lastContainerId=null;
  mapOpen=kind==='map';inventoryOpen=kind==='inventory';clearInputs();ui.togglePanel(kind);unlock();
}
function unlock(){if(document.pointerLockElement)document.exitPointerLock();document.body.classList.remove('locked');}
function pause(){if(game.state.phase==='raid'){game.pause(true);clearInputs();closePanels();unlock();recoil.reset();}}
function lock(){
  if(controllerActive()){unlock();return;}
  if(document.pointerLockElement===canvas)return;
  try{
    const pending=canvas.requestPointerLock();
    pending?.catch(()=>{pause();ui.events([{type:'notice',text:'Maus konnte nicht übernommen werden. Klicke auf Fortsetzen.'}]);});
  }catch{pause();}
}
function resume(){
  if(!controllerRaidEnabled())return;
  if(game.state.phase==='paused')game.pause(false);
  if(game.state.phase==='raid'){clearInputs();audio.unlock();lock();}
}
function start(options){
  if(!controllerRaidEnabled())return false;
  if(online.info.busy||online.info.restoring)return false;
  if(coop||coopBusy){ui.events([{type:'notice',text:'Verlasse zuerst die Koop-Lobby, um allein zu spielen.'}]);return false;}
  if(online.info.authenticated)return joinOnline(options,'solo');
  if(!game.startRaid(options))return false;
  closePanels();clearInputs();recoil.reset();lookYaw=game.state.player.yaw;lookPitch=game.state.player.pitch||0;
  audio.unlock();lock();persist();return true;
}
function saveSettings(){
  try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));}catch{}
}
function settingsChanged(next){
  const previousFullscreen=settings.fullscreen;
  Object.assign(settings,sanitizeSettings(next,settings));
  if(['bindings','aimMode','sprintMode','crouchMode','controllerEnabled','controllerAimMode','controllerSprintMode','controllerCrouchMode'].some(key=>Object.hasOwn(next,key)))clearInputs();
  view.setSettings(settings);audio.setSettings(settings);audio.setFocused(!hidden&&document.hasFocus());
  saveSettings();
  if(previousFullscreen!==settings.fullscreen||next===settings){
    const fullscreen=window.platform?.setFullscreen?window.platform.setFullscreen(settings.fullscreen):settings.fullscreen?document.documentElement.requestFullscreen?.():document.fullscreenElement?document.exitFullscreen():null;
    fullscreen?.catch(()=>{settings.fullscreen=false;saveSettings();ui?.events([{type:'notice',text:'Vollbild konnte nicht aktiviert werden. Versuche es erneut im Menü.'}]);});
  }
}
function rebind(action,code){
  const result=rebindSetting(settings,action,code);
  if(result.ok)settingsChanged({bindings:result.bindings});
  return result;
}
function actionDown(action){for(const code of keys)if(bindingAction(settings.bindings,code)===action)return true;return false;}
function onKeyDown(e){
  if(contextLost||frameFailed)return;
  if(e.defaultPrevented)return;
  if(ui?.isUtilityOpen?.()){if(e.code==='Escape'){e.preventDefault();ui.closeUtility();}return;}
  if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;
  const code=e.code;
  if(containerOpen()&&code==='Tab')return;
  const action=bindingAction(settings.bindings,code);
  if(['raid','paused'].includes(game.state.phase)&&(action||code==='Escape'))e.preventDefault();
  if(e.repeat){
    if(game.state.phase==='raid'&&!mapOpen&&!inventoryOpen&&!containerOpen()&&document.pointerLockElement===canvas&&['forward','backward','left','right','sprint','crouch'].includes(action))keys.add(code);
    return;
  }
  if(code==='Escape'){if(mapOpen||inventoryOpen||containerOpen())closeFieldPanel();else if(game.state.phase==='raid')pause();else if(game.state.phase==='paused')resume();return;}
  if(game.state.phase!=='raid')return;
  if(action==='inventory'){toggleFieldPanel('inventory');return;}
  if(action==='map'){toggleFieldPanel('map');return;}
  if(mapOpen||inventoryOpen||containerOpen())return;
  if(action&&document.pointerLockElement!==canvas)lock();
  keys.add(code);
  switch(action){
    case 'reload':game.reload();break;
    case 'heal':game.heal();break;
    case 'interact':game.interact();break;
    case 'jump':jump=true;break;
    case 'sprint':if(settings.sprintMode==='toggle')sprintToggle=!sprintToggle;break;
    case 'crouch':if(settings.crouchMode==='toggle')crouchToggle=!crouchToggle;break;
  }
}
function onKeyUp(e){keys.delete(e.code);}
function onMouseMove(e){
  if(controllerActive()&&game.state.phase==='raid'&&!mapOpen&&!inventoryOpen&&!containerOpen()&&document.pointerLockElement!==canvas)return;
  if(e.movementX||e.movementY)setInputDevice('keyboard');
  if(game.state.phase!=='raid'||mapOpen||inventoryOpen||containerOpen()||document.pointerLockElement!==canvas)return;
  const sensitivity=settings.sensitivity*.0018*(aim?settings.adsSensitivity:1);
  lookYaw-=e.movementX*sensitivity;lookPitch=clamp(lookPitch-e.movementY*sensitivity*(settings.invertY?-1:1),-1.45,1.45);
  lookDX+=e.movementX;lookDY+=e.movementY;
}
function onMouseDown(e){
  setInputDevice('keyboard');
  if(game.state.phase==='raid'&&!mapOpen&&!inventoryOpen&&!containerOpen()&&!ui?.isUtilityOpen?.()&&document.pointerLockElement!==canvas&&e.target===canvas){lock();return;}
  if(game.state.phase!=='raid'||mapOpen||inventoryOpen||containerOpen()||document.pointerLockElement!==canvas)return;
  if(e.button===0){fire=true;firePressed=true;}if(e.button===2)aim=settings.aimMode==='toggle'?!aim:true;
}
function onMouseUp(e){if(e.button===0)fire=false;if(e.button===2&&settings.aimMode==='hold')aim=false;}
function onLock(){
  const locked=document.pointerLockElement===canvas;document.body.classList.toggle('locked',locked);
  if(!locked&&!controllerActive()&&game?.state.phase==='raid'&&!mapOpen&&!inventoryOpen&&!containerOpen())pause();
}
function inputState(){
  const offset=recoil.offset();
  if(!gameplayInputActive())return {yaw:lookYaw+offset.yaw,pitch:clamp(lookPitch+offset.pitch,-1.45,1.45)};
  const pad=controllerActive(),sprintMode=pad?settings.controllerSprintMode:settings.sprintMode,crouchMode=pad?settings.controllerCrouchMode:settings.crouchMode;
  if(game?.state.player.sprintExhausted&&sprintMode==='toggle')sprintToggle=false;
  return {forward:pad?controllerState.moveY:Number(actionDown('forward'))-Number(actionDown('backward')),right:pad?controllerState.moveX:Number(actionDown('right'))-Number(actionDown('left')),yaw:lookYaw+offset.yaw,pitch:clamp(lookPitch+offset.pitch,-1.45,1.45),sprint:sprintMode==='toggle'?sprintToggle:pad?controllerState.held.sprint:actionDown('sprint'),crouch:crouchMode==='toggle'?crouchToggle:pad?controllerState.held.crouch:actionDown('crouch'),jump,aim,fire,firePressed,reviveHeld:pad?!!controllerState.held.interact:actionDown('interact')};
}
function controllerBack(){
  if(ui?.isUtilityOpen?.()){ui.closeUtility();clearInputs();}
  else if(mapOpen||inventoryOpen||containerOpen())closeFieldPanel();
  else if(game.state.phase==='paused')resume();
}
function pollController(dt){
  if(contextLost||frameFailed)return;
  const wasConnected=controllerState.connected,wasActive=inputDevice==='controller';
  let pads=[];try{pads=navigator.getGamepads?.()||[];}catch{}
  const lostActive=wasActive&&wasConnected&&!Array.from(pads).some((pad,index)=>pad&&pad.connected!==false&&(pad.index??index)===controllerState.index&&pad.id===controllerState.id);
  const menuOpen=game.state.phase!=='raid'||mapOpen||inventoryOpen||containerOpen()||ui.isUtilityOpen();
  controllerState=controller.poll(pads,menuOpen&&!settings.controllerEnabled?{...settings,controllerEnabled:true}:settings,dt);
  if(lostActive||(wasActive&&wasConnected&&(!controllerState.connected||!controllerState.supported))){
    pause();clearInputs();controller.stopRumble?.();setInputDevice('keyboard');
    ui.events([{type:'notice',text:lostActive||!controllerState.connected?'Controller getrennt. Verbinde ihn erneut oder nutze Maus und Tastatur.':'Die Controller-Belegung wird nicht unterstützt.'}]);
    return;
  }
  if(!document.hasFocus()||hidden||!controllerState.connected||!controllerState.supported)return;
  if(controllerState.activity){setInputDevice('controller');audio.unlock();}
  if(!controllerPresent())return;
  if(!menuOpen&&!settings.controllerEnabled){pause();controllerRaidEnabled();return;}
  const pressed=controllerState.pressed;
  if(pressed.pause){
    if(ui.isUtilityOpen())controllerBack();
    else if(mapOpen||inventoryOpen||containerOpen())closeFieldPanel();
    else if(game.state.phase==='raid')pause();
    else if(game.state.phase==='paused')resume();
    return;
  }
  if((inventoryOpen&&pressed.inventory)||(mapOpen&&pressed.map)){closeFieldPanel();return;}
  if(game.state.phase!=='raid'||mapOpen||inventoryOpen||containerOpen()||ui.isUtilityOpen()){
    const handled=ui.controllerNavigate?.({...controllerState.menu,confirm:pressed.confirm,back:pressed.back,tabPrev:pressed.tabPrev,tabNext:pressed.tabNext},dt);
    if(pressed.back&&!handled)controllerBack();
    return;
  }
  if(pressed.inventory){toggleFieldPanel('inventory');return;}
  if(pressed.map){toggleFieldPanel('map');return;}
  if(settings.controllerAimMode==='toggle'){if(pressed.aim)aim=!aim;}else aim=controllerState.held.aim;
  if(pressed.sprint&&settings.controllerSprintMode==='toggle')sprintToggle=!sprintToggle;
  if(pressed.crouch&&settings.controllerCrouchMode==='toggle')crouchToggle=!crouchToggle;
  fire=controllerState.held.fire;firePressed||=pressed.fire;jump||=pressed.jump;
  const scale=2.7*settings.controllerSensitivity*(aim?settings.controllerAdsSensitivity:1)*dt;
  lookYaw-=controllerState.lookX*scale;lookPitch=clamp(lookPitch-controllerState.lookY*scale,-1.45,1.45);
  lookDX+=controllerState.lookX*scale/.0018;lookDY+=controllerState.lookY*scale/.0018;
  if(pressed.reload)game.reload();
  if(pressed.heal)game.heal();
  if(pressed.interact)game.interact();
}
function aimDirection(){const p=game.state.player,cp=Math.cos(p.pitch);return {x:-Math.sin(p.yaw)*cp,y:Math.sin(p.pitch),z:-Math.cos(p.yaw)*cp};}
function pumpEvents(){
  const events=game.drainEvents();
  if(coop)for(const event of events)if(event.type==='shot')recoil.shot({weapon:game.state.player.weapon,stats:game.state.player.weaponStats,aim,crouch:game.state.player.crouching,multiplier:game.state.player.recoilMultiplier});
  if(controllerActive()&&document.hasFocus()&&settings.controllerVibration){
    if(events.some(event=>event.type==='damage'))controller.rumble?.({duration:140,strongMagnitude:.5,weakMagnitude:.3});
    else if(events.some(event=>event.type==='shot'))controller.rumble?.({duration:65,strongMagnitude:.12,weakMagnitude:.24});
  }
  if(events.length){view.events(events);audio.events(events,game.state);ui.events(events);}
}
function frame(now){
  if(frameFailed){raf=requestAnimationFrame(frame);return;}
  try{
  const elapsed=Math.max(0,(now-clock)/1000),dt=clamp(elapsed,0,.1);clock=now;
  pollController(dt);
  if(!hidden){
    const utilityOpen=!!ui.isUtilityOpen();if(utilityOpen!==lastUtilityOpen){clearInputs();lastUtilityOpen=utilityOpen;}
    let input=inputState();
    // Bounded fixed substeps preserve collisions, AI timers and weapon cadence across frame rates.
    accumulator=Math.min(accumulator+dt,.15);
    while(accumulator>=1/60){
      recoil.update(1/60);input=inputState();
      game.update(1/60,input);
      autoReloadDelay=Math.max(0,autoReloadDelay-1/60);
      if(settings.autoReload&&!autoReloadDelay&&game.state.phase==='raid'&&!mapOpen&&!inventoryOpen&&!containerOpen()&&!ui?.isUtilityOpen?.()){
        const p=game.state.player;
        if(p.ammo===0&&p.reserve>0&&!p.reload&&!p.heal){game.reload();autoReloadDelay=.5;}
      }
      if(gameplayInputActive()&&(fire||firePressed)&&game.fire(aimDirection(),{triggerPressed:firePressed})){
        recoil.shot({weapon:game.state.player.weapon,stats:game.state.player.weaponStats,aim,crouch:game.state.player.crouching,multiplier:game.state.player.recoilMultiplier});
        const offset=recoil.offset();game.state.player.yaw=lookYaw+offset.yaw;game.state.player.pitch=clamp(lookPitch+offset.pitch,-1.45,1.45);
      }
      jump=firePressed=false;input.jump=input.firePressed=false;accumulator-=1/60;
    }
    pumpEvents();
    const state=game.state;
    if(!!state.player?.downed!==lastDowned){lastDowned=!!state.player?.downed;clearInputs();recoil.reset();closePanels();}
    if((state.activeContainerId||null)!==lastContainerId){
      const wasOpen=!!lastContainerId;lastContainerId=state.activeContainerId||null;
      if(lastContainerId){mapOpen=inventoryOpen=false;ui.closePanels();clearInputs();unlock();}
      else if(wasOpen&&state.phase==='raid'&&!mapOpen&&!inventoryOpen){clearInputs();pause();}
    }
    if(state.phase!==lastPhase){
      if(state.phase!=='raid'){clearInputs();unlock();}
      if(['extracted','dead','hub'].includes(state.phase))persist();
      lastPhase=state.phase;
    }
    view.update(state,dt,{aim,crouch:input.crouch,lookDX,lookDY,time:now/1000,fov:settings.fov});
    renderElapsed+=elapsed;
    const frameLimit=state.phase==='hub'?Math.min(settings.fpsLimit||30,30):settings.fpsLimit;
    if(!contextLost&&(!frameLimit||renderElapsed>=1/frameLimit)){view.render();frames++;renderElapsed=frameLimit?renderElapsed%(1/frameLimit):0;}
    audio.update(state,dt);lookDX=lookDY=0;
    fpsTime+=elapsed;if(fpsTime>=.5){fps=Math.round(frames/fpsTime);frames=0;fpsTime=0;}
    uiTime+=dt;
    if(uiTime>=1/20){ui.update(state,{locked:document.pointerLockElement===canvas||controllerActive(),fps,settings,mapOpen,inventoryOpen,aim,coop:coop?.info||coopStatus,online:online.info,controller:{...controllerState,active:controllerPresent()},inputDevice});uiTime=0;}
  }
  }catch(error){frameFailed=true;console.error(error);clearInputs();pause();persist();recovery.show({raid:['raid','paused'].includes(game.state.phase)});}
  raf=requestAnimationFrame(frame);
}
let accumulator=0;
function marketTick(){
  if(online.info.authenticated){if(game?.state.phase==='hub'&&!coop&&!coopBusy&&!hidden&&Date.now()-lastOnlinePoll>=10000){lastOnlinePoll=Date.now();online.refresh();}return;}
  if(game&&!coop&&!coopBusy&&!online.info.busy&&economy.advanceMarket(localGame.state.profile))persist();
}
async function remoteAction(kind,action,args){
  try{const result=await online.action(kind,action,args);if(!result)ui.events([{type:'notice',text:'Aktion nicht möglich. Prüfe Guthaben, Auswahl und Voraussetzungen.'}]);return result;}
  catch(error){ui.events([{type:'notice',text:onlineError(error)}]);return false;}
}
function homeAction(action,...args){
  if(game.state.phase!=='hub')return false;
  if(online.info.busy)return false;
  if(coop||coopBusy){ui.events([{type:'notice',text:'Lager und Markt sind nach dem Verlassen der Koop-Sitzung wieder verfügbar.'}]);return false;}
  if(online.info.authenticated)return remoteAction('economy',action,args);
  marketTick();const result=economy[action](game.state.profile,...args);persist();
  if(!result)ui.events([{type:'notice',text:'Aktion nicht möglich. Prüfe Auswahl, Preis und freie Angebotsplätze.'}]);
  return result;
}
function hubGameAction(action,...args){
  if(game.state.phase!=='hub')return false;
  if(online.info.busy)return false;
  if(coop||coopBusy){ui.events([{type:'notice',text:'Verlasse zuerst die Koop-Lobby, um Ausrüstung oder Fähigkeiten zu ändern.'}]);return false;}
  if(online.info.authenticated)return remoteAction('game',action,args);
  const result=game[action](...args);pumpEvents();persist();return result;
}
async function leaveCoop(){
  if(online.info.busy)return false;
  coopGeneration++;
  coopBusy=false;
  const active=coop;coop=null;active?.leave();
  game=online.info.authenticated?onlineHub:localGame;game.returnToHub();closePanels();clearInputs();unlock();recoil.reset();
  Object.assign(coopStatus,{status:'offline',players:[],invite:'',message:'',online:false,mode:'coop',minPlayers:2,maxPlayers:2});
  if(online.info.authenticated){
    try{await online.leaveRoom();return true;}catch(error){ui.events([{type:'notice',text:onlineError(error)}]);return false;}
  }
  await window.platform?.stopHost();marketTick();persist();return true;
}
async function joinCoop(options,hosting){
  if(online.info.authenticated)return joinOnline(options,hosting?'coop':'join');
  if(online.info.busy||online.info.restoring)return false;
  if(coop?.info.status==='error'&&game.state.phase==='hub')await leaveCoop();
  if(coopBusy||coop||game.state.phase!=='hub')return;
  if(game.state.profile.intake.length){ui.events([{type:'notice',text:'Zuerst die Beute aus dem letzten Raid einlagern.'}]);return;}
  const prepared=resolveLoadout(game.state.profile,options);
  if(!prepared.valid||!prepared.affordable){ui.events([{type:'notice',text:prepared.reason||'Nicht genug Credits für das gewählte Loadout.'}]);return;}
  if(!window.platform){Object.assign(coopStatus,{status:'error',message:'Koop ist in der Windows-Version verfügbar.'});return;}
  coopBusy=true;Object.assign(coopStatus,{status:hosting?'hosting':'connecting',message:hosting?'Einladung wird erstellt …':'Verbindung wird aufgebaut …',name:options.name});
  const generation=++coopGeneration;
  try{
    marketTick();persist();
    try{localStorage.setItem('dead-frequency.operator',JSON.stringify(String(options.name||'Operator').slice(0,20)));}catch{}
    const host=hosting?await window.platform.host({internet:options.internet!==false}):null;
    if(!hosting){
      try{parseInvite(options.invite);}catch{throw new Error('Bitte füge die vollständige Koop-Einladung deines Mitspielers ein.');}
      coopStatus.message='Einladung wird geprüft …';
      await window.platform.prepareInvite(options.invite);
    }
    if(generation!==coopGeneration)return;
    const client=createCoopClient({localGame,onProfile:persist,onRaid(state){closePanels();clearInputs();recoil.reset();lookYaw=state.player.yaw;lookPitch=state.player.pitch;audio.unlock();lock();},onDisconnect(){clearInputs();closePanels();unlock();persist();}});
    coop=client;
    await client.connect(host?.localUrl||options.invite,{...options,profile:localGame.getSave(),invitation:host?.invite||options.invite});
    if(generation!==coopGeneration){client.leave();return;}
    game=client;
  }catch(error){
    if(generation!==coopGeneration)return;
    coop?.leave();coop=null;game=localGame;await window.platform.stopHost();
    const message=String(error?.message||'Verbindung fehlgeschlagen.').replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');
    if(generation===coopGeneration)Object.assign(coopStatus,{status:'error',message});
  }
  finally{if(generation===coopGeneration)coopBusy=false;}
}
async function joinOnline(options,mode){
  if(coop?.info.status==='error'&&game.state.phase==='hub')await leaveCoop();
  if(coopBusy||coop||online.info.busy||!online.info.authenticated||game.state.phase!=='hub')return false;
  if(online.info.room){ui.events([{type:'notice',text:'Dein Konto hat noch eine aktive Sitzung. Öffne Konto und verlasse sie zuerst.'}]);return false;}
  if(game.state.profile.intake.length){ui.events([{type:'notice',text:'Lagere zuerst die Beute aus dem letzten Raid ein.'}]);return false;}
  const prepared=resolveLoadout(game.state.profile,options);
  if(!prepared.valid||!prepared.affordable){ui.events([{type:'notice',text:prepared.reason||'Nicht genug Credits für dieses Loadout.'}]);return false;}
  coopBusy=true;const generation=++coopGeneration;
  Object.assign(coopStatus,{status:'connecting',message:mode==='solo'?'Online-Soloeinsatz wird vorbereitet …':'Online-Team wird verbunden …',name:online.info.user.username,online:true,mode:mode==='join'?'coop':mode});
  try{
    const room=await online.room(mode,{...options,loadout:prepared.selection});
    if(!room||generation!==coopGeneration)return false;
    let autoStarted=false;
    const client=createCoopClient({localGame:onlineHub,
      onChange(info){if(mode==='solo'&&!autoStarted&&info.status==='lobby'&&info.players?.find(p=>p.id===info.id)?.ready){autoStarted=true;client.start();}},
      onProfile(profile){online.accept(profile);},
      onRaid(state){closePanels();clearInputs();recoil.reset();lookYaw=state.player.yaw;lookPitch=state.player.pitch;audio.unlock();lock();},
      onDisconnect(){clearInputs();closePanels();unlock();online.leaveRoom().catch(error=>ui.events([{type:'notice',text:onlineError(error)}]));},
    });
    coop=client;game=client;
    await client.connect(room.url||room.invite,{ticket:room.ticket,online:true,mode:mode==='join'?'coop':mode,name:online.info.user.username,invitation:room.invite,difficulty:options.difficulty});
    if(generation!==coopGeneration){client.leave();return false;}
    if(mode==='solo')client.ready(true);
    return true;
  }catch(error){
    if(generation!==coopGeneration)return false;
    coop?.leave();coop=null;game=onlineHub;game.returnToHub();
    try{await online.leaveRoom();}catch{}
    const message=onlineError(error);Object.assign(coopStatus,{status:'error',message});ui.events([{type:'notice',text:message}]);return false;
  }finally{if(generation===coopGeneration)coopBusy=false;}
}
async function boot(){
  game=localGame=await createGame(read(SAVE_KEY)??read(LEGACY_SAVE_KEY));view=createRenderer(canvas,game.layout);audio=createAudio();
  await audio.ready;
  ui=createUI(root,{start,resume,hub(){if(coop||online.info.room)return leaveCoop();game.returnToHub();closePanels();clearInputs();unlock();persist();},upgrade:kind=>hubGameAction('buyUpgrade',kind),
    accountAuthenticate:(kind,name,password)=>{if(coop||coopBusy||game.state.phase!=='hub')return false;return online.authenticate(kind,name,password);},
    accountLogout:()=>{if(coop||coopBusy||game.state.phase!=='hub'||online.info.room)return false;return online.logout();},
    coopHost:options=>joinCoop(options,true),coopJoin:options=>joinCoop(options,false),coopReady:ready=>coop?.ready(ready),coopStart:()=>coop?.start(),coopLeave:leaveCoop,
    coopCopyInvite:()=>window.platform?.copyInvite(coop?.info.invite||'').then(()=>ui.events([{type:'notice',text:'Einladung kopiert. Deinem Kollegen schicken und im Spiel einfügen.'}])),
    pasteClipboard:()=>window.platform?.readClipboard?.()??navigator.clipboard?.readText?.()??Promise.resolve(''),
    selectWeapon:id=>hubGameAction('selectWeapon',id),unlockSkill:id=>hubGameAction('unlockSkill',id),
    selectLoadout:selection=>hubGameAction('selectLoadout',selection),
    purchaseEquipment:id=>hubGameAction('purchaseEquipment',id),
    equipLoadout:(slot,id)=>hubGameAction('equipLoadout',slot,id),
    mountAttachment:(weaponId,slot,attachmentId)=>hubGameAction('mountAttachment',weaponId,slot,attachmentId),
    setLoadoutMedkits:count=>hubGameAction('equipLoadout','medkits',count),
    equipRaidItem(id){const result=game.equipRaidItem(id);pumpEvents();return result;},
    dropEquipment(slot){const result=game.dropEquipment(slot);pumpEvents();return result;},
    dropItem(id){const result=game.dropItem(id);pumpEvents();return result;},closeFieldPanel,
    takeContainerItem(containerId,itemId){const result=game.takeContainerItem(containerId,itemId);pumpEvents();return result;},
    takeAllContainerItems(containerId){const result=game.takeAllContainerItems(containerId);pumpEvents();return result;},closeContainer:closeFieldPanel,
    storeItem:id=>homeAction('storeItem',id),storeAll:()=>homeAction('storeAll'),listItem:(id,price,duration)=>homeAction('listItem',id,price,duration),
    cancelListing:id=>homeAction('cancelListing',id),claimMail:id=>homeAction('claimMail',id),claimAll:()=>homeAction('claimAll'),
    settings:settingsChanged,resetSettings:category=>settingsChanged(resetSettingsCategory(settings,category)),rebind,quit(){window.close();}});
  settingsChanged(settings);ui.update(game.state,{locked:false,fps,settings,mapOpen:false,inventoryOpen:false,aim:false,coop:coopStatus,online:online.info});
  // Resolve a saved online session before advancing the separate offline market.
  online.restore().then(()=>{if(!online.info.authenticated)marketTick();});
  marketTimer=setInterval(marketTick,1000);
  window.platform?.onStatus(value=>{if(value.type==='hosting')coopStatus.message=value.message;else if(value.type==='tunnelLost'){if(coop)coop.info.message=value.message;ui.events([{type:'notice',text:value.message}]);}});
  window.addEventListener('keydown',()=>setInputDevice('keyboard'),true);
  document.addEventListener('keydown',onKeyDown);document.addEventListener('keyup',onKeyUp);
  document.addEventListener('mousemove',onMouseMove);document.addEventListener('mousedown',onMouseDown);document.addEventListener('mouseup',onMouseUp);
  document.addEventListener('contextmenu',e=>e.preventDefault());document.addEventListener('pointerlockchange',onLock);
  window.addEventListener('resize',()=>view.resize());
  window.addEventListener('blur',()=>{pause();clearInputs();controller.stopRumble?.();audio.setFocused(false);});
  window.addEventListener('focus',()=>{controller.reset();audio.setFocused(!hidden);});
  window.platform?.onFullscreen?.(value=>{settings.fullscreen=!!value;saveSettings();});
  document.addEventListener('fullscreenchange',()=>{if(!window.platform?.setFullscreen){settings.fullscreen=!!document.fullscreenElement;saveSettings();}});
  document.addEventListener('visibilitychange',()=>{hidden=document.hidden;audio.setFocused(!hidden&&document.hasFocus());if(hidden){pause();clearInputs();audio.suspend();persist();}else{controller.reset();clock=performance.now();marketTick();audio.unlock();}});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();contextLost=true;pause();clearInputs();persist();recovery.show({waiting:true,raid:['raid','paused'].includes(game.state.phase)});});
  canvas.addEventListener('webglcontextrestored',()=>{view.restoreContext();contextLost=false;frameFailed=false;recovery.hide();clock=performance.now();ui.events([{type:'notice',text:'Anzeige wiederhergestellt. Dein Spielstand ist unverändert.'}]);});
  window.addEventListener('beforeunload',()=>{marketTick();persist();});
  window.addEventListener('unload',()=>{clearInterval(marketTimer);cancelAnimationFrame(raf);controller.stopRumble?.();coop?.dispose();localGame.dispose();view.dispose();audio.dispose();});
  // Explicit QA mode only. Normal releases do not publish gameplay mutation controls.
  if(import.meta.env.DEV||new URLSearchParams(location.search).has('qa')){
    window.__DF={get game(){return game;},get state(){return game.state;},get coop(){return coop;},get inputDevice(){return inputDevice;},get controllerState(){return controllerState;},controller,stats:()=>({...view.stats(),renderedFps:fps}),settings,settingsChanged,inputState,start,pause,resume,ui,view,audio,persist,economy,recoil,marketTick,
      syncLook(){recoil.reset();lookYaw=game.state.player.yaw;lookPitch=game.state.player.pitch||0;},
      step(seconds,input={}){for(let i=0;i<seconds*60;i++)game.update(1/60,{yaw:game.state.player.yaw,pitch:game.state.player.pitch,...input});pumpEvents();},
      teleport(x,z){game.teleport(x,z);this.syncLook();},
    };
  }
  document.documentElement.dataset.ready='true';clock=performance.now();raf=requestAnimationFrame(frame);
}
boot().catch(error=>{
  console.error(error);
  root.replaceChildren();const screen=document.createElement('div');screen.className='boot-error';
  screen.style.cssText='position:fixed;inset:0;background:#10191b;color:#eee8dc;display:grid;place-content:center;padding:3rem;font:16px/1.6 system-ui;z-index:100';
  const h=document.createElement('h1');h.textContent='DEAD FREQUENCY';const p=document.createElement('p');p.textContent='Der Start ist fehlgeschlagen. Prüfe, ob Hardwarebeschleunigung und WebGL verfügbar sind.';
  const detail=document.createElement('pre');detail.textContent=String(error.message||error);
  const button=document.createElement('button');button.textContent='Mit niedriger Grafik erneut starten';button.onclick=()=>{try{localStorage.setItem(SETTINGS_KEY,JSON.stringify({...settings,quality:'low'}));}catch{}location.reload();};
  screen.append(h,p,detail,button);root.append(screen);
});
