import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio, WEAPON_SOUND_PROFILES } from '../src/audio.js';
import { WEAPONS } from '../src/weapons.js';

// Graph-level contract tests: automation timing/PCM are verified by qa-audio.
class Parameter {
  constructor(value = 0) { this.value = value; }
  cancelScheduledValues() {}
  setTargetAtTime(value) { this.value = value; }
}
class AudioNode {
  constructor(kind) {
    this.kind = kind; this.connections = new Set();
    for (const name of ['gain', 'frequency', 'Q', 'playbackRate', 'pan', 'positionX', 'positionY', 'positionZ', 'threshold', 'knee', 'ratio', 'attack', 'release']) this[name] = new Parameter(name === 'gain' ? 1 : 0);
  }
  connect(node) { this.connections.add(node); }
  disconnect() { this.connections.clear(); }
  start() { this.started = true; }
  stop() { this.stopped = true; this.onended?.(); }
}
function fakeContext() {
  const nodes = [], listener = {};
  for (const key of ['positionX', 'positionY', 'positionZ', 'forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ']) listener[key] = new Parameter();
  const context = { state: 'running', currentTime: 0, sampleRate: 1000, listener, destination: new AudioNode('destination'), nodes,
    createBuffer(channels, length) { const data = Array.from({ length: channels }, () => new Float32Array(length)); return { duration: length / 1000, getChannelData: i => data[i] }; },
    async decodeAudioData() { return this.createBuffer(1, 1000); },
    async suspend() { this.state = 'suspended'; }, async resume() { this.state = 'running'; },
  };
  for (const kind of ['Gain', 'BiquadFilter', 'DynamicsCompressor', 'WaveShaper', 'Convolver', 'BufferSource', 'Panner', 'StereoPanner']) context[`create${kind}`] = () => { const node = new AudioNode(kind); nodes.push(node); return node; };
  return context;
}
async function setup(t) {
  const originalXHR = Object.getOwnPropertyDescriptor(globalThis, 'XMLHttpRequest');
  globalThis.XMLHttpRequest = class { open() {} send() { this.status = 200; this.response = new ArrayBuffer(8); queueMicrotask(() => this.onload()); } };
  t.after(() => { if (originalXHR) Object.defineProperty(globalThis, 'XMLHttpRequest', originalXHR); else delete globalThis.XMLHttpRequest; });
  const context = fakeContext(), audio = createAudio({ context, baseUrl: 'https://audio.test/', random: () => .5 });
  t.after(() => audio.dispose());
  await audio.ready; await audio.unlock();
  const state = { phase: 'raid', player: { x: 0, y: 0, z: 0, weapon: 'VX-9', reload: 0, heal: 0, grounded: true }, enemies: [] };
  audio.update(state, 1 / 60);
  return { audio, context, state };
}
// All graph paths, including the reflection return, must honor a muted bus.
function audiblePath(node, destination, gain = 1) {
  if (node.kind === 'Gain') gain *= node.gain.value;
  if (node === destination) return gain !== 0;
  return [...node.connections].some(next => audiblePath(next, destination, gain));
}

test('audio channel changes affect existing dry/reflection paths and future voices independently', async t => {
  const { audio, context, state } = await setup(t);
  audio.events([{ type: 'shot' }, { type: 'damage' }, { type: 'relay' }], state);
  for (let step = 0; step < 5; step++) { state.player.x += .45; audio.update(state, .05); }
  assert.deepEqual(audio.stats().voicesByBus, { weapon: 1, effects: 1, footsteps: 1, ambient: 0, ui: 1 });
  const playing = context.nodes.filter(node => node.kind === 'BufferSource' && node.started && !node.stopped);
  const wind = playing.find(node => node.loop), [shot, damage, relay, footstep] = playing.filter(node => node !== wind).slice(1);
  for (const source of [wind, shot, damage, relay, footstep]) assert.ok(audiblePath(source, context.destination));
  audio.setSettings({ weaponVolume: 0 });
  assert.equal(audiblePath(shot, context.destination), false);
  assert.equal(audiblePath(damage, context.destination), true);
  audio.events([{ type: 'shot' }], state);
  const nextShot = context.nodes.findLast(node => node.kind === 'BufferSource');
  assert.equal(audiblePath(nextShot, context.destination), false);
  audio.setSettings({ effectsVolume: 0, footstepsVolume: 0, ambientVolume: 0, uiVolume: 0 });
  for (const source of [wind, damage, relay, footstep]) assert.equal(audiblePath(source, context.destination), false);
  audio.setSettings({ weaponVolume: 1, ambientVolume: .5 });
  assert.equal(audiblePath(shot, context.destination), true);
  assert.equal(audiblePath(wind, context.destination), true);
});

