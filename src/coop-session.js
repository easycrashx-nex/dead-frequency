import { createGame, validateProfile, KIT_COSTS, isWalkable } from './simulation.js';
import { SPAWN } from './layout.js';

export const COOP_PROTOCOL = 1;
export const COOP_TICK_RATE = 60;
export const COOP_SNAPSHOT_RATE = 20;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const copy = value => structuredClone(value);
const neutral = player => ({ forward: 0, right: 0, yaw: player.yaw, pitch: player.pitch,
  sprint: false, crouch: false, jump: false, aim: false, fire: false });
const publicEnemy = e => ({ id: e.id, x: e.x, y: e.y, z: e.z, yaw: e.yaw, hp: e.hp,
  kind: e.kind, mode: e.mode, attackFlash: e.attackFlash, hitFlash: e.hitFlash, dead: e.dead,
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
    aim: raw.aim === true, fire: raw.fire === true };
}

// Two server-owned player controllers share one enemy array and one loot array.
// Only this coordinator advances AI. Clients never provide position or damage.
export function createCoopSession({ seed } = {}) {
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
    if (target && target.events.length < 512) target.events.push(event);
  }
  function spillLoot(player) {
    const { state } = player.game;
    for (const item of state.raid.loot) {
      const worldItem = state.loot.find(value => value.id === item.id);
      if (!worldItem) continue;
      let spot = null;
      for (const radius of [0, 1, 2, 3, 5]) {
        for (let i = 0; i < 12; i++) {
          const x = state.player.x + Math.cos(i * Math.PI / 6) * radius;
          const z = state.player.z + Math.sin(i * Math.PI / 6) * radius;
          if (isWalkable(x, z, .3)) { spot = { x, z }; break; }
        }
        if (spot) break;
      }
      Object.assign(worldItem, spot ?? {}, { taken: false });
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
          else if (['enemyShot', 'relay', 'drop'].includes(event.type)) queue(other.id, { ...event, playerId: source.id });
          else if (event.type === 'extract') queue(other.id, { type: 'notice', text: `${source.name} hat erfolgreich extrahiert.` });
        }
      }
    }
  }

  async function join({ name, profile, kit = 'scout' } = {}) {
    if (disposed || phase !== 'lobby') throw new Error('Dieser Raid hat bereits begonnen.');
    if (players.size >= 2) throw new Error('Die Koop-Lobby ist voll (2 Spieler).');
    const clean = validateProfile(profile);
    if (clean.intake.length) throw new Error('Zuerst die zurückgebrachte Beute zuhause einlagern.');
    if (!Object.hasOwn(KIT_COSTS, kit)) throw new Error('Unbekanntes Ausrüstungspaket.');
    if (clean.credits < KIT_COSTS[kit]) throw new Error('Nicht genug Credits für dieses Kit. Scout ist kostenlos.');
    const id = `player-${nextId++}`;
    const player = { id, name: typeof name === 'string' ? name.replace(/[\p{C}<>]/gu, '').trim().slice(0, 24) || 'Operator' : 'Operator',
      ready: false, kit, connected: true, game: null, events: [], input: null, lastSeq: -1, lastInputAt: time,
      jumpQueued: false, jumpHeld: false, lastActionAt: -1 };
    players.set(id, player); // Reserve the slot before asynchronous WASM initialization.
    hostId ??= id;
    try {
      player.game = await createGame(clean, { externalAI: true, playerId: id });
      if (disposed || !players.has(id)) { player.game.dispose(); throw new Error('Sitzung wurde geschlossen.'); }
      player.input = neutral(player.game.state.player);
      return id;
    } catch (error) {
      players.delete(id);
      if (hostId === id) hostId = players.keys().next().value ?? null;
      throw error;
    }
  }
  function ready(id, value, kit) {
    const player = member(id);
    if (phase !== 'lobby') throw new Error('Der Raid läuft bereits.');
    if (typeof value !== 'boolean') throw new Error('Ungültiger Bereitschaftsstatus.');
    if (kit !== undefined) {
      if (!Object.hasOwn(KIT_COSTS, kit) || player.game.state.profile.credits < KIT_COSTS[kit]) throw new Error('Dieses Kit ist nicht verfügbar.');
      player.kit = kit;
    }
    player.ready = value; return true;
  }
  function start(id, { difficulty = 'normal', seed: requestedSeed = seed } = {}) {
    if (disposed || phase !== 'lobby') throw new Error('Der Raid wurde bereits gestartet.');
    if (id !== hostId) throw new Error('Nur der Host kann den Raid starten.');
    if (players.size !== 2 || [...players.values()].some(p => !p.connected || !p.game || !p.ready)) throw new Error('Beide Spieler müssen bereit sein.');
    if (!['normal', 'hard'].includes(difficulty)) throw new Error('Unbekannter Schwierigkeitsgrad.');
    for (const p of players.values()) if (p.game.state.profile.intake.length || p.game.state.profile.credits < KIT_COSTS[p.kit]) throw new Error('Ausrüstung oder Beute eines Spielers ist noch nicht bereit.');
    const raidSeed = Number.isFinite(requestedSeed) ? requestedSeed >>> 0 : (Date.now() ^ Math.floor(Math.random() * 0xFFFFFFFF)) >>> 0;
    let index = 0;
    for (const p of players.values()) {
      if (!p.game.startRaid({ difficulty, kit: p.kit, seed: raidSeed })) throw new Error('Raid konnte nicht gestartet werden.');
      if (!primary) primary = p.game;
      else { p.game.state.enemies = primary.state.enemies; p.game.state.loot = primary.state.loot; }
      p.game.teleport(SPAWN.x + index * 2.2, SPAWN.z + index * .8);
      p.input = neutral(p.game.state.player); p.jumpQueued = p.jumpHeld = false; p.lastInputAt = time;
      index++;
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
    return true;
  }
  function action(id, actionName, itemId) {
    const player = member(id);
    if (phase !== 'raid' || player.game.state.phase !== 'raid') return false;
    if (!['reload', 'heal', 'interact', 'drop'].includes(actionName)) throw new Error('Unbekannte Aktion.');
    if (actionName === 'drop' && (typeof itemId !== 'string' || itemId.length > 100)) return false;
    if (actions.length >= 16 || time - player.lastActionAt < .075) return false;
    player.lastActionAt = time; actions.push({ id, actionName, itemId }); return true;
  }
  function update(dt = 1 / COOP_TICK_RATE) {
    if (disposed || phase !== 'raid' || !Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, .05); time += dt; tick++;
    const currentInputs = new Map();
    for (const player of players.values()) {
      if (!player.game || !player.connected) continue;
      const current = time - player.lastInputAt > .3 ? neutral(player.game.state.player) : { ...player.input, jump: player.jumpQueued };
      player.jumpQueued = false; currentInputs.set(player.id, current); player.game.update(dt, current);
    }
    const pending = actions; actions = [];
    for (const request of pending) {
      const player = players.get(request.id);
      if (!player?.connected || player.game.state.phase !== 'raid') continue;
      if (request.actionName === 'drop') player.game.dropItem(request.itemId);
      else player.game[request.actionName]();
      synchronizeRelay();
    }
    for (const player of players.values()) {
      if (!currentInputs.get(player.id)?.fire) continue;
      const p = player.game.state.player, cp = Math.cos(p.pitch);
      player.game.fire({ x: -Math.sin(p.yaw) * cp, y: Math.sin(p.pitch), z: -Math.cos(p.yaw) * cp });
    }
    const targets = [...players.values()].filter(p => p.connected && p.game).map(p => ({ id: p.id, state: p.game.state, damage: p.game.receiveDamage }));
    primary.advanceEnemies(dt, targets);
    collectEvents();
    if ([...players.values()].every(p => !p.connected || p.game.state.phase !== 'raid')) phase = 'finished';
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
    const state = copy({ ...s, enemies: s.enemies.map(publicEnemy), teammates,
      multiplayer: true, playerId: id, hostId, coopPhase: phase });
    const events = player.events; player.events = [];
    return { type: 'snapshot', seq: tick, ack: player.lastSeq, state, events: copy(events) };
  }
  function lobby() {
    return { type: 'lobby', hostId, phase, players: [...players.values()].filter(p => p.connected && p.game).map(p => ({ id: p.id, name: p.name, ready: p.ready, kit: p.kit })) };
  }
  return { join, ready, start, input, action, update, leave, snapshot, lobby, players,
    get hostId() { return hostId; }, get phase() { return phase; },
    close() {
      if (disposed) return;
      for (const id of players.keys()) leave(id, 'Host hat die Sitzung beendet');
      disposed = true; for (const p of players.values()) p.game?.dispose(); actions = [];
    } };
}
