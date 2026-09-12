import './style.css';
import { createGame } from './simulation.js';
import { createRenderer } from './render.js';
import { createUI } from './ui.js';
import { createAudio } from './audio.js';
import { createRecoil } from './recoil.js';
import * as economy from './economy.js';
import {createCoopClient,parseInvite} from './coop-client.js';
import {sanitizeSettings,bindingAction,rebindSetting,resetSettingsCategory} from './settings.js';

const SAVE_KEY='dead-frequency.profile.v2', LEGACY_SAVE_KEY='dead-frequency.profile.v1', SETTINGS_KEY='dead-frequency.settings.v1';
const canvas=document.querySelector('#game'),root=document.querySelector('#ui');
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const read=(key)=>{try{return JSON.parse(localStorage.getItem(key));}catch{return null;}};
const stored=read(SETTINGS_KEY)||{};
const settings=sanitizeSettings(stored);
const keys=new Set();
let game,view,ui,audio,lookYaw=0,lookPitch=0,fire=false,aim=false,jump=false,lookDX=0,lookDY=0;
let sprintToggle=false,crouchToggle=false,renderElapsed=0,autoReloadDelay=0;
let mapOpen=false,inventoryOpen=false,lastPhase='hub',savingFailed=false;
let frames=0,fps=60,fpsTime=0,uiTime=0,clock=0,raf,hidden=false;
const recoil=createRecoil();
let marketTimer;
let localGame,coop=null,coopBusy=false,coopGeneration=0;
const coopStatus={status:'offline',players:[],name:read('dead-frequency.operator')||'Operator',invite:'',message:''};
function persist() {
  try{localStorage.setItem(SAVE_KEY,JSON.stringify(game.getSave()));savingFailed=false;}
  catch{if(!savingFailed)ui?.events([{type:'notice',text:'Speicher nicht verfügbar. Fortschritt gilt für diese Sitzung.'}]);savingFailed=true;}
}
function clearInputs(){keys.clear();fire=false;aim=false;jump=false;sprintToggle=crouchToggle=false;lookDX=lookDY=0;}
function closePanels(){mapOpen=inventoryOpen=false;ui?.closePanels();}
function closeFieldPanel(){closePanels();clearInputs();if(game.state.phase==='raid')lock();}
function toggleFieldPanel(kind){
  const open=kind==='map'?mapOpen:inventoryOpen;
  if(open){closeFieldPanel();return;}
  mapOpen=kind==='map';inventoryOpen=kind==='inventory';clearInputs();ui.togglePanel(kind);unlock();
}
function unlock(){if(document.pointerLockElement)document.exitPointerLock();document.body.classList.remove('locked');}
function pause(){if(game.state.phase==='raid'){game.pause(true);clearInputs();closePanels();unlock();recoil.reset();}}
function lock(){
  if(document.pointerLockElement===canvas)return;
  try{
    const pending=canvas.requestPointerLock();
    pending?.catch(()=>{pause();ui.events([{type:'notice',text:'Maus konnte nicht übernommen werden. Klicke auf Fortsetzen.'}]);});
  }catch{pause();}
}
function resume(){
  if(game.state.phase==='paused')game.pause(false);
  if(game.state.phase==='raid'){clearInputs();audio.unlock();lock();}
}
function start(options){
  if(coop||coopBusy){ui.events([{type:'notice',text:'Verlasse zuerst die Koop-Lobby, um allein zu spielen.'}]);return false;}
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
  if(['bindings','aimMode','sprintMode','crouchMode'].some(key=>Object.hasOwn(next,key)))clearInputs();
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
  if(e.defaultPrevented)return;
  if(ui?.isUtilityOpen?.()){if(e.code==='Escape'){e.preventDefault();ui.closeUtility();}return;}
  if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;
  const code=e.code;
  const action=bindingAction(settings.bindings,code);
  if(['raid','paused'].includes(game.state.phase)&&(action||code==='Escape'))e.preventDefault();
  if(e.repeat){
    if(game.state.phase==='raid'&&!mapOpen&&!inventoryOpen&&document.pointerLockElement===canvas&&['forward','backward','left','right','sprint','crouch'].includes(action))keys.add(code);
    return;
  }
  if(code==='Escape'){if(mapOpen||inventoryOpen)closeFieldPanel();else if(game.state.phase==='raid')pause();else if(game.state.phase==='paused')resume();return;}
  if(game.state.phase!=='raid')return;
  if(action==='inventory'){toggleFieldPanel('inventory');return;}
  if(action==='map'){toggleFieldPanel('map');return;}
  if(mapOpen||inventoryOpen)return;
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
  if(game.state.phase!=='raid'||mapOpen||inventoryOpen||document.pointerLockElement!==canvas)return;
  const sensitivity=settings.sensitivity*.0018*(aim?settings.adsSensitivity:1);
  lookYaw-=e.movementX*sensitivity;lookPitch=clamp(lookPitch-e.movementY*sensitivity*(settings.invertY?-1:1),-1.45,1.45);
  lookDX+=e.movementX;lookDY+=e.movementY;
}
function onMouseDown(e){
  if(game.state.phase!=='raid'||mapOpen||inventoryOpen||document.pointerLockElement!==canvas)return;
  if(e.button===0)fire=true;if(e.button===2)aim=settings.aimMode==='toggle'?!aim:true;
}
function onMouseUp(e){if(e.button===0)fire=false;if(e.button===2&&settings.aimMode==='hold')aim=false;}
function onLock(){
  const locked=document.pointerLockElement===canvas;document.body.classList.toggle('locked',locked);
  if(!locked&&game?.state.phase==='raid'&&!mapOpen&&!inventoryOpen)pause();
}
function inputState(){
  const offset=recoil.offset();
  if(mapOpen||inventoryOpen||ui?.isUtilityOpen?.())return {yaw:lookYaw+offset.yaw,pitch:clamp(lookPitch+offset.pitch,-1.45,1.45)};
  if(game?.state.player.sprintExhausted&&settings.sprintMode==='toggle')sprintToggle=false;
  return {forward:Number(actionDown('forward'))-Number(actionDown('backward')),right:Number(actionDown('right'))-Number(actionDown('left')),yaw:lookYaw+offset.yaw,pitch:clamp(lookPitch+offset.pitch,-1.45,1.45),sprint:settings.sprintMode==='toggle'?sprintToggle:actionDown('sprint'),crouch:settings.crouchMode==='toggle'?crouchToggle:actionDown('crouch'),jump,aim,fire};
}
function aimDirection(){const p=game.state.player,cp=Math.cos(p.pitch);return {x:-Math.sin(p.yaw)*cp,y:Math.sin(p.pitch),z:-Math.cos(p.yaw)*cp};}
function pumpEvents(){
  const events=game.drainEvents();
  if(coop)for(const event of events)if(event.type==='shot')recoil.shot({weapon:game.state.player.weapon,aim,crouch:game.state.player.crouching});
  if(events.length){view.events(events);audio.events(events,game.state);ui.events(events);}
}
function frame(now){
  const elapsed=Math.max(0,(now-clock)/1000),dt=clamp(elapsed,0,.1);clock=now;
  if(!hidden){
    let input=inputState();
    // Bounded fixed substeps preserve collisions, AI timers and weapon cadence across frame rates.
    accumulator=Math.min(accumulator+dt,.15);
    while(accumulator>=1/60){
      recoil.update(1/60);input=inputState();
      game.update(1/60,input);
      autoReloadDelay=Math.max(0,autoReloadDelay-1/60);
      if(settings.autoReload&&!autoReloadDelay&&game.state.phase==='raid'&&!mapOpen&&!inventoryOpen&&!ui?.isUtilityOpen?.()){
        const p=game.state.player;
        if(p.ammo===0&&p.reserve>0&&!p.reload&&!p.heal){game.reload();autoReloadDelay=.5;}
      }
      if(game.state.phase==='raid'&&fire&&!mapOpen&&!inventoryOpen&&game.fire(aimDirection())){
        recoil.shot({weapon:game.state.player.weapon,aim,crouch:game.state.player.crouching});
        const offset=recoil.offset();game.state.player.yaw=lookYaw+offset.yaw;game.state.player.pitch=clamp(lookPitch+offset.pitch,-1.45,1.45);
      }
      jump=false;input.jump=false;accumulator-=1/60;
    }
    pumpEvents();
    const state=game.state;
    if(state.phase!==lastPhase){
      if(state.phase!=='raid'){clearInputs();unlock();}
      if(['extracted','dead','hub'].includes(state.phase))persist();
      lastPhase=state.phase;
    }
    view.update(state,dt,{aim,crouch:input.crouch,lookDX,lookDY,time:now/1000,fov:settings.fov});
    renderElapsed+=elapsed;
    if(!settings.fpsLimit||renderElapsed>=1/settings.fpsLimit){view.render();frames++;renderElapsed=settings.fpsLimit?renderElapsed%(1/settings.fpsLimit):0;}
    audio.update(state,dt);lookDX=lookDY=0;
    fpsTime+=elapsed;if(fpsTime>=.5){fps=Math.round(frames/fpsTime);frames=0;fpsTime=0;}
    uiTime+=dt;
    if(uiTime>=1/20){ui.update(state,{locked:document.pointerLockElement===canvas,fps,settings,mapOpen,inventoryOpen,aim,coop:coop?.info||coopStatus});uiTime=0;}
  }
  raf=requestAnimationFrame(frame);
}
let accumulator=0;
function marketTick(){if(game&&!coop&&!coopBusy&&economy.advanceMarket(game.state.profile))persist();}
function homeAction(action,...args){
  if(game.state.phase!=='hub')return false;
  if(coop||coopBusy){ui.events([{type:'notice',text:'Lager und Markt sind nach dem Verlassen der Koop-Sitzung wieder verfügbar.'}]);return false;}
  marketTick();const result=economy[action](game.state.profile,...args);persist();
  if(!result)ui.events([{type:'notice',text:'Aktion nicht möglich. Prüfe Auswahl, Preis und freie Angebotsplätze.'}]);
  return result;
}
async function leaveCoop(){
  coopGeneration++;
  coopBusy=false;
  const active=coop;coop=null;active?.leave();
  game=localGame;game.returnToHub();closePanels();clearInputs();unlock();recoil.reset();
  Object.assign(coopStatus,{status:'offline',players:[],invite:'',message:''});
  await window.platform?.stopHost();marketTick();persist();
}
async function joinCoop(options,hosting){
  if(coop?.info.status==='error'&&game.state.phase==='hub')await leaveCoop();
  if(coopBusy||coop||game.state.phase!=='hub')return;
  if(game.state.profile.intake.length){ui.events([{type:'notice',text:'Zuerst die Beute aus dem letzten Raid einlagern.'}]);return;}
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
async function boot(){
  game=localGame=await createGame(read(SAVE_KEY)??read(LEGACY_SAVE_KEY));view=createRenderer(canvas,game.layout);audio=createAudio();
  marketTick();marketTimer=setInterval(marketTick,1000);
  await audio.ready;
  ui=createUI(root,{start,resume,hub(){if(coop){leaveCoop();return;}game.returnToHub();closePanels();clearInputs();unlock();persist();},upgrade(kind){const ok=game.buyUpgrade(kind);pumpEvents();persist();return ok;},
    coopHost:options=>joinCoop(options,true),coopJoin:options=>joinCoop(options,false),coopReady:ready=>coop?.ready(ready),coopStart:()=>coop?.start(),coopLeave:leaveCoop,
    coopCopyInvite:()=>window.platform?.copyInvite(coop?.info.invite||'').then(()=>ui.events([{type:'notice',text:'Einladung kopiert. Deinem Kollegen schicken und im Spiel einfügen.'}])),
    dropItem(id){const result=game.dropItem(id);pumpEvents();return result;},closeFieldPanel,
    storeItem:id=>homeAction('storeItem',id),storeAll:()=>homeAction('storeAll'),listItem:(id,price,duration)=>homeAction('listItem',id,price,duration),
    cancelListing:id=>homeAction('cancelListing',id),claimMail:id=>homeAction('claimMail',id),claimAll:()=>homeAction('claimAll'),
    settings:settingsChanged,resetSettings:category=>settingsChanged(resetSettingsCategory(settings,category)),rebind,quit(){window.close();}});
  settingsChanged(settings);ui.update(game.state,{locked:false,fps,settings,mapOpen:false,inventoryOpen:false,aim:false,coop:coopStatus});
  window.platform?.onStatus(value=>{if(value.type==='hosting')coopStatus.message=value.message;else if(value.type==='tunnelLost'){if(coop)coop.info.message=value.message;ui.events([{type:'notice',text:value.message}]);}});
  document.addEventListener('keydown',onKeyDown);document.addEventListener('keyup',onKeyUp);
  document.addEventListener('mousemove',onMouseMove);document.addEventListener('mousedown',onMouseDown);document.addEventListener('mouseup',onMouseUp);
  document.addEventListener('contextmenu',e=>e.preventDefault());document.addEventListener('pointerlockchange',onLock);
  window.addEventListener('resize',()=>view.resize());
  window.addEventListener('blur',()=>{pause();audio.setFocused(false);});
  window.addEventListener('focus',()=>audio.setFocused(!hidden));
  window.platform?.onFullscreen?.(value=>{settings.fullscreen=!!value;saveSettings();});
  document.addEventListener('fullscreenchange',()=>{if(!window.platform?.setFullscreen){settings.fullscreen=!!document.fullscreenElement;saveSettings();}});
  document.addEventListener('visibilitychange',()=>{hidden=document.hidden;audio.setFocused(!hidden&&document.hasFocus());if(hidden){pause();audio.suspend();persist();}else{clock=performance.now();marketTick();audio.unlock();}});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();pause();ui.events([{type:'notice',text:'Grafikkontext verloren. Die Anzeige wird nach Wiederherstellung neu geladen.'}]);persist();});
  canvas.addEventListener('webglcontextrestored',()=>location.reload());
  window.addEventListener('beforeunload',()=>{marketTick();persist();clearInterval(marketTimer);cancelAnimationFrame(raf);coop?.dispose();localGame.dispose();view.dispose();audio.dispose();});
  // Explicit QA mode only. Normal releases do not publish gameplay mutation controls.
  if(import.meta.env.DEV||new URLSearchParams(location.search).has('qa')){
    window.__DF={get game(){return game;},get state(){return game.state;},get coop(){return coop;},stats:()=>({...view.stats(),renderedFps:fps}),settings,settingsChanged,inputState,start,pause,resume,ui,view,audio,persist,economy,recoil,marketTick,
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
