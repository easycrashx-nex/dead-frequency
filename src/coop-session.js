import { createGame, validateProfile, isWalkable, hasLineOfSight,REVIVE_SECONDS } from './simulation.js';
import { getRaidSpawn, getRaidSpawnPositions, selectRaidSpawn } from './raid-spawns.js';
import { resolveLoadout } from './loadouts.js';

export const COOP_PROTOCOL = 1;
export const COOP_TICK_RATE = 60;
export const COOP_SNAPSHOT_RATE = 20;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const copy = value => structuredClone(value);
const neutral = player => ({ forward: 0, right: 0, yaw: player.yaw, pitch: player.pitch,
  sprint: false, crouch: false, jump: false, aim: false, fire: false, firePressed: false,reviveHeld:false });
const publicEnemy = e => ({ id: e.id, x: e.x, y: e.y, z: e.z, yaw: e.yaw, hp: e.hp,
  kind: e.kind,name:e.name,maxHp:e.maxHp,armor:e.armor,maxArmor:e.maxArmor,squadId:e.squadId,leaderId:e.leaderId,role:e.role,mode: e.mode, attackFlash: e.attackFlash, hitFlash: e.hitFlash, dead: e.dead,
  ...(e.ai ? { ai: { role: e.ai.role, task: e.ai.task } } : {}),
  ...(e.targetPlayerId ? { targetPlayerId: e.targetPlayerId } : {}) });

export function sanitizeCoopInput(raw, player) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  for (const key of ['forward', 'right', 'yaw', 'pitch']) {
    if (raw[key] !== undefined && !Number.isFinite(raw[key])) return null;
  }
  const yaw = raw.yaw ?? player.yaw;
  return { forward: clamp(raw.forward ?? 0, -1, 1), right: clamp(raw.right ?? 0, -1, 1),
    yaw: ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2), pitch: clamp(raw.pitch ?? player.pitch, -1.5, 1.5),
    sprint: raw.sprint === true, crouch: raw.crouch === true, jump: raw.jump === true,
    aim: raw.aim === true, fire: raw.fire === true, firePressed: raw.firePressed === true,reviveHeld:raw.reviveHeld===true };
}

