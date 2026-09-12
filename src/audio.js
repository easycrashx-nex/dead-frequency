import { hasLineOfSight } from './simulation.js';

// Recorded CC0 firearm and Foley samples; provenance ships in audio/CREDITS.md.
const SAMPLES = [
  ...Array.from({ length: 3 }, (_, i) => `smg-shot-${i + 1}`),
  ...Array.from({ length: 3 }, (_, i) => `rifle-shot-${i + 1}`),
  'reload-out', 'reload-in', 'reload-bolt',
  ...Array.from({ length: 6 }, (_, i) => `footstep-${i + 1}`), 'wind',
];
const MAX_VOICES = 32;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function createAudio(options = {}) {
  const random = options.random || Math.random;
  let ctx;
  try { ctx = options.context || new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); } catch {}
  const buffers = new Map(), voices = new Set(), choices = new Map(), failed = [], enemySteps = new Map();
  let disposed = false, volume = .65, peakVoices = 0, footsteps = 0, lastPhase = 'hub';
  let lastPlayer = null, travel = 0, footSide = 1, jumpPeak = 0, windSource = null;
  let master, gameplay, ambience, mix, reverb, reverbOut, highpass, compressor, ceiling, spatialPrimer;

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
    master = ctx.createGain(); master.gain.value = volume;
    mix.connect(highpass); highpass.connect(compressor); compressor.connect(ceiling); ceiling.connect(master);
    master.connect(options.destination || ctx.destination);
    reverb = ctx.createConvolver(); reverb.normalize = false; reverb.buffer = reflections();
    reverbOut = ctx.createGain(); reverbOut.gain.value = .6; reverb.connect(reverbOut); reverbOut.connect(gameplay);
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

  function play(id, { gain = .4, rate = 1, delay = 0, pan = 0, position = null, cutoff = 19000, send = 0, tag = 'world', duration = null } = {}) {
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
    source.connect(filter); filter.connect(level); level.connect(panner); panner.connect(tag === 'result' ? mix : gameplay);
    const nodes = [source, filter, level, panner];
    if (send > 0) { const wet = ctx.createGain(); wet.gain.value = send; panner.connect(wet); wet.connect(reverb); nodes.push(wet); }
    const starts = ctx.currentTime + delay;
    const voice = { source, nodes, tag, starts, id }; voices.add(voice); peakVoices = Math.max(peakVoices, voices.size);
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
      if (state.player.reload > 0) reloadSequence(state.player.reload, state.player.weapon);
    }
    ambience.gain.cancelScheduledValues(ctx.currentTime);
    ambience.gain.setTargetAtTime(state.phase === 'raid' ? .065 : state.phase === 'hub' ? .035 : .018, ctx.currentTime, .3);
    lastPhase = state.phase; lastPlayer = null; travel = 0; enemySteps.clear();
  }

  function reloadSequence(remaining, weapon) {
    cancel('reload');
    const full = weapon === 'AR-4' ? 2.1 : 1.7, elapsed = Math.max(0, full - remaining);
    for (const [id, at, gain] of [['reload-out', .045, .34], ['reload-in', full * .53, .43], ['reload-bolt', full - .27, .4]]) {
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
          const rifle = (event.weapon || state.player.weapon) === 'AR-4';
          play(variant(rifle ? 'rifle-shot' : 'smg-shot', 3), { gain: rifle ? .67 : .57, rate: .978 + random() * .044, pan: .035, send: .26, tag: 'shot' });
          break;
        }
        case 'teammateShot':
        case 'enemyShot': {
          const position = event.from || event, player = state.player;
          const distance = Math.hypot(position.x - player.x, (position.y ?? 1.4) - (player.y + 1.65), position.z - player.z);
          const blocked = !hasLineOfSight(position, { x: player.x, y: player.y + (player.crouching ? 1.17 : 1.65), z: player.z });
          play(variant(event.type==='teammateShot'&&event.weapon==='VX-9'?'smg-shot':'rifle-shot', 3), { gain: blocked ? .27 : .63, rate: .96 + random() * .075,
            position, delay: Math.min(.35, distance / 343), cutoff: blocked ? 950 : clamp(17000 / (1 + distance * .065), 2100, 17000), send: .36, tag: 'enemy' });
          break;
        }
        case 'reload': reloadSequence(event.duration || state.player.reload, state.player.weapon); break;
        case 'heal':
          if (event.stage === 'complete') { cancel('heal'); play('reload-in', { gain: .075, rate: 1.25, cutoff: 3700 }); }
          else { cancel('reload'); play('reload-out', { gain: .12, rate: .8, cutoff: 4200, tag: 'heal' }); play('reload-in', { gain: .085, delay: .7, rate: .9, cutoff: 3000, tag: 'heal' }); }
          break;
        case 'hit': play('reload-bolt', { gain: event.headshot ? .12 : .08, rate: 1.4, cutoff: 5300, duration: .065 }); break;
        case 'damage': play(variant('footstep', 6), { gain: .36, rate: .72, cutoff: 1000 }); break;
        case 'loot': play('reload-out', { gain: .13, rate: 1.08, cutoff: 6500 }); break;
        case 'relay': play('reload-bolt', { gain: .16, rate: .85 }); break;
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
        windSource.connect(ambience); windSource.start();
      }
    } catch { /* No audio device must not prevent playing. */ }
  }

  return {
    ready, unlock, events, update,
    setVolume(value) { if (!Number.isFinite(value)) return; volume = clamp(value, 0, 1); if (master) { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setTargetAtTime(volume, ctx.currentTime, .018); } },
    suspend() { if (!ctx || disposed) return; cancel(); lastPlayer = null; travel = 0; ctx.suspend?.(); },
    stats() { return { available: !!ctx, activeVoices: voices.size, peakVoices, maxVoices: MAX_VOICES, pending: [...voices].filter(v => v.starts > ctx.currentTime).length,
      footsteps, loadedSamples: buffers.size, failedSamples: [...failed] }; },
    dispose() {
      if (disposed) return; disposed = true; cancel();
      if (windSource) { windSource.stop(); windSource.disconnect(); windSource = null; }
      if (spatialPrimer) { try { spatialPrimer.source.stop(); } catch {} spatialPrimer.source.disconnect(); spatialPrimer.panner.disconnect(); spatialPrimer = null; }
      for (const node of [gameplay, ambience, reverb, reverbOut, mix, highpass, compressor, ceiling, master]) node?.disconnect();
      buffers.clear(); enemySteps.clear(); if (!options.context) ctx?.close();
    },
  };
}
