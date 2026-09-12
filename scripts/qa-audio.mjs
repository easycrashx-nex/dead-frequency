import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// Run against Vite, e.g. DF_QA_URL=http://127.0.0.1:5194 node scripts/qa-audio.mjs.
// An isolated page exercises the production mixer with actual Web Audio PCM;
// no renderer, game state mutation, microphone, device capture, or hearing claims.
const base = new URL(process.env.DF_QA_URL || 'http://127.0.0.1:5194/');
const out = path.resolve(process.env.DF_AUDIO_QA_OUT || '../qa-audio');
const previewOnly = process.env.DF_AUDIO_PREVIEW_ONLY === '1';
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errors = [], checks = [], failures = [], measurements = {};
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const sleep = ms => page.waitForTimeout(ms);
async function check(name, test) {
  if (previewOnly) return;
  try {
    const result = await test();
    checks.push(name);
    if (result !== undefined) measurements[name] = result;
    console.log('PASS', name);
  } catch (error) {
    failures.push({ name, reason: error.message });
    console.error('FAIL', name, error.message);
  }
}
const isolatedUrl = new URL('__audio-qa.html', base).href;
const moduleUrl = new URL('src/audio.js', base).href;
await page.route(isolatedUrl, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html lang="de"><title>DEAD FREQUENCY Audio QA</title><body>Isolated audio verification</body></html>' }));

function wav(samples, sampleRate) {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 4, 28); bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((value, index) => bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + index * 2));
  return bytes;
}