// Two server-owned controllers share enemies, containers and dynamic ground drops.
// Only this coordinator advances AI. Clients never provide position or damage.
export function createCoopSession({ seed, spawnId, previousSpawnId, minPlayers = 2, maxPlayers = 2, onRaidStart = () => {}, onPlayerFinished = () => {} } = {}) {
  if (![1, 2].includes(maxPlayers) || !Number.isInteger(minPlayers) || minPlayers < 1 || minPlayers > maxPlayers) throw new Error('Ungültige Spielerzahl.');
  const players = new Map();
  let hostId = null, phase = 'lobby', nextId = 1, tick = 0, time = 0, disposed = false;
  let primary = null, actions = [], relayComplete = false;
  const member = id => {
    const value = players.get(id);
    if (!value?.game || !value.connected) throw new Error('Spieler ist nicht mit dieser Sitzung verbunden.');
    return value;
  };
  function queue(id, event) {
    const target = players.get(id);
    if (target) {
      if(target.events.length>=512){
        const disposable=target.events.findIndex(value=>!['death','extract'].includes(value.type));
        if(disposable>=0)target.events.splice(disposable,1);
        else if(['death','extract'].includes(event.type))target.events.shift();
        else return;
      }
      target.events.push(event);
    }
  }
  function spillLoot(player) {
    player.game.spillEquipment();
    const { state } = player.game;
    for (const item of state.raid.loot) {
      let worldItem = state.loot.find(value => value.id === item.id);
      let spot = null;
      for (const radius of [0, 1, 2, 3, 5]) {
        for (let i = 0; i < 12; i++) {
          const x = state.player.x + Math.cos(i * Math.PI / 6) * radius;
          const z = state.player.z + Math.sin(i * Math.PI / 6) * radius;
          const y=player.game.layout.getSupportHeight(x,z,state.player.y);
          if (Math.abs(y-state.player.y)<1&&isWalkable(x, z, .3,y) && hasLineOfSight({ ...state.player, y: state.player.y + 1.1 }, { x, y:y+.55, z })) { spot = { x,y,z }; break; }
        }
        if (spot) break;
      }
      if (!worldItem) { worldItem = { ...item, x: state.player.x, z: state.player.z }; state.loot.push(worldItem); }
      Object.assign(worldItem, copy(item), spot ?? {}, { taken: false });
    }
    state.raid.loot = []; state.raid.value = 0;
  }
  function synchronizeRelay() {
    if (!relayComplete && [...players.values()].some(p => p.game?.state.raid.objectiveComplete)) relayComplete = true;
    if (relayComplete) for (const player of players.values()) if (player.game) player.game.state.raid.objectiveComplete = true;
  }
  function collectEvents() {
    for (const source of players.values()) {
      if (!source.game) continue;
      if (!source.settled && ['dead', 'extracted'].includes(source.game.state.phase)) {
        // Durable servers persist before any result/profile is acknowledged to a client.
        onPlayerFinished(source.id, copy(source.game.state.profile), source.game.state.phase);
        source.settled = true;
      }
      for (const event of source.game.drainEvents()) {
        queue(source.id, event);
        if (event.type === 'death') {
          spillLoot(source);
          for (const other of players.values()) if (other.id !== source.id) queue(other.id,
            { type: 'notice', text: `${source.name} ist ausgeschieden. Zurückgelassene Beute kann geborgen werden.` });
        }
        for (const other of players.values()) {
          if (other.id === source.id) continue;
          if (event.type === 'shot') queue(other.id, { ...event, type: 'teammateShot', playerId: source.id });
          else if (['enemyShot', 'relay', 'drop', 'containerOpen', 'containerSearched'].includes(event.type)) queue(other.id, { ...event, playerId: source.id });
          else if (event.type === 'extract') queue(other.id, { type: 'notice', text: `${source.name} hat erfolgreich extrahiert.` });
        }
      }
    }
  }

  async function join({ name, profile, kit, weapon, loadout, host = false } = {}) {
    if (disposed || phase !== 'lobby') throw new Error('Dieser Raid hat bereits begonnen.');
    if (players.size >= maxPlayers) throw new Error(`Die Koop-Lobby ist voll (${maxPlayers} Spieler).`);
    const clean = validateProfile(profile);
    if (clean.intake.length) throw new Error('Zuerst die zurückgebrachte Beute zuhause einlagern.');
    const resolved = resolveLoadout(clean, { loadout, kit, weapon });
    if (!resolved.valid) throw new Error(resolved.reason || 'Dieses Loadout ist nicht verfügbar.');
    if (!resolved.affordable) throw new Error('Nicht genug Credits für dieses Loadout.');
    const id = `player-${nextId++}`;
    const player = { id, name: typeof name === 'string' ? name.replace(/[\p{C}<>]/gu, '').trim().slice(0, 24) || 'Operator' : 'Operator',
      ready: false, loadout: copy(resolved.selection), kit: resolved.selection.presetId, weapon: resolved.weapon.id, connected: true, game: null, events: [], input: null, lastSeq: -1, lastInputAt: time,
      jumpQueued: false, jumpHeld: false, fireQueued: false, fireHeld: false, lastActionAt: -1 };
    players.set(id, player); // Reserve the slot before asynchronous WASM initialization.
    if (host) hostId = id;
    else hostId ??= id;
    try {
      player.game = await createGame(clean, { externalAI: true, playerId: id, loadoutLocked: true,allowDowned:maxPlayers > 1 });
      if (disposed || !players.has(id)) { player.game.dispose(); throw new Error('Sitzung wurde geschlossen.'); }
      player.input = neutral(player.game.state.player);
      return id;
    } catch (error) {
      players.delete(id);
      if (hostId === id) hostId = players.keys().next().value ?? null;
      throw error;
    }
  }
  function ready(id, value, kit, weapon, loadout) {
    const player = member(id);
    if (phase !== 'lobby') throw new Error('Der Raid läuft bereits.');
    if (typeof value !== 'boolean') throw new Error('Ungültiger Bereitschaftsstatus.');
    const selection = loadout ?? (kit === undefined ? player.loadout : undefined);
    const resolved = resolveLoadout(player.game.state.profile, { loadout: selection, kit, weapon });
    if (!resolved.valid) throw new Error(resolved.reason || 'Dieses Loadout ist nicht verfügbar.');
    if (!resolved.affordable) throw new Error('Nicht genug Credits für dieses Loadout.');
    player.loadout = copy(resolved.selection); player.kit = resolved.selection.presetId; player.weapon = resolved.weapon.id;
    player.ready = value; return true;
  }
  function start(id, { difficulty = 'normal', seed: requestedSeed = seed, spawnId: requestedSpawnId = spawnId } = {}) {
    if (disposed || phase !== 'lobby') throw new Error('Der Raid wurde bereits gestartet.');
    if (id !== hostId) throw new Error('Nur der Host kann den Raid starten.');
    if (players.size < minPlayers || [...players.values()].some(p => !p.connected || !p.game || !p.ready)) throw new Error(minPlayers === 2 ? 'Beide Spieler müssen bereit sein.' : 'Alle Spieler müssen bereit sein.');
    if (!['normal', 'hard'].includes(difficulty)) throw new Error('Unbekannter Schwierigkeitsgrad.');
    // Validate everyone before consuming any participant's credits or equipment.
    for (const p of players.values()) {
      const loadout = resolveLoadout(p.game.state.profile, { loadout: p.loadout });
      if (p.game.state.profile.intake.length || !loadout.valid || !loadout.affordable) throw new Error('Ausrüstung oder Beute eines Spielers ist noch nicht bereit.');
    }
    const raidSeed = Number.isFinite(requestedSeed) ? requestedSeed >>> 0 : (Date.now() ^ Math.floor(Math.random() * 0xFFFFFFFF)) >>> 0;
    const previous = typeof previousSpawnId === 'function' ? previousSpawnId() : previousSpawnId;
    const spawn = requestedSpawnId === undefined ? selectRaidSpawn(raidSeed, previous) : getRaidSpawn(requestedSpawnId);
    const positions = getRaidSpawnPositions(spawn);
    let index = 0;
    for (const p of players.values()) {
      if (!p.game.startRaid({ difficulty, loadout: p.loadout, seed: raidSeed, spawnId: spawn.id })) throw new Error('Raid konnte nicht gestartet werden.');
      if (!primary) primary = p.game;
      else { p.game.state.enemies = primary.state.enemies; p.game.state.loot = primary.state.loot; p.game.state.containers = primary.state.containers; }
      const position = positions[index];
      if (!p.game.teleport(position.x, position.z, position.y + .02)) throw new Error('Einstiegspunkt ist blockiert.');
      p.game.state.player.yaw = spawn.yaw;
      p.input = neutral(p.game.state.player); p.jumpQueued = p.jumpHeld = p.fireQueued = p.fireHeld = false; p.lastInputAt = time;
      index++;
    }
    try {
      onRaidStart([...players.values()].map(p => ({ id: p.id, profile: copy(p.game.state.profile) })), { spawn: { ...spawn } });
    } catch (error) {
      // A failed durable commit cannot leave a playable, unpaid raid behind.
      phase = 'finished';
      for (const p of players.values()) { p.settled = true; p.game.endRaid('Einsatz konnte nicht gespeichert werden'); }
      throw error;
    }
    phase = 'raid'; collectEvents(); return true;
  }
  function input(id, seq, raw) {
    const player = member(id);
    if (phase !== 'raid' || player.game.state.phase !== 'raid' || !Number.isSafeInteger(seq) || seq < 0 || seq <= player.lastSeq) return false;
    const sanitized = sanitizeCoopInput(raw, player.game.state.player);
    if (!sanitized) return false;
    player.lastSeq = seq; player.input = sanitized; player.lastInputAt = time;
    if (sanitized.jump && !player.jumpHeld) player.jumpQueued = true;
    player.jumpHeld = sanitized.jump;
    if (sanitized.firePressed || (sanitized.fire && !player.fireHeld)) player.fireQueued = true;
    player.fireHeld = sanitized.fire;
    return true;
  }
  function action(id, actionName, itemId, containerId) {
    const player = member(id);
    if (phase !== 'raid' || player.game.state.phase !== 'raid' || player.game.state.player.downed) return false;
    if (!['reload', 'heal', 'interact', 'drop', 'take', 'takeAll', 'closeContainer', 'equip', 'dropEquipment'].includes(actionName)) throw new Error('Unbekannte Aktion.');
    const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 100;
    if (['drop', 'take', 'equip'].includes(actionName) && !validId(itemId)) return false;
    if (actionName === 'dropEquipment' && !['weapon','backpack','carrier','plate','helmet'].includes(itemId)) return false;
    if (['take', 'takeAll'].includes(actionName) && !validId(containerId)) return false;
    // One pending close per player, after earlier claims, bypasses click cadence.
    // The normal queue has 16 requests; these two reserved closes keep it bounded.
    if (actionName === 'closeContainer') {
      actions = actions.filter(request => request.id !== id || request.actionName !== 'closeContainer');
      actions.push({ id, actionName }); return true;
    }
    if (actions.length >= 16 || time - player.lastActionAt < .075) return false;
    player.lastActionAt = time; actions.push({ id, actionName, itemId, containerId }); return true;
  }
  function update(dt = 1 / COOP_TICK_RATE) {
    if (disposed || phase !== 'raid' || !Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, .05); time += dt; tick++;
    const currentInputs = new Map();
    for (const player of players.values()) {
      if (!player.game || !player.connected) continue;
      const current = time - player.lastInputAt > .3 ? neutral(player.game.state.player) : { ...player.input, jump: player.jumpQueued, firePressed: player.fireQueued };
      if(player.game.state.player.revivingTargetId){current.forward=current.right=0;current.fire=current.firePressed=current.sprint=false;}
      player.jumpQueued = player.fireQueued = false; currentInputs.set(player.id, current); player.game.update(dt, current);
    }
    const pending = actions; actions = [];
    for (const request of pending) {
      const player = players.get(request.id);
      if (!player?.connected || player.game.state.phase !== 'raid') continue;
      if (request.actionName === 'drop') player.game.dropItem(request.itemId);
      else if (request.actionName === 'take') player.game.takeContainerItem(request.containerId, request.itemId);
      else if (request.actionName === 'takeAll') player.game.takeAllContainerItems(request.containerId);
      else if (request.actionName === 'equip') player.game.equipRaidItem(request.itemId);
      else if (request.actionName === 'dropEquipment') player.game.dropEquipment(request.itemId);
      else if(request.actionName==='interact'&&reviveTarget(player)){} // Holding interact is handled continuously below.
      else player.game[request.actionName]();
      synchronizeRelay();
    }
    for (const player of players.values()) {
      const input = currentInputs.get(player.id);
      if (!input?.fire && !input?.firePressed) continue;
      const p = player.game.state.player, cp = Math.cos(p.pitch);
      player.game.fire({ x: -Math.sin(p.yaw) * cp, y: Math.sin(p.pitch), z: -Math.cos(p.yaw) * cp }, { triggerPressed: input.firePressed });
    }
    const targets = [...players.values()].filter(p => p.connected && p.game).map(p => ({ id: p.id, state: p.game.state, damage: p.game.receiveDamage }));
    primary.advanceEnemies(dt, targets);
    updateRevives(dt,currentInputs);
    const participating=[...players.values()].filter(player=>player.connected&&player.game?.state.phase==='raid');
    if(participating.length&&participating.every(player=>player.game.state.player.downed))for(const player of participating)player.game.endRaid('Team vollständig kampfunfähig');
    collectEvents();
    if ([...players.values()].every(p => !p.connected || p.game.state.phase !== 'raid')) phase = 'finished';
  }
  function reviveTarget(helper){
    const source=helper.game.state,p=source.player;if(source.phase!=='raid'||p.downed)return null;
    return [...players.values()].find(other=>other!==helper&&other.connected&&other.game?.state.phase==='raid'&&other.game.state.player.downed&&Math.hypot(other.game.state.player.x-p.x,other.game.state.player.z-p.z,other.game.state.player.y-p.y)<=2.2&&hasLineOfSight({x:p.x,y:p.y+1.1,z:p.z},{x:other.game.state.player.x,y:other.game.state.player.y+.5,z:other.game.state.player.z}));
  }
  function updateRevives(dt,inputs){
    const helped=new Set();
    for(const helper of players.values()){
      if(!helper.connected||!helper.game||helper.game.state.player.downed)continue;const state=helper.game.state,p=state.player,target=reviveTarget(helper),held=inputs.get(helper.id)?.reviveHeld;
      if(target)state.prompt={kind:'revive',id:target.id,text:p.medkits>0?`${target.name} wiederbeleben · halten (${REVIVE_SECONDS} s · 1 Medkit)`:'Wiederbelebung benötigt ein Medkit'};
      const other=target?.game.state.player;
      const interrupted=p.revivingTargetId&&(p.damageSequence!==helper.reviveDamage||other?.damageSequence!==helper.targetReviveDamage);
      if(!target||!held||p.medkits<1||p.reload>0||p.heal>0||state.activeContainerId||interrupted){p.revivingTargetId=null;p.reviveProgress=0;continue;}
      if(p.revivingTargetId!==target.id){p.revivingTargetId=target.id;p.reviveProgress=0;helper.reviveDamage=p.damageSequence;helper.targetReviveDamage=other.damageSequence;}
      p.reviveProgress=Math.min(REVIVE_SECONDS,p.reviveProgress+dt);other.reviveProgress=p.reviveProgress;helped.add(target.id);
      if(p.reviveProgress>=REVIVE_SECONDS-1e-7&&target.game.revive()){p.medkits--;p.revivingTargetId=null;p.reviveProgress=0;queue(helper.id,{type:'notice',text:`${target.name} wieder kampfbereit. Ein Medkit verbraucht.`});}
    }
    for(const player of players.values())if(player.game?.state.player.downed&&!helped.has(player.id))player.game.state.player.reviveProgress=0;
  }
  function leave(id, reason = 'Verbindung getrennt') {
    const player = players.get(id);
    if (!player || !player.connected) return false;
    player.connected = false;
    if (phase === 'lobby') {
      player.game?.dispose(); players.delete(id);
      if (hostId === id) hostId = players.keys().next().value ?? null;
    } else {
      player.game?.endRaid(reason); collectEvents();
      if ([...players.values()].every(p => !p.connected || p.game?.state.phase !== 'raid')) phase = 'finished';
    }
    return true;
  }
  function snapshot(id) {
    const player = players.get(id);
    if (!player?.game) return null;
    const s = player.game.state;
    const teammates = [...players.values()].filter(p => p.id !== id && p.game).map(p => ({ id: p.id, name: p.name,
      ...p.game.state.player, phase: p.connected ? p.game.state.phase : 'disconnected',
      dead: p.game.state.phase === 'dead', connected: p.connected }));
    const containers=s.containers.map(container=>{const nearby=container.id===s.activeContainerId||Math.hypot(container.x-s.player.x,container.z-s.player.z)<35;return{id:container.id,kind:container.kind,type:container.type,name:container.name,enemyId:container.enemyId,role:container.role,x:container.x,y:container.y,z:container.z,w:container.w,d:container.d,h:container.h,opened:container.opened,searched:container.searched,searchSeconds:container.searchSeconds,items:nearby?container.items:[]};});
    const state = copy({ ...s,containers,enemies: s.enemies.map(publicEnemy), teammates,
      multiplayer: true, playerId: id, hostId, coopPhase: phase });
    const events = player.events; player.events = [];
    return { type: 'snapshot', seq: tick, ack: player.lastSeq, state, events: copy(events) };
  }
  function lobby() {
    return { type: 'lobby', hostId, phase, mode: maxPlayers === 1 ? 'solo' : 'coop', minPlayers, maxPlayers, players: [...players.values()].filter(p => p.connected && p.game).map(p => ({ id: p.id, name: p.name, ready: p.ready, kit: p.kit, weapon: p.weapon, loadoutMode: p.loadout.mode })) };
  }
  return { join, ready, start, input, action, update, leave, snapshot, lobby, players,
    get hostId() { return hostId; }, get phase() { return phase; },
    close() {
      if (disposed) return;
      for (const id of players.keys()) leave(id, 'Host hat die Sitzung beendet');
      disposed = true; for (const p of players.values()) p.game?.dispose(); actions = [];
    } };
}
