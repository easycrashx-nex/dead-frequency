import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';
import packageInfo from '../package.json' with { type: 'json' };

// Uses isolated QA accounts and ordinary public API/input messages only.
// Keep this run separate from native QA because the first two accounts are shared.
const origin = 'https://91.98.64.49';
const version = packageInfo.version;
const accountFile = path.resolve(`../qa-online-native-${version}/accounts.private.json`);
const out = path.resolve(`../qa-server-capacity-${version}`);
const durationSeconds = 25, warmupSeconds = 5;
const secrets = new Set(), clients = [], sessions = [], admissions = [], checks = [];
const report = { version, origin, startedAt: new Date().toISOString(), durationSeconds, warmupSeconds,
  scope: 'Two simultaneous two-player public-server raids, original simulation and bots, crouched movement and ordinary medkit use near spawn. No teleportation, invulnerability, profile injection or private server hooks.',
  limits: { averageTicksPerSecondMinimum: 57, snapshotHzMinimum: 15, healthTickP95MsMaximum: 12, maximumSnapshotGapMs: 1500,
    statement: 'Passing this bounded run supports the initial two-room limit on this VPS. It does not guarantee capacity during sustained combat, reinforcement peaks or variable shared-host load.' },
  checks, rooms: [], health: [], errors: [] };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const pass = name => { checks.push(name); console.log('PASS', name); };
