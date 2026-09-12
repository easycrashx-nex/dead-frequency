import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import WebSocket from 'ws';
import { startDedicatedServer } from '../server/start.js';
import { createCoopSession } from '../src/coop-session.js';
import packageInfo from '../package.json' with { type: 'json' };

test('loopback dedicated entrypoint serves health, preserves accounts and spent raid profiles through a full service restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'dead-frequency-server-')), errors = [];
  let server, socket;
  const options = { port: 0, publicOrigin: 'https://91.98.64.49', dataPath: join(directory, 'accounts.sqlite'), onError: error => errors.push(error) };
  t.after(async () => { socket?.terminate(); await server?.close(); const target = resolve(directory); assert.ok(basename(target).startsWith('dead-frequency-server-')); rmSync(target, { recursive: true }); });
  server = await startDedicatedServer(options);
  let origin = `http://127.0.0.1:${server.port}`;
  const call = async (path, body, token) => {
    const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const health = await call('/health'); assert.equal(health.status, 200); assert.equal(health.data.version, packageInfo.version);
  assert.equal(health.data.rooms, 0); assert.deepEqual(health.data.simulation.simulations, []);
  assert.equal((await call('/api/me')).status, 401);
  const registered = await call('/api/auth/register', { username: 'PersistentPlayer', password: 'password-only-for-test' });
  assert.equal(registered.status, 201); const { token, profile } = registered.data;
  const created = await call('/api/rooms/create', { mode: 'solo', loadout: { mode: 'preset', presetId: 'assault' } }, token);
  assert.equal(created.status, 200);
  const url = new URL(created.data.url); url.protocol = 'ws:'; url.host = `127.0.0.1:${server.port}`;
  socket = new WebSocket(url); socket.on('error', () => {});
  let received;
  const started = new Promise((accept, reject) => {
    const timeout = setTimeout(() => reject(new Error('Raid did not start')), 8000);
    socket.on('message', data => {
      const message = JSON.parse(data);
      if (message.type === 'welcome') { socket.send(JSON.stringify({ type: 'ready', ready: true })); socket.send(JSON.stringify({ type: 'start' })); }
      if (message.type === 'snapshot' && message.state.phase === 'raid') { clearTimeout(timeout); received = message; accept(); }
    });
  });
  await once(socket, 'open'); socket.send(JSON.stringify({ type: 'join', protocol: 1, version: packageInfo.version, ticket: created.data.ticket }));
  await started;
  assert.equal(received.state.profile.raids, profile.raids + 1); assert.ok(received.state.profile.credits < profile.credits);
  const inRaid = await call('/health'); assert.equal(inRaid.data.rooms, 1); assert.equal(inRaid.data.simulation.simulations[0].phase, 'raid');
  const spentCredits = received.state.profile.credits;
  await server.close();
  server = await startDedicatedServer(options); origin = `http://127.0.0.1:${server.port}`;
  const reconnected = await call('/api/me', undefined, token);
  assert.equal(reconnected.status, 200); assert.equal(reconnected.data.profile.credits, spentCredits);
  assert.equal(reconnected.data.profile.raids, profile.raids + 1); assert.equal(reconnected.data.room, null);
  assert.equal((await call('/api/action', { kind: 'economy', action: 'storeAll', args: [] }, token)).status, 200);
  assert.deepEqual(errors, []);
});

test('public cleartext binding and invalid public origin cannot start a dedicated account server', async () => {
  await assert.rejects(startDedicatedServer({ host: '0.0.0.0', publicOrigin: 'https://91.98.64.49' }), /Loopback/);
  await assert.rejects(startDedicatedServer({ publicOrigin: '' }), /PUBLIC_ORIGIN/);
});

test('failed durable start closes the simulation without allowing an unpaid raid or retry', async t => {
  const session = createCoopSession({ minPlayers: 1, maxPlayers: 1, onRaidStart() { throw new Error('Disk full'); } });
  t.after(() => session.close());
  const id = await session.join(); session.ready(id, true);
  assert.throws(() => session.start(id), /Disk full/);
  assert.equal(session.phase, 'finished'); assert.equal(session.players.get(id).game.state.phase, 'dead');
  assert.throws(() => session.start(id), /bereits/);
  assert.equal(session.input(id, 1, { firePressed: true }), false);
});