test('every weapon and its mechanical cycle routes through the weapon bus with bounded voices', async t => {
  const {audio,context,state}=await setup(t);
  const ambientNodes=new Set(context.nodes);
  assert.deepEqual(Object.keys(WEAPON_SOUND_PROFILES).sort(),WEAPONS.map(w=>w.id).sort());
  for(const weapon of WEAPONS){
    state.player.weapon=weapon.id;state.player.magSize=weapon.magSize;state.player.ammo=0;
    audio.events([{type:'shot',weapon:weapon.id}],state);
    const sound=WEAPON_SOUND_PROFILES[weapon.id];
    assert.ok(context.nodes.some(node=>node.kind==='BufferSource'&&Math.abs(node.playbackRate.value-sound.rate)<1e-8));
    state.player.reload=weapon.reloadSeconds*.88;state.player.reloadDuration=state.player.reload;
    audio.events([{type:'reload',duration:state.player.reload}],state);
    assert.ok(audio.stats().activeVoices<=audio.stats().maxVoices);
  }
  audio.setSettings({weaponVolume:0});
  const started=context.nodes.filter(node=>!ambientNodes.has(node)&&node.kind==='BufferSource'&&node.started&&!node.stopped&&!node.loop);
  for(const node of started)assert.equal(audiblePath(node,context.destination),false);
});

test('focus muting follows current master volume and normal dynamics are restored exactly', async t => {
  const { audio, context } = await setup(t);
  const normal = audio.stats().compressor;
  audio.setFocused(false);
  assert.equal(audio.stats().gains.master, .65);
  audio.setSettings({ muteOnBlur: true, dynamicRange: 'night' });
  assert.equal(audio.stats().muted, true);
  assert.equal(audio.stats().gains.master, 0);
  assert.ok(audio.stats().compressor.threshold < normal.threshold);
  audio.setVolume(.31);
  assert.equal(audio.stats().gains.master, 0);
  audio.setFocused(true);
  assert.equal(audio.stats().gains.master, .31);
  audio.setFocused(false); audio.setSettings({ muteOnBlur: false, dynamicRange: 'normal' });
  assert.equal(audio.stats().gains.master, .31);
  assert.deepEqual(audio.stats().compressor, normal);
  audio.suspend(); assert.equal(context.state, 'suspended');
  await audio.unlock(); assert.equal(context.state, 'running');
  assert.equal(audio.stats().gains.master, .31);
});

test('invalid settings, missing audio hardware and repeated disposal remain safe', async t => {
  const { audio, context } = await setup(t);
  audio.setSettings({ volume: -1, weaponVolume: 2, effectsVolume: NaN, uiVolume: '0', dynamicRange: 'invalid', muteOnBlur: 1 });
  assert.equal(audio.stats().settings.volume, 0);
  assert.equal(audio.stats().settings.weaponVolume, 1);
  assert.equal(audio.stats().settings.effectsVolume, 1);
  assert.equal(audio.stats().settings.uiVolume, 1);
  assert.equal(audio.stats().settings.dynamicRange, 'normal');
  assert.equal(audio.stats().settings.muteOnBlur, false);
  audio.dispose(); audio.dispose(); audio.setSettings({ volume: 1 }); audio.setFocused(false);
  await audio.unlock();
  assert.ok(context.nodes.every(node => node.connections.size === 0));
  assert.equal(audio.stats().activeVoices, 0);
  const unavailable = createAudio();
  assert.equal(await unavailable.ready, false);
  unavailable.setSettings({ volume: .2, muteOnBlur: true }); unavailable.setFocused(false);
  assert.equal(unavailable.stats().muted, true);
  assert.equal(unavailable.stats().available, false);
  await unavailable.unlock(); unavailable.dispose();
});