const cleanError = error => {
  let value = String(error?.message ?? error);
  for (const secret of secrets) if (secret) value = value.split(secret).join('[redacted]');
  return value.replace(/[a-f0-9]{64}/gi, '[redacted]');
};
async function api(route, body, token) {
  const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status} (${data.code ?? 'request_failed'})`);
  return data;
}
async function connect(admission, index) {
  const socket = new WebSocket(admission.url, { handshakeTimeout: 15000 });
  const client = { socket, index, latest: null, id: null, hostId: null, lobby: null, samples: [], measuring: false, inputSeq: 0, fault: null, lastHealAt: -Infinity };
  clients.push(client);
  socket.on('error', error => { client.fault ??= cleanError(error); });
  socket.on('close', () => { if (client.measuring) client.fault ??= 'Connection closed during capacity measurement'; });
  socket.on('message', data => {
    const message = JSON.parse(data);
    if (message.type === 'welcome') { client.id = message.id; client.hostId = message.hostId; }
    else if (message.type === 'lobby') client.lobby = message;
    else if (message.type === 'error') client.fault ??= 'Server rejected a capacity-test action';
    else if (message.type === 'snapshot') {
      client.latest = message;
      if (client.measuring) {
        client.samples.push({ at: performance.now(), tick: message.tick, x: message.state.player.x, z: message.state.player.z });
        if (message.state.phase !== 'raid' || message.state.player.downed || message.state.player.hp <= 0) client.fault ??= 'A measured player was not actively alive in the raid';
        if (message.state.teammates.length !== 1 || !message.state.teammates[0].connected || message.state.teammates[0].phase !== 'raid') client.fault ??= 'A measured raid did not retain two active teammates';
      }
    }
  });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve); socket.once('error', () => reject(new Error('WebSocket connection failed')));
  });
  socket.send(JSON.stringify({ type: 'join', protocol: 1, version, ticket: admission.ticket }));
  await until(() => client.id && client.latest, [client], 'Authenticated player join');
  return client;
}
async function until(predicate, subjects, label, timeout = 20000) {
  const deadline = performance.now() + timeout;
  while (!predicate()) {
    for (const client of subjects) if (client.fault) throw new Error(`${label}: ${client.fault}`);
    if (performance.now() >= deadline) throw new Error(`${label} timed out`);
    await delay(50);
  }
}
const send = (client, value) => { if (client.socket.readyState === WebSocket.OPEN) client.socket.send(JSON.stringify(value)); };
function summarize(client) {
  const samples = client.samples, first = samples[0], last = samples.at(-1);
  assert.ok(samples.length >= 2, 'Insufficient live snapshot samples');
  const elapsed = (last.at - first.at) / 1000;
  const gaps = samples.slice(1).map((sample, i) => sample.at - samples[i].at);
  return { snapshots: samples.length, seconds: +elapsed.toFixed(3), ticksPerSecond: +((last.tick - first.tick) / elapsed).toFixed(2),
    snapshotHz: +((samples.length - 1) / elapsed).toFixed(2), maximumGapMs: +Math.max(...gaps).toFixed(1),
    movedMeters: +Math.max(...samples.map(sample => Math.hypot(sample.x - first.x, sample.z - first.z))).toFixed(2),
    phase: client.latest.state.phase, hp: client.latest.state.player.hp, enemies: client.latest.state.enemies.length };
}

let inputTimer, completed = false;
try {
  await fs.mkdir(out, { recursive: true });
  const credentials = JSON.parse(await fs.readFile(accountFile, 'utf8'));
  assert.ok(Array.isArray(credentials) && credentials.length >= 2 && credentials.slice(0, 2).every(value => value.created), 'Two registered native-QA accounts are required');
  while (credentials.length < 4) credentials.push({ username: `qac_${randomBytes(5).toString('hex')}`, password: randomBytes(24).toString('base64url'), created: false });
  for (const credential of credentials) { secrets.add(credential.username); secrets.add(credential.password); }
  await fs.writeFile(accountFile, JSON.stringify(credentials), { mode: 0o600 });
  for (let index = 0; index < 4; index++) {
    const credential = credentials[index];
    const session = await api(credential.created ? '/api/auth/login' : '/api/auth/register', { username: credential.username, password: credential.password });
    credential.created = true; secrets.add(session.token); sessions.push(session);
    await fs.writeFile(accountFile, JSON.stringify(credentials), { mode: 0o600 });
    const current = await api('/api/me', undefined, session.token);
    assert.equal(current.room, null, 'A QA account is already in use; stop and coordinate instead of interrupting it');
    if (current.profile.intake.length) await api('/api/action', { kind: 'economy', action: 'storeAll', args: [] }, session.token);
  }
  pass('Four isolated QA accounts authenticated with four credential requests; no active sessions interrupted');
  const beforeHealth = await api('/health'); assert.equal(beforeHealth.version, version); assert.equal(beforeHealth.rooms, 0, 'Other raids would invalidate the controlled two-room measurement');
  for (let roomIndex = 0; roomIndex < 2; roomIndex++) {
    const offset = roomIndex * 2;
    const host = await api('/api/rooms/create', { mode: 'coop', difficulty: 'normal', loadout: { mode: 'preset', presetId: 'scout' } }, sessions[offset].token);
    admissions.push(host); secrets.add(host.ticket); secrets.add(host.invite);
    const guest = await api('/api/rooms/join', { invite: host.invite, loadout: { mode: 'preset', presetId: 'scout' } }, sessions[offset + 1].token);
    admissions.push(guest); secrets.add(guest.ticket); secrets.add(guest.invite);
    const a = await connect(host, offset), b = await connect(guest, offset + 1);
    send(a, { type: 'ready', ready: true }); send(b, { type: 'ready', ready: true });
    await until(() => a.lobby?.players.length === 2 && a.lobby.players.every(player => player.ready), [a, b], 'Two-player readiness');
    send(a, { type: 'start' });
    await until(() => [a, b].every(client => client.latest?.state.phase === 'raid'), [a, b], 'Authoritative raid start');
    assert.equal(a.latest.state.raid.seed, b.latest.state.raid.seed);
    assert.ok(a.latest.state.enemies.length >= 59); assert.equal(a.latest.state.teammates.length, 1);
  }
  assert.notEqual(clients[0].latest.state.raid.seed, clients[2].latest.state.raid.seed);
  pass('Two separate full two-player raids started with the complete initial bot population');
  const inputStarted = performance.now();
  inputTimer = setInterval(() => {
    const elapsed = (performance.now() - inputStarted) / 1000;
    for (const client of clients) {
      send(client, { type: 'input', seq: ++client.inputSeq, input: {
        forward: 0, right: Math.sin(elapsed * 2 + client.index * .3) * .3, yaw: 0, pitch: 0, fire: false, sprint: false, crouch: true } });
      const player = client.latest?.state.player;
      if (player && player.hp < 85 && player.medkits > 0 && player.heal <= 0 && elapsed - client.lastHealAt > 3) {
        client.lastHealAt = elapsed; send(client, { type: 'action', action: 'heal' });
      }
    }
  }, 1000 / 30);
  await delay(warmupSeconds * 1000);
  for (const client of clients) { assert.equal(client.latest.state.phase, 'raid'); client.measuring = true; }
  const start = performance.now();
  while (performance.now() - start < durationSeconds * 1000) {
    const health = await api('/health');
    report.health.push({ atSeconds: +((performance.now() - start) / 1000).toFixed(2), rooms: health.rooms, simulation: health.simulation });
    assert.equal(health.rooms, 2); assert.equal(health.simulation.simulations.filter(sim => sim.phase === 'raid').length, 2);
    for (const client of clients) if (client.fault) throw new Error(client.fault);
    await delay(Math.min(1000, Math.max(1, durationSeconds * 1000 - (performance.now() - start))));
  }
  report.measuredSeconds = +((performance.now() - start) / 1000).toFixed(3);
  for (const client of clients) client.measuring = false;
  clearInterval(inputTimer); inputTimer = null;
  for (let roomIndex = 0; roomIndex < 2; roomIndex++) {
    const players = clients.slice(roomIndex * 2, roomIndex * 2 + 2).map(summarize);
    const metrics = report.health.map(sample => sample.simulation.simulations[roomIndex]);
    const summary = { room: roomIndex + 1, players, averageTicksPerSecond: +(players.reduce((sum, p) => sum + p.ticksPerSecond, 0) / players.length).toFixed(2),
      healthAverageTicksPerSecond: +(metrics.reduce((sum, metric) => sum + metric.ticksPerSecond, 0) / metrics.length).toFixed(2),
      maximumReportedTickP95Ms: Math.max(...metrics.map(metric => metric.tickP95Ms)) };
    report.rooms.push(summary);
    for (const player of players) {
      assert.ok(player.seconds >= durationSeconds - 1); assert.ok(player.ticksPerSecond >= report.limits.averageTicksPerSecondMinimum);
      assert.ok(player.snapshotHz >= report.limits.snapshotHzMinimum); assert.ok(player.maximumGapMs <= report.limits.maximumSnapshotGapMs);
      assert.ok(player.movedMeters > .05, 'Normal movement inputs must reach the authoritative simulation');
    }
    assert.ok(summary.maximumReportedTickP95Ms <= report.limits.healthTickP95MsMaximum);
  }
  pass('All four players stayed active throughout the real 25-second measurement with responsive authoritative movement');
  pass('Both raids met the declared tick-rate, snapshot-rate and tick-time limits');
  completed = true;
} catch (error) {
  if (!report.rooms.length) for (let index = 0; index < 2; index++) {
    const pair = clients.slice(index * 2, index * 2 + 2);
    if (pair.length === 2 && pair.every(client => client.samples.length >= 2)) report.rooms.push({ room: index + 1, partial: true, players: pair.map(summarize) });
  }
  report.errors.push(cleanError(error));
  console.error('FAIL', cleanError(error));
  process.exitCode = 1;
} finally {
  clearInterval(inputTimer);
  for (const client of clients) { client.measuring = false; send(client, { type: 'leave' }); client.socket.close(); }
  for (let index = 0; index < sessions.length; index++) {
    try {
      if (admissions[index]) await api('/api/rooms/leave', {}, sessions[index].token);
      const current = await api('/api/me', undefined, sessions[index].token);
      assert.equal(current.room, null, 'QA room must be settled and unlocked');
    } catch (error) { report.errors.push(`Cleanup: ${cleanError(error)}`); process.exitCode = 1; }
  }
  for (const client of clients) client.socket.terminate();
  try {
    report.finalHealth = await api('/health');
    if (completed) { assert.equal(report.finalHealth.rooms, 0); pass('All four departures settled; no rooms or account locks left behind'); }
  } catch (error) { report.errors.push(`Cleanup health: ${cleanError(error)}`); process.exitCode = 1; }
  report.passed = completed && report.errors.length === 0; report.finishedAt = new Date().toISOString();
  const serialized = JSON.stringify(report, null, 2);
  for (const secret of secrets) assert.ok(!serialized.includes(secret), 'Sensitive account or admission data must not appear in the report');
  await fs.mkdir(out, { recursive: true });
  try { await fs.copyFile(path.join(out, 'result.json'), path.join(out, `result-previous-${Date.now()}.json`)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.writeFile(path.join(out, 'result.json'), serialized);
  console.log(JSON.stringify({ passed: report.passed, checks: checks.length, rooms: report.rooms, errors: report.errors }, null, 2));
}