try {
  await page.goto(isolatedUrl);
  await page.evaluate(async url => {
    const { createAudio } = await import(url);
    const context = new AudioContext({ latencyHint: 'interactive' });
    // ScriptProcessor is intentionally confined to QA. It records exact stereo
    // samples after the mixer's limiter/master, leaving real speaker output mute.
    const recorder = context.createScriptProcessor(1024, 2, 2);
    recorder.channelCount = 2;
    recorder.channelCountMode = 'explicit';
    recorder.connect(context.destination);
    let recording = false, left = [], right = [], mixer;
    recorder.onaudioprocess = event => {
      if (!recording) return;
      left.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      right.push(new Float32Array(event.inputBuffer.getChannelData(1)));
    };
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    function state() {
      return { phase: 'raid', player: { x: 0, y: 0, z: 0, yaw: 0, hp: 100, armor: 30, grounded: true, moving: false, sprinting: false, crouching: false, weapon: 'VX-9', reload: 0, heal: 0, stamina: 100 }, raid: { timeLeft: 300 } };
    }
    function metric() {
      let count = 0, peak = 0, clipped = 0, nonfinite = 0, energyL = 0, energyR = 0;
      for (let block = 0; block < left.length; block++) {
        for (let i = 0; i < left[block].length; i++) {
          const l = left[block][i], r = right[block][i];
          if (!Number.isFinite(l) || !Number.isFinite(r)) nonfinite++;
          peak = Math.max(peak, Math.abs(l), Math.abs(r));
          if (Math.abs(l) >= 1 || Math.abs(r) >= 1) clipped++;
          energyL += l * l; energyR += r * r; count++;
        }
      }
      return { frames: count, seconds: count / context.sampleRate, peak, clipped, nonfinite,
        rms: Math.sqrt((energyL + energyR) / Math.max(1, 2 * count)),
        rmsL: Math.sqrt(energyL / Math.max(1, count)), rmsR: Math.sqrt(energyR / Math.max(1, count)) };
    }
    async function reset() {
      mixer?.dispose();
      mixer = createAudio({ context, destination: recorder, ambience: false, random: () => .5 });
      await mixer.ready;
      await mixer.unlock();
      await context.resume();
      mixer.setVolume(.65);
      window.audioQA.state = state();
      mixer.update(window.audioQA.state, 1 / 60);
      await delay(180);
      return mixer.stats();
    }
    async function capture(ms, trigger) {
      left = []; right = []; recording = true;
      trigger?.();
      await delay(ms);
      recording = false;
      return metric();
    }
    window.audioQA = { context, state: state(), reset, capture, get mixer() { return mixer; },
      async event(type, fields = {}, duration = 600) {
        return capture(duration, () => mixer.events([{ type, ...fields }], this.state));
      },
      exportPCM() { const samples = []; for (let b = 0; b < left.length; b++) for (let i = 0; i < left[b].length; i++) samples.push(left[b][i], right[b][i]); return { samples, sampleRate: context.sampleRate }; },
      async close() { recording = false; mixer?.dispose(); recorder.disconnect(); await context.close(); },
    };
    await reset();
  }, moduleUrl);

  await check('Every audio sample loads and decodes', async () => {
    const stats = await page.evaluate(() => audioQA.mixer.stats());
    assert.equal(stats.available, true, 'Web Audio mixer unavailable');
    assert.ok((Array.isArray(stats.loadedSamples) ? stats.loadedSamples.length : stats.loadedSamples) >= 5, 'Expected several decoded recorded samples');
    assert.equal(Array.isArray(stats.failedSamples) ? stats.failedSamples.length : stats.failedSamples, 0, 'Samples failed to load');
    assert.equal(stats.maxVoices, 32);
    return stats;
  });
  await check('Rifle produces finite non-silent stereo PCM without clipping', async () => {
    const result = await page.evaluate(() => audioQA.event('shot', { weapon: 'VX-9' }));
    assert.ok(result.frames > 5000, 'No PCM was captured from the real output graph');
    assert.ok(result.rms > .0005 && result.peak > .005, `Shot is effectively silent: ${JSON.stringify(result)}`);
    assert.equal(result.nonfinite, 0); assert.equal(result.clipped, 0);
    assert.ok(result.peak < 1, `Digital clipping: ${result.peak}`);
    const pcm = await page.evaluate(() => audioQA.exportPCM());
    await fs.writeFile(path.join(out, 'shot-preview.wav'), wav(pcm.samples, pcm.sampleRate));
    return result;
  });
  await check('Enemy left and right positions produce correct stereo direction', async () => {
    const results = [];
    for (const x of [-10, 10, -10]) {
      await page.evaluate(() => audioQA.reset());
      results.push(await page.evaluate(x => audioQA.event('enemyShot', { from: { x, y: 1.5, z: 0 } }), x));
    }
    assert.ok(results[0].rmsL > results[0].rmsR * 1.5, `Left source not stronger on left: ${JSON.stringify(results)}`);
    assert.ok(results[1].rmsR > results[1].rmsL * 1.5, `Right source not stronger on right: ${JSON.stringify(results[1])}`);
    assert.ok(results.every(r => r.rms > .0001));
    return { left: results[0], right: results[1], repeatedLeft: results[2] };
  });
  await check('Turning 180 degrees reverses enemy stereo direction', async () => {
    await page.evaluate(async () => { await audioQA.reset(); audioQA.state.player.yaw = Math.PI; });
    const result = await page.evaluate(() => audioQA.event('enemyShot', { from: { x: 10, y: 1.5, z: 0 } }));
    assert.ok(result.rmsL > result.rmsR * 1.5, JSON.stringify(result));
    return result;
  });
  await check('Distant gunfire is measurably quieter than nearby gunfire', async () => {
    const results = [];
    for (const z of [-5, -55]) {
      await page.evaluate(() => audioQA.reset());
      results.push(await page.evaluate(z => audioQA.event('enemyShot', { from: { x: 0, y: 1.5, z } }), z));
    }
    assert.ok(results[0].rms > .0001, 'Nearby enemy shot is silent');
    assert.ok(results[1].rms < results[0].rms * .65, `Distance attenuation too weak: ${results[1].rms / results[0].rms}`);
    return { near: results[0], far: results[1], ratio: results[1].rms / results[0].rms };
  });
  await check('User volume zero mutes the final mixed waveform', async () => {
    await page.evaluate(async () => { await audioQA.reset(); audioQA.mixer.setVolume(0); });
    await sleep(350);
    const result = await page.evaluate(() => audioQA.event('shot', { weapon: 'AR-4' }));
    assert.ok(result.rms < 1e-6 && result.peak < 1e-5, `Mute leaks audio: ${JSON.stringify(result)}`);
    return result;
  });
  for (const phase of ['paused', 'dead']) {
    await check(`Reload is cancelled when phase becomes ${phase}`, async () => {
      await page.evaluate(async () => {
        await audioQA.reset();
        audioQA.state.player.reload = 1.9;
        audioQA.mixer.events([{ type: 'reload', duration: 1.9 }], audioQA.state);
      });
      await sleep(70);
      const before = await page.evaluate(() => audioQA.mixer.stats());
      assert.ok(before.activeVoices > 0 || before.pending > 0, 'Reload test did not start any sounds');
      await page.evaluate(phase => { audioQA.state.phase = phase; audioQA.mixer.update(audioQA.state, 1 / 60); }, phase);
      await sleep(180);
      const result = await page.evaluate(async () => ({ stats: audioQA.mixer.stats(), waveform: await audioQA.capture(1700) }));
      assert.equal(result.stats.activeVoices, 0, 'Reload voice survives cancelled raid phase');
      assert.equal(result.stats.pending, 0, 'Delayed reload voice remains queued');
      assert.ok(result.waveform.rms < 1e-6, `Late reload clicks audible after cancellation: ${result.waveform.rms}`);
      return { before, ...result };
    });
  }
  await check('Window suspension cancels delayed reload sounds before rendering resumes', async () => {
    await page.evaluate(async () => {
      await audioQA.reset();
      audioQA.state.player.reload = 1.9;
      audioQA.mixer.events([{ type: 'reload', duration: 1.9 }], audioQA.state);
    });
    await sleep(70);
    await page.evaluate(() => audioQA.mixer.suspend());
    await sleep(100);
    const suspended = await page.evaluate(() => ({ contextState: audioQA.context.state, stats: audioQA.mixer.stats() }));
    assert.equal(suspended.contextState, 'suspended');
    assert.equal(suspended.stats.pending, 0, 'Hidden-window reload queue survives suspension');
    assert.equal(suspended.stats.activeVoices, 0);
    await page.evaluate(() => audioQA.mixer.unlock());
    await sleep(180);
    const waveform = await page.evaluate(() => audioQA.capture(1700));
    assert.ok(waveform.rms < 1e-6, `Reload resumes audibly after returning to paused game: ${waveform.rms}`);
    return { suspended, waveform };
  });
  await check('Death result sound survives events-before-update phase handling', async () => {
    await page.evaluate(() => audioQA.reset());
    const result = await page.evaluate(() => audioQA.capture(700, () => {
      audioQA.state.phase = 'dead';
      audioQA.mixer.events([{ type: 'death' }], audioQA.state);
      audioQA.mixer.update(audioQA.state, 1 / 60);
    }));
    assert.ok(result.rms > .0001, `Result sound was cancelled by phase update: ${JSON.stringify(result)}`);
    return result;
  });
  await check('Burst fire respects the voice budget and does not clip', async () => {
    await page.evaluate(() => audioQA.reset());
    const result = await page.evaluate(async () => {
      const wave = await audioQA.capture(800, () => {
        audioQA.mixer.events(Array.from({ length: 100 }, (_, i) => i % 2 ? { type: 'shot', weapon: 'AR-4' } : { type: 'enemyShot', from: { x: i % 3 - 1, y: 1.5, z: -8 } }), audioQA.state);
      });
      return { stats: audioQA.mixer.stats(), waveform: wave };
    });
    assert.ok(result.stats.peakVoices <= result.stats.maxVoices, JSON.stringify(result.stats));
    assert.ok(result.stats.activeVoices <= result.stats.maxVoices);
    assert.equal(result.waveform.nonfinite, 0); assert.equal(result.waveform.clipped, 0);
    assert.ok(result.waveform.rms > .0005, 'Burst was silenced instead of bounded');
    return result;
  });
  await check('Actual Rapier wall collision emits no footsteps despite held movement', async () => {
    await page.evaluate(async simulationUrl => {
      await audioQA.reset();
      const { createGame } = await import(simulationUrl);
      const game = await createGame();
      game.startRaid({ difficulty: 'normal', kit: 'scout' });
      game.state.enemies.forEach(enemy => { enemy.dead = true; enemy.hp = 0; });
      // Walk north into the low, shared-layout spawn barrier. Settle the body
      // against it first, then measure only genuinely blocked movement.
      if (!game.teleport(-4, 38.5)) throw new Error('Could not set up spawn barrier collision');
      for (let i = 0; i < 90; i++) game.update(1 / 60, { forward: 1, yaw: 0, sprint: true });
      audioQA.collisionGame = game;
      audioQA.state = game.state;
      audioQA.mixer.update(game.state, 1 / 60);
    }, new URL('src/simulation.js', base).href);
    await sleep(450);
    const result = await page.evaluate(async () => {
      const game = audioQA.collisionGame;
      try {
        const before = audioQA.mixer.stats().footsteps;
        const initial = { x: game.state.player.x, z: game.state.player.z };
        const waveform = await audioQA.capture(600, () => {
          for (let i = 0; i < 240; i++) {
            game.update(1 / 60, { forward: 1, yaw: 0, sprint: true });
            audioQA.mixer.update(game.state, 1 / 60);
          }
        });
        return { before, after: audioQA.mixer.stats().footsteps, waveform,
          displacement: Math.hypot(game.state.player.x - initial.x, game.state.player.z - initial.z),
          movementIntent: game.state.player.moving };
      } finally { game.dispose(); delete audioQA.collisionGame; }
    });
    assert.equal(result.movementIntent, true, 'Test did not hold movement against the obstacle');
    assert.ok(result.displacement < .01, `Physics did not block the test body: ${result.displacement}`);
    assert.equal(result.after, result.before, 'Input intent produced footsteps without displacement');
    assert.ok(result.waveform.rms < 1e-6, 'Stationary wall collision produced movement audio');
    return result;
  });
  await check('Actual grounded displacement produces footsteps', async () => {
    await page.evaluate(() => audioQA.reset());
    const result = await page.evaluate(async () => {
      const before = audioQA.mixer.stats().footsteps;
      audioQA.state.player.moving = true;
      const waveform = await audioQA.capture(600, () => {
        for (let i = 0; i < 120; i++) {
          audioQA.state.player.x += 4.4 / 60;
          audioQA.mixer.update(audioQA.state, 1 / 60);
        }
      });
      return { before, after: audioQA.mixer.stats().footsteps, waveform };
    });
    assert.ok(result.after > result.before, 'Footsteps never play even with real movement');
    assert.ok(result.waveform.rms > .0001, 'Footstep counters advanced but output is silent');
    return result;
  });
  await check('Airborne motion does not emit walking footsteps', async () => {
    await page.evaluate(() => audioQA.reset());
    const result = await page.evaluate(() => {
      const before = audioQA.mixer.stats().footsteps;
      audioQA.state.player.moving = true; audioQA.state.player.grounded = false;
      for (let i = 0; i < 120; i++) {
        audioQA.state.player.x += 4.4 / 60;
        audioQA.mixer.update(audioQA.state, 1 / 60);
      }
      return { before, after: audioQA.mixer.stats().footsteps };
    });
    assert.equal(result.after, result.before);
    return result;
  });
  // A review artifact, not a listening test: the same post-master PCM captures
  // both weapons, their reload sequences, and movement-triggered footsteps.
  await page.evaluate(async () => {
    await audioQA.reset();
    const timers = [], schedule = (at, action) => timers.push(setTimeout(action, at));
    let walkTimer;
    try {
      audioQA.previewMetrics = await audioQA.capture(9600, () => {
        for (const at of [250, 410, 570]) schedule(at, () => audioQA.mixer.events([{ type: 'shot', weapon: 'VX-9' }], audioQA.state));
        schedule(1150, () => {
          audioQA.state.player.weapon = 'VX-9'; audioQA.state.player.reload = 1.7;
          audioQA.mixer.events([{ type: 'reload', duration: 1.7 }], audioQA.state);
        });
        for (const at of [3400, 3590, 3780]) schedule(at, () => {
          audioQA.state.player.reload = 0; audioQA.state.player.weapon = 'AR-4';
          audioQA.mixer.events([{ type: 'shot', weapon: 'AR-4' }], audioQA.state);
        });
        schedule(4400, () => {
          audioQA.state.player.reload = 2.1;
          audioQA.mixer.events([{ type: 'reload', duration: 2.1 }], audioQA.state);
        });
        schedule(6800, () => {
          audioQA.state.player.reload = 0; audioQA.state.player.moving = true;
          let frames = 0;
          walkTimer = setInterval(() => {
            audioQA.state.player.x += 4.4 / 60;
            audioQA.mixer.update(audioQA.state, 1 / 60);
            if (++frames >= 120) { clearInterval(walkTimer); audioQA.state.player.moving = false; }
          }, 1000 / 60);
        });
      });
    } finally { timers.forEach(clearTimeout); clearInterval(walkTimer); }
  });
  const mixedPCM = await page.evaluate(() => ({ ...audioQA.exportPCM(), metrics: audioQA.previewMetrics }));
  assert.ok(mixedPCM.metrics.seconds >= 8.5 && mixedPCM.metrics.seconds <= 10.5, `Unexpected preview length: ${mixedPCM.metrics.seconds}`);
  assert.ok(mixedPCM.metrics.rms > .0005); assert.equal(mixedPCM.metrics.clipped, 0);
  await fs.writeFile(path.join(out, 'weapons-reload-footsteps-preview.wav'), wav(mixedPCM.samples, mixedPCM.sampleRate));
  measurements['Mixed weapon and footsteps review artifact'] = mixedPCM.metrics;
  console.log(`CAPTURED ${mixedPCM.metrics.seconds.toFixed(2)}s mixed weapon, reload and footsteps preview`);
  await check('Mixer disposal leaves the injected context owned by its caller', async () => {
    const result = await page.evaluate(() => {
      audioQA.mixer.dispose();
      return { contextState: audioQA.context.state, stats: audioQA.mixer.stats() };
    });
    assert.equal(result.contextState, 'running'); assert.equal(result.stats.activeVoices, 0); assert.equal(result.stats.pending, 0);
    return result;
  });
  await check('No browser runtime or asset errors', () => assert.deepEqual(errors, []));
  await fs.writeFile(path.join(out, previewOnly ? 'preview-result.json' : 'result.json'), JSON.stringify({ checks, failures, measurements, errors, scope: 'Headless Chromium Web Audio PCM. Does not validate subjective realism or physical speaker output.' }, null, 2));
  assert.equal(failures.length, 0, `${failures.length} audio checks failed; see ${path.join(out, 'result.json')}`);
  console.log(previewOnly
    ? `Audio preview captured. Metrics: ${path.join(out, 'preview-result.json')}`
    : `Audio QA: ${checks.length} checks passed. Report: ${path.join(out, 'result.json')}`);
} catch (error) {
  await fs.writeFile(path.join(out, previewOnly ? 'preview-result.json' : 'result.json'), JSON.stringify({ checks, failures, measurements, errors, failure: String(error.stack) }, null, 2));
  throw error;
} finally {
  await page.evaluate(() => window.audioQA?.close()).catch(() => {});
  await browser.close();
}
