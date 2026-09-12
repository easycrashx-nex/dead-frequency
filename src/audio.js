import { hasLineOfSight } from './simulation.js';
import { getWeapon, WEAPONS } from './weapons.js';

// Characterful mixes of the recorded samples, retaining their real transients.
export const WEAPON_SOUND_PROFILES = {
  'VX-9': {sample:'smg-shot',rate:1,gain:.57,cutoff:19000,send:.26},
  'AR-4': {sample:'rifle-shot',rate:1,gain:.67,cutoff:19000,send:.26},
  'BR-12': {sample:'rifle-shot',rate:1.12,gain:.61,cutoff:14200,send:.2},
  'SG-8': {sample:'rifle-shot',rate:.72,gain:.76,cutoff:11500,send:.32},
  'DMR-7': {sample:'rifle-shot',rate:.88,gain:.7,cutoff:16700,send:.3},
  'SR-90': {sample:'rifle-shot',rate:.68,gain:.79,cutoff:15500,send:.36},
  'MG-60': {sample:'rifle-shot',rate:.9,gain:.64,cutoff:12800,send:.23},
  'RV-6': {sample:'smg-shot',rate:.82,gain:.68,cutoff:16400,send:.19},
};
const familySounds={smg:'VX-9',assault:'AR-4',bullpup:'BR-12',shotgun:'SG-8',marksman:'DMR-7',sniper:'SR-90',machinegun:'MG-60',revolver:'RV-6',pistol:'RV-6'};
for(const [index,weapon] of WEAPONS.entries())if(!WEAPON_SOUND_PROFILES[weapon.id]){
  const base=WEAPON_SOUND_PROFILES[familySounds[weapon.model]||'AR-4'];
  WEAPON_SOUND_PROFILES[weapon.id]={...base,rate:base.rate*(1+(index%9-4)*.012),gain:base.gain*(.95+(index%5)*.02),cutoff:base.cutoff-(index%7)*340};
}

// Recorded CC0 firearm and Foley samples; provenance ships in audio/CREDITS.md.
const SAMPLES = [
  ...Array.from({ length: 3 }, (_, i) => `smg-shot-${i + 1}`),
  ...Array.from({ length: 3 }, (_, i) => `rifle-shot-${i + 1}`),
  'reload-out', 'reload-in', 'reload-bolt',
  ...Array.from({ length: 6 }, (_, i) => `footstep-${i + 1}`), 'wind',
];
const MAX_VOICES = 32;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const DEFAULT_SETTINGS = Object.freeze({ volume: .65, weaponVolume: 1, effectsVolume: 1, footstepsVolume: 1, ambientVolume: 1, uiVolume: 1, muteOnBlur: false, dynamicRange: 'normal' });
const CHANNEL_SETTINGS = { weapon: 'weaponVolume', effects: 'effectsVolume', footsteps: 'footstepsVolume', ambient: 'ambientVolume', ui: 'uiVolume' };
const DYNAMICS = {
  normal: { threshold: -10, knee: 12, ratio: 6, attack: .002, release: .13 },
  night: { threshold: -20, knee: 18, ratio: 8, attack: .003, release: .2 },
};

