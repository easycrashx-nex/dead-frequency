import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';
import { createCoopServer } from '../server/coop-server.js';
import { EXTRACTIONS } from '../src/layout.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const advance = (server, seconds) => { for (let i = 0; i < Math.ceil(seconds * 60); i++) server.session.update(1 / 60); };
async function fixture(t, count = 1, socketOptions = {}) {
  const descriptor = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'bufferedAmount'), pressure = new Map(), clients = [];
  // Real WebSocket frames/handshakes, with deterministic server-side congestion.
  // Each test runs in its own file process; client socket buffers are unchanged.
  Object.defineProperty(WebSocket.prototype, 'bufferedAmount', { ...descriptor, get() {
    return this._isServer && pressure.has(this._socket?.remotePort) ? pressure.get(this._socket.remotePort) : descriptor.get.call(this);
  } });
  const server = await createCoopServer({ sessionOptions: { minPlayers: count, maxPlayers: count, spawnId: 'arrival', seed: 990 } });
  t.after(async () => { pressure.clear(); for (const client of clients) client.ws.terminate(); await server.close(); Object.defineProperty(WebSocket.prototype, 'bufferedAmount', descriptor); });
  for (let index = 0; index < count; index++) {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/coop?token=${server.token}`, socketOptions), queue = [], waiters = [], received = [];
    ws.on('error', () => {});
    ws.on('message', raw => {
      const message = JSON.parse(raw), index = waiters.findIndex(waiter => waiter.predicate(message)); received.push(message);
      if (index < 0) queue.push(message);
      else { const waiter = waiters.splice(index, 1)[0]; clearTimeout(waiter.timer); waiter.resolve(message); }
    });
    const client = { ws, received, send: message => ws.send(JSON.stringify(message)), wait(predicate) {
      const index = queue.findIndex(predicate);
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, timer: setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1); reject(new Error('Timed out waiting for congestion recovery'));
        }, 5000) }; waiters.push(waiter);
      });
    } };
    clients.push(client); await once(ws, 'open'); client.port = ws._socket.localPort;
    client.send({ type: 'join', protocol: 1, version: '1.3.0', name: `Backpressure-${index}` });
    client.id = (await client.wait(message => message.type === 'welcome')).id;
  }
  for (const client of clients) client.send({ type: 'ready', ready: true });
  await clients[0].wait(message => message.type === 'lobby' && message.players.length === count && message.players.every(player => player.ready));
  clients[0].send({ type: 'start' });
  await Promise.all(clients.map(client => client.wait(message => message.type === 'snapshot' && message.state.phase === 'raid')));
  const games = clients.map(client => server.session.players.get(client.id).game); games[0].state.enemies.splice(0);
  return { server, clients, games, pressure, block: (client, amount = 512 * 1024) => pressure.set(client.port, amount), release: client => pressure.delete(client.port) };
}

test('compressed real WebSockets coalesce a slow receiver before draining events and recover with the latest state', async t => {
  const f = await fixture(t, 2), [slow, healthy] = f.clients, game = f.games[0];
  assert.match(slow.ws.extensions, /permessage-deflate/); assert.match(healthy.ws.extensions, /permessage-deflate/);
  const snapshot = f.server.session.snapshot, reads = new Map();
  f.server.session.snapshot = id => { reads.set(id, (reads.get(id) ?? 0) + 1); return snapshot(id); };
  f.block(slow); const beforeSlow = reads.get(slow.id) ?? 0, beforeHealthy = healthy.received.length;
  game.receiveDamage(7, { x: game.state.player.x, z: game.state.player.z });
  game.teleport(-52, 0); advance(f.server, .05);
  slow.send({ type: 'ping', time: 12345 });
  assert.equal((await slow.wait(message => message.type === 'pong' && message.time === 12345)).time, 12345, 'control messages are not coalesced away');
  await delay(180); game.teleport(-55, 0); advance(f.server, .05); await delay(100);
  assert.equal(reads.get(slow.id) ?? 0, beforeSlow, 'no skipped snapshot may consume queued events');
  assert.ok(healthy.received.length > beforeHealthy + 2, 'one slow client does not stall its teammate');
  assert.equal(slow.ws.readyState, WebSocket.OPEN);
  assert.equal(f.server.session.players.get(slow.id).events.filter(event => event.type === 'damage').length, 1);
  f.release(slow);
  const recovered = await slow.wait(message => message.type === 'snapshot' && message.events.some(event => event.type === 'damage'));
  assert.ok(Math.abs(recovered.state.player.x + 55) < .02, 'recovery serializes current state, not an old queued world');
  assert.equal(recovered.events.filter(event => event.type === 'damage').length, 1);
  const next = await slow.wait(message => message.type === 'snapshot' && message.seq > recovered.seq);
  assert.equal(next.events.some(event => event.type === 'damage'), false, 'recovered events are delivered once');
  assert.equal(slow.ws.readyState, WebSocket.OPEN);
  f.block(slow); game.endRaid('Terminal retention regression'); advance(f.server, .02);
  assert.equal(f.server.session.players.get(slow.id).events.some(event => event.type === 'death'), true);
  const partner = f.games[1], drain = partner.drainEvents;
  // Exercise the real coordinator's broadcast queue with a saturated burst
  // after this recipient is dead while its teammate continues the raid.
  partner.drainEvents = () => [...drain(), ...Array.from({ length: 600 }, () => ({ type: 'enemyShot', x: 0, z: 0 }))];
  try { f.server.session.update(1 / 60); } finally { partner.drainEvents = drain; }
  const pending = f.server.session.players.get(slow.id).events;
  assert.equal(partner.state.phase, 'raid'); assert.equal(pending.length, 512);
  assert.equal(pending.filter(event => event.type === 'death').length, 1, 'later transient effects cannot evict an unacknowledged terminal event');
  f.release(slow);
  const terminal = await slow.wait(message => message.type === 'snapshot' && message.state.phase === 'dead');
  assert.equal(terminal.events.filter(event => event.type === 'death').length, 1);
});

test('finished raids retry a deferred result after drain and preserve terminal events beyond the bounded transient queue', async t => {
  const f = await fixture(t), [client] = f.clients, game = f.games[0];
  f.block(client);
  for (let i = 0; i < 600; i++) game.receiveDamage(.001, { x: game.state.player.x, z: game.state.player.z });
  advance(f.server, .02);
  assert.equal(f.server.session.players.get(client.id).events.length, 512, 'transient backlog remains bounded');
  const exit = EXTRACTIONS[0]; game.teleport(exit.x, exit.z); advance(f.server, .1); assert.equal(game.interact(), true); advance(f.server, 8.3);
  assert.equal(f.server.session.phase, 'finished'); assert.equal(game.state.phase, 'extracted');
  const queued = f.server.session.players.get(client.id).events;
  assert.ok(queued.length <= 512); assert.equal(queued.filter(event => event.type === 'extract').length, 1, 'result survives earlier transient saturation');
  await delay(200); assert.equal(client.ws.readyState, WebSocket.OPEN);
  assert.equal(client.received.some(message => message.type === 'snapshot' && message.state.phase === 'extracted'), false);
  f.release(client);
  const result = await client.wait(message => message.type === 'snapshot' && message.state.phase === 'extracted');
  assert.equal(result.state.result.success, true); assert.equal(result.events.filter(event => event.type === 'extract').length, 1);
  assert.equal(f.server.session.players.get(client.id).events.length, 0);
  client.send({ type: 'ping', time: 789 }); await client.wait(message => message.type === 'pong' && message.time === 789);
  assert.equal(client.ws.readyState, WebSocket.OPEN);
});

test('uncompressed clients remain compatible and only a continuous 15-second simulated backlog closes the connection', async t => {
  const f = await fixture(t, 1, { perMessageDeflate: false }), [client] = f.clients;
  assert.equal(client.ws.extensions, '');
  const originalNow = performance.now.bind(performance); let offset = 0;
  t.mock.method(performance, 'now', () => originalNow() + offset);
  f.block(client); await delay(80); offset = 14700; await delay(80);
  assert.equal(client.ws.readyState, WebSocket.OPEN, 'briefly blocked peers retain their raid');
  const lastSequence = Math.max(...client.received.filter(message => message.type === 'snapshot').map(message => message.seq));
  f.release(client); await client.wait(message => message.type === 'snapshot' && message.seq > lastSequence);
  f.block(client); await delay(80); offset = 15100; await delay(80);
  assert.equal(client.ws.readyState, WebSocket.OPEN, 'recovery resets the continuous blocked interval');
  const closed = once(client.ws, 'close'); offset += 15100;
  const [code, reason] = await closed;
  assert.equal(code, 1008); assert.match(reason.toString(), /slow|stalled/i);
  assert.equal(f.server.session.players.get(client.id).connected, false);
});