export function createAudio(options = {}) {
  const random = options.random || Math.random;
  let ctx;
  try { ctx = options.context || new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); } catch {}
  const buffers = new Map(), voices = new Set(), choices = new Map(), failed = [], enemySteps = new Map();
  let disposed = false, focused = true, peakVoices = 0, footsteps = 0, lastPhase = 'hub';
  const settings = { ...DEFAULT_SETTINGS }, channels = {};
  let lastPlayer = null, travel = 0, footSide = 1, jumpPeak = 0, windSource = null;
  let master, gameplay, ambience, mix, impulse, highpass, compressor, ceiling, spatialPrimer;

  function load(id) {
    // XHR also supports local file URLs in the isolated Electron renderer.
    const base = options.baseUrl || new URL(`${import.meta.env.BASE_URL}audio/`, document.baseURI).href;
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest(); request.open('GET', new URL(`${id}.ogg`, base));
      request.responseType = 'arraybuffer'; request.timeout = 15000;
      request.onload = () => (request.status === 0 || request.status < 400) && request.response?.byteLength
        ? resolve(request.response) : reject(new Error(`Audio ${id}: ${request.status}`));
      request.onerror = request.ontimeout = () => reject(new Error(`Audio ${id} unavailable`)); request.send();
    }).then(data => ctx.decodeAudioData(data)).then(buffer => { if (!disposed) buffers.set(id, buffer); });
  }

  function reflections() {
    const impulse = ctx.createBuffer(2, Math.ceil(ctx.sampleRate * .64), ctx.sampleRate);
    // Sparse industrial-yard reflections, without a large-room reverb wash.
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (const [delay, gain] of [[.047,.24],[.089,.15],[.143,.09],[.217,.055],[.337,.023]]) {
        const index = Math.round((delay + channel * .008) * ctx.sampleRate);
        data[index] = gain;
        for (let j = 1; j < 48; j++) data[index + j] = (random() * 2 - 1) * gain * .08 * Math.exp(-j / 14);
      }
    }
    return impulse;
  }

  if (ctx) {
    mix = ctx.createGain(); mix.gain.value = .9;
    gameplay = ctx.createGain(); gameplay.connect(mix);
    ambience = ctx.createGain(); ambience.gain.value = .035; ambience.connect(mix);
    highpass = ctx.createBiquadFilter(); highpass.type = 'highpass'; highpass.frequency.value = 28;
    compressor = ctx.createDynamicsCompressor(); compressor.threshold.value = -10; compressor.knee.value = 12;
    compressor.ratio.value = 6; compressor.attack.value = .002; compressor.release.value = .13;
    ceiling = ctx.createWaveShaper(); ceiling.curve = Float32Array.from({ length: 4097 }, (_, i) => .94 * Math.tanh((i / 2048 - 1) * 1.2) / Math.tanh(1.2));
    master = ctx.createGain(); master.gain.value = settings.volume;
    mix.connect(highpass); highpass.connect(compressor); compressor.connect(ceiling); ceiling.connect(master);
    master.connect(options.destination || ctx.destination);
    impulse = reflections();
    for (const name of Object.keys(CHANNEL_SETTINGS)) {
      const gain = ctx.createGain(); gain.connect(name === 'ui' ? mix : name === 'ambient' ? ambience : gameplay);
      channels[name] = { gain };
    }
    for (const name of ['weapon', 'footsteps']) reflectionInput(channels[name]);
    // Chromium loads the HRTF database lazily. Prime it before a first enemy shot.
    const primerSource = ctx.createBufferSource(), primerPanner = ctx.createPanner();
    primerPanner.panningModel = 'HRTF'; primerPanner.positionX.value = 3;
    primerSource.buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * .15), ctx.sampleRate);
    primerSource.buffer.getChannelData(0)[0] = 1e-9;
    primerSource.connect(primerPanner); primerPanner.connect(mix);
    primerSource.onended = () => { primerSource.disconnect(); primerPanner.disconnect(); spatialPrimer = null; };
    spatialPrimer = { source: primerSource, panner: primerPanner }; primerSource.start();
  }
  const ready = ctx ? Promise.allSettled(SAMPLES.map(async id => {
    try { await load(id); } catch { failed.push(id); }
  })).then(() => {
    if (failed.length) console.warn(`Audio samples unavailable: ${failed.join(', ')}`);
    return failed.length === 0;
  }) : Promise.resolve(false);

  function target(parameter, value) {
    parameter.cancelScheduledValues(ctx.currentTime);
    parameter.setTargetAtTime(value, ctx.currentTime, .018);
  }
  function applySettings() {
    if (!ctx || disposed) return;
    target(master.gain, !focused && settings.muteOnBlur ? 0 : settings.volume);
    for (const [name, key] of Object.entries(CHANNEL_SETTINGS)) target(channels[name].gain.gain, settings[key]);
    for (const [key, value] of Object.entries(DYNAMICS[settings.dynamicRange])) target(compressor[key], value);
  }
  function setSettings(next = {}) {
    if (disposed || !next || typeof next !== 'object') return;
    for (const key of ['volume', ...Object.values(CHANNEL_SETTINGS)]) if (Number.isFinite(next[key])) settings[key] = clamp(next[key], 0, 1);
    if (typeof next.muteOnBlur === 'boolean') settings.muteOnBlur = next.muteOnBlur;
    if (Object.hasOwn(DYNAMICS, next.dynamicRange)) settings.dynamicRange = next.dynamicRange;
    applySettings();
  }
  function setFocused(value) {
    if (disposed) return;
    focused = !!value;
    if (master) target(master.gain, !focused && settings.muteOnBlur ? 0 : settings.volume);
  }
  function reflectionInput(channel) {
    // Separate returns let each channel control already ringing reflections too.
    if (!channel.reverb) {
      channel.reverb = ctx.createConvolver(); channel.reverb.normalize = false; channel.reverb.buffer = impulse;
      channel.reverbOut = ctx.createGain(); channel.reverbOut.gain.value = .6;
      channel.reverb.connect(channel.reverbOut); channel.reverbOut.connect(channel.gain);
    }
    return channel.reverb;
  }

  function clean(voice) {
    if (!voices.delete(voice)) return;
    for (const node of voice.nodes) node.disconnect();
  }
  function stop(voice) {
    try { voice.source.stop(); } catch {}
    clean(voice);
  }
  function cancel(tag) {
    for (const voice of [...voices]) if (!tag || voice.tag === tag) stop(voice);
  }
  function variant(prefix, count) {
    const previous = choices.get(prefix) ?? -1;
    let index = Math.floor(random() * count);
    if (index === previous) index = (index + 1) % count;
    choices.set(prefix, index); return `${prefix}-${index + 1}`;
  }

  function listener(player) {
    if (!ctx || !player) return;
    const ear = ctx.listener, y = (player.y || 0) + (player.crouching ? 1.17 : 1.65);
    const yaw = player.yaw || 0, pitch = player.pitch || 0, cp = Math.cos(pitch);
    ear.positionX.value = player.x; ear.positionY.value = y; ear.positionZ.value = player.z;
    ear.forwardX.value = -Math.sin(yaw) * cp; ear.forwardY.value = Math.sin(pitch); ear.forwardZ.value = -Math.cos(yaw) * cp;
    ear.upX.value = Math.sin(yaw) * Math.sin(pitch); ear.upY.value = cp; ear.upZ.value = Math.cos(yaw) * Math.sin(pitch);
  }

  function play(id, { gain = .4, rate = 1, delay = 0, pan = 0, position = null, cutoff = 19000, send = 0, tag = 'world', bus = null, duration = null } = {}) {
    if (!ctx || disposed || ctx.state !== 'running' || !buffers.has(id)) return null;
    if (voices.size >= MAX_VOICES) {
      const oldest = [...voices].find(v => v.tag !== 'result' && v.tag !== 'reload') || voices.values().next().value;
      stop(oldest);
    }
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), level = ctx.createGain();
    const panner = position ? ctx.createPanner() : ctx.createStereoPanner();
    source.buffer = buffers.get(id); source.playbackRate.value = rate;
    filter.type = 'lowpass'; filter.frequency.value = cutoff; filter.Q.value = .5;
    level.gain.value = gain;
    if (position) {
      panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse'; panner.refDistance = 3; panner.rolloffFactor = .7; panner.maxDistance = 130;
      panner.positionX.value = position.x; panner.positionY.value = position.y ?? 1.4; panner.positionZ.value = position.z;
    } else panner.pan.value = clamp(pan, -1, 1);
    const channelName = bus || (tag === 'shot' || tag === 'reload' ? 'weapon' : tag === 'footstep' ? 'footsteps' : tag === 'result' ? 'ui' : 'effects');
    const channel = channels[channelName];
    source.connect(filter); filter.connect(level); level.connect(panner); panner.connect(channel.gain);
    const nodes = [source, filter, level, panner];
    if (send > 0) { const wet = ctx.createGain(); wet.gain.value = send; panner.connect(wet); wet.connect(reflectionInput(channel)); nodes.push(wet); }
    const starts = ctx.currentTime + delay;
    const voice = { source, nodes, tag, bus: channelName, starts, id }; voices.add(voice); peakVoices = Math.max(peakVoices, voices.size);
    source.onended = () => clean(voice);
    source.start(starts, 0, duration || source.buffer.duration);
    return voice;
  }

  function syncPhase(state) {
    if (!ctx || !state || lastPhase === state.phase) return;
    if (state.phase !== 'raid') {
      for (const voice of [...voices]) if (voice.tag !== 'result') stop(voice);
      gameplay.gain.cancelScheduledValues(ctx.currentTime); gameplay.gain.setTargetAtTime(0, ctx.currentTime, .018);
    } else {
      gameplay.gain.cancelScheduledValues(ctx.currentTime); gameplay.gain.setTargetAtTime(1, ctx.currentTime, .018);
      if (state.player.reload > 0) reloadSequence(state.player.reload, state.player.weapon, state.player.reloadDuration, state.player.magSize-state.player.ammo);
    }
    ambience.gain.cancelScheduledValues(ctx.currentTime);
    ambience.gain.setTargetAtTime(state.phase === 'raid' ? .065 : state.phase === 'hub' ? .035 : .018, ctx.currentTime, .3);
    lastPhase = state.phase; lastPlayer = null; travel = 0; enemySteps.clear();
  }

  function reloadSequence(remaining, weapon, duration, missing=1) {
    cancel('reload');
    const full = duration || getWeapon(weapon)?.reloadSeconds || 1.7, elapsed = Math.max(0, full - remaining);
    let steps=[['reload-out', .045, .34], ['reload-in', full * .53, .43], ['reload-bolt', full - .27, .4]];
    if(weapon==='SG-8'){
      const shells=Math.max(1,Math.min(8,missing));
      steps=[['reload-out',.05,.2],...Array.from({length:shells},(_,i)=>['reload-in',full*(.18+i*.64/shells),.2]),['reload-bolt',full*.92,.32]];
    }else if(weapon==='RV-6')steps=[['reload-out',.05,.26],['reload-bolt',full*.25,.18],['reload-in',full*.62,.32],['reload-bolt',full*.92,.24]];
    else if(weapon==='MG-60')steps=[['reload-bolt',full*.1,.34],['reload-out',full*.3,.3],['reload-in',full*.59,.43],['reload-bolt',full*.88,.4]];
    for (const [id, at, gain] of steps) {
      if (at >= elapsed) play(id, { gain, delay: at - elapsed, pan: .07, rate: .98 + random() * .04, tag: 'reload' });
    }
  }

  function footstep(player, sprint = false, position = null, landing = false) {
    const quiet = player.crouching;
    footsteps++;
    play(variant('footstep', 6), { gain: (landing ? .47 : sprint ? .35 : quiet ? .095 : .23) * (.9 + random() * .2),
      rate: (landing ? .88 : .96) + random() * .08, pan: position ? 0 : (footSide *= -1) * .14,
      position, cutoff: quiet ? 3800 : 14000, send: .04, tag: 'footstep' });
  }

  function events(list, state) {
    if (!ctx || disposed) return;
    syncPhase(state); listener(state.player);
    for (const event of list) {
      if (state.phase !== 'raid' && !['extract', 'death'].includes(event.type)) continue;
      switch (event.type) {
        case 'shot': {
          cancel('heal');
          const weapon=event.weapon||state.player.weapon, sound=WEAPON_SOUND_PROFILES[weapon]||WEAPON_SOUND_PROFILES['VX-9'];
          const noise=clamp(event.noiseMultiplier??state.player.weaponStats?.noiseMultiplier??1,.2,1.3), model=getWeapon(weapon)?.model;
          play(variant(sound.sample, 3), { gain:sound.gain*noise, rate:sound.rate*(.978 + random() * .044), cutoff:noise<.8?Math.min(sound.cutoff,7000+6000*noise):sound.cutoff, pan:.035, send:sound.send*noise, tag:'shot' });
          if(model==='shotgun'||model==='sniper')play('reload-bolt',{gain:.24,rate:model==='shotgun'?.76:.98,delay:(state.player.cycleDuration||getWeapon(weapon)?.fireInterval||.8)*.5,tag:'weapon-cycle',bus:'weapon',cutoff:7000});
          break;
        }
        case 'teammateShot':
        case 'enemyShot': {
          const position = event.from || event, player = state.player;
          const distance = Math.hypot(position.x - player.x, (position.y ?? 1.4) - (player.y + 1.65), position.z - player.z);
          const blocked = !hasLineOfSight(position, { x: player.x, y: player.y + (player.crouching ? 1.17 : 1.65), z: player.z });
          const sound=WEAPON_SOUND_PROFILES[event.type==='teammateShot'?event.weapon:'AR-4']||WEAPON_SOUND_PROFILES['AR-4'];
          const noise=clamp(event.noiseMultiplier??1,.2,1.3);
          play(variant(sound.sample, 3), { gain: (blocked ? .43 : 1)*sound.gain*noise, rate: sound.rate*(.96 + random() * .075),
            position, delay: Math.min(.35, distance / 343), cutoff: blocked ? 950 : clamp(17000*Math.min(1,noise) / (1 + distance * .065), 2100, 17000), send: .36*noise, tag: 'enemy', bus: 'weapon' });
          break;
        }
        case 'reload': reloadSequence(event.duration || state.player.reload, state.player.weapon, event.duration || state.player.reloadDuration, state.player.magSize-state.player.ammo); break;
        case 'heal':
          if (event.stage === 'complete') { cancel('heal'); play('reload-in', { gain: .075, rate: 1.25, cutoff: 3700 }); }
          else { cancel('reload'); play('reload-out', { gain: .12, rate: .8, cutoff: 4200, tag: 'heal' }); play('reload-in', { gain: .085, delay: .7, rate: .9, cutoff: 3000, tag: 'heal' }); }
          break;
        case 'hit': play('reload-bolt', { gain: event.headshot ? .12 : .08, rate: 1.4, cutoff: 5300, duration: .065 }); break;
        case 'damage': play(variant('footstep', 6), { gain: .36, rate: .72, cutoff: 1000 }); break;
        case 'loot': play('reload-out', { gain: .13, rate: 1.08, cutoff: 6500, bus: 'ui' }); break;
        case 'containerOpen':
          play('reload-bolt', { gain: .2, rate: .7, cutoff: 4200, position: {x:event.x,y:.7,z:event.z}, send: .08 });
          play('reload-out', { gain: .12, rate: .75, cutoff: 2900, delay: .13, position: {x:event.x,y:.7,z:event.z} }); break;
        case 'containerSearched': play('reload-in', { gain: .09, rate: .85, cutoff: 3600, position: {x:event.x,y:.7,z:event.z} }); break;
        case 'relay': play('reload-bolt', { gain: .16, rate: .85, bus: 'ui' }); break;
        case 'extract': play('reload-in', { gain: .17, rate: .9, tag: 'result' }); break;
        case 'death': play(variant('footstep', 6), { gain: .34, rate: .64, cutoff: 700, tag: 'result' }); break;
      }
    }
  }

  function update(state, dt) {
    if (!ctx || disposed) return;
    syncPhase(state); listener(state.player);
    if (state.phase !== 'raid' || ctx.state !== 'running') return;
    const player = state.player;
    if (player.reload <= 0) for (const voice of [...voices]) if (voice.tag === 'reload' && voice.starts > ctx.currentTime) stop(voice);
    if (player.heal <= 0) cancel('heal');
    if (lastPlayer) {
      const moved = Math.hypot(player.x - lastPlayer.x, player.z - lastPlayer.z);
      jumpPeak = Math.max(jumpPeak, player.y);
      if (!lastPlayer.grounded && player.grounded && jumpPeak - player.y > .25) footstep(player, false, null, true);
      if (player.grounded) jumpPeak = player.y;
      if (player.grounded && lastPlayer.grounded && moved > .0005 && moved < Math.max(.5, dt * 12)) {
        travel += moved;
        const length = player.sprinting ? 2.0 : player.crouching ? 1.45 : 1.75;
        if (travel >= length) { travel %= length; footstep(player, player.sprinting); }
      } else if (moved < .0005 || moved > 2) travel = 0;
    }
    lastPlayer = { x: player.x, y: player.y, z: player.z, grounded: player.grounded };
    const nearby = (state.enemies || []).filter(e => !e.dead && Math.hypot(e.x - player.x, e.z - player.z) < 18
      && hasLineOfSight({ ...e, y: 1.2 }, { ...player, y: player.y + 1.4 }))
      .sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z)).slice(0, 4);
    const present = new Set();
    for (const enemy of nearby) {
      present.add(enemy.id);
      const previous = enemySteps.get(enemy.id) || { x: enemy.x, z: enemy.z, travel: 0 };
      const moved = Math.hypot(enemy.x - previous.x, enemy.z - previous.z);
      if (moved < .7) previous.travel += moved;
      if (previous.travel > 1.7) {
        previous.travel = 0;
        if (hasLineOfSight({ ...enemy, y: 1.2 }, { ...player, y: player.y + 1.4 })) footstep({}, false, { x: enemy.x, y: .2, z: enemy.z });
      }
      previous.x = enemy.x; previous.z = enemy.z; enemySteps.set(enemy.id, previous);
    }
    for (const id of enemySteps.keys()) if (!present.has(id)) enemySteps.delete(id);
  }

  async function unlock() {
    if (!ctx || disposed) return;
    try {
      if (ctx.state === 'suspended' && ctx.resume) await ctx.resume();
      await ready;
      if (!windSource && !disposed && options.ambience !== false && buffers.has('wind')) {
        windSource = ctx.createBufferSource(); windSource.buffer = buffers.get('wind'); windSource.loop = true;
        windSource.connect(channels.ambient.gain); windSource.start();
      }
    } catch { /* No audio device must not prevent playing. */ }
  }

  return {
    ready, unlock, events, update, setSettings, setFocused,
    setVolume(value) { setSettings({ volume: value }); },
    suspend() { if (!ctx || disposed) return; cancel(); lastPlayer = null; travel = 0; ctx.suspend?.()?.catch?.(() => {}); },
    stats() { return { available: !!ctx, activeVoices: voices.size, peakVoices, maxVoices: MAX_VOICES, pending: [...voices].filter(v => v.starts > ctx.currentTime).length,
      footsteps, loadedSamples: buffers.size, failedSamples: [...failed], settings: { ...settings }, focused, muted: !focused && settings.muteOnBlur,
      contextState: ctx?.state ?? 'unavailable', disposed,
      gains: { master: master?.gain.value ?? 0, gameplay: gameplay?.gain.value ?? 0, ambience: ambience?.gain.value ?? 0,
        ...Object.fromEntries(Object.entries(channels).map(([name, channel]) => [name, channel.gain.gain.value])) },
      gainTargets: { master: !focused && settings.muteOnBlur ? 0 : settings.volume, ...Object.fromEntries(Object.entries(CHANNEL_SETTINGS).map(([name, key]) => [name, settings[key]])) },
      compressor: Object.fromEntries(Object.keys(DYNAMICS.normal).map(key => [key, compressor?.[key].value ?? null])),
      voicesByBus: Object.fromEntries(Object.keys(CHANNEL_SETTINGS).map(name => [name, [...voices].filter(voice => voice.bus === name).length])) }; },
    dispose() {
      if (disposed) return; disposed = true; cancel();
      if (windSource) { try { windSource.stop(); } catch {} windSource.disconnect(); windSource = null; }
      if (spatialPrimer) { const primer = spatialPrimer; spatialPrimer = null; try { primer.source.stop(); } catch {} primer.source.disconnect(); primer.panner.disconnect(); }
      for (const channel of Object.values(channels)) for (const node of [channel.gain, channel.reverb, channel.reverbOut]) node?.disconnect();
      for (const node of [gameplay, ambience, mix, highpass, compressor, ceiling, master]) node?.disconnect();
      buffers.clear(); enemySteps.clear(); impulse = null; if (!options.context) ctx?.close()?.catch?.(() => {});
    },
  };
}
