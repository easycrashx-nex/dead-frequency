import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import packageInfo from '../package.json' with { type: 'json' };
import { createCoopClient, parseInvite } from '../src/coop-client.js';
import { createGame } from '../src/simulation.js';
import { createCoopServer } from '../server/coop-server.js';
import { createCoopSession } from '../src/coop-session.js';
import { approachContainer } from './container-helpers.js';

const token = 'a1'.repeat(32);

test('explicit same-container reopen survives a close without an intervening closed snapshot', async () => {
  const originalWebSocket = globalThis.WebSocket;
  const session = createCoopSession({ seed: 414 }), localGame = await createGame();
  let client, wire, snapshotSeq = 0;
  try {
    const a = await session.join({ name: 'Host' }), b = await session.join({ name: 'Partner' });
    session.ready(a, true); session.ready(b, true); session.start(a);
    const authoritativeGame = session.players.get(a).game;
    authoritativeGame.state.enemies.length = 0;
    const container = authoritativeGame.state.containers[0];
    approachContainer(authoritativeGame, container);
    session.action(a, 'interact');
    for (let i = 0; i < 100; i++) session.update(1 / 60);
    assert.equal(container.searched, true);

    // Deliver actions immediately, but advance the real server only when the
    // test asks. This models close/reopen arriving between snapshot broadcasts.
    globalThis.WebSocket = class extends EventTarget {
      static OPEN = 1;
      readyState = 1;
      constructor() { super(); wire = this; queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
      send(raw) {
        const message = JSON.parse(raw);
        if (message.type === 'join') queueMicrotask(() => this.receive({ type: 'welcome', id: a, hostId: a }));
        else if (message.type === 'action') session.action(a, message.action, message.id, message.containerId);
      }
      receive(message) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) })); }
      close() { this.readyState = 3; }
    };
    client = createCoopClient({ localGame });
    await client.connect(`ws://127.0.0.1:1/coop?token=${token}`);
    const deliverSnapshot = () => wire.receive({ ...session.snapshot(a), seq: ++snapshotSeq });
    deliverSnapshot();
    assert.equal(client.state.activeContainerId, container.id);

    assert.equal(client.closeContainer(), true);
    deliverSnapshot(); // Old open state arrives before the pending close runs.
    assert.equal(client.state.activeContainerId, null, 'A stale snapshot must not reopen a closed panel');
    assert.equal(client.interact(), true);
    session.update(1 / 60); // Both queued actions execute before any closed snapshot.
    assert.equal(authoritativeGame.state.activeContainerId, container.id);
    deliverSnapshot();
    assert.equal(client.state.activeContainerId, container.id, 'The explicit reopen must reach the UI');
    session.update(1 / 60); deliverSnapshot();
    assert.equal(client.state.activeContainerId, container.id, 'Further snapshots keep the same panel open');
    assert.equal(client.state.containerSearchRemaining, 0);
    assert.equal(client.state.containers.find(value => value.id === container.id).searched, true);
  } finally {
    client?.dispose(); globalThis.WebSocket = originalWebSocket;
    session.close(); localGame.dispose();
  }
});

test('host exposes the public invitation throughout connecting and welcome while using loopback transport', { timeout: 10000 }, async () => {
  const originalWebSocket = globalThis.WebSocket;
  const transportUrls = [], observed = [];
  const localGame = await createGame();
  let server, client;
  try {
    server = await createCoopServer({ host: '127.0.0.1', version: packageInfo.version });
    const localUrl = `ws://127.0.0.1:${server.port}/coop?token=${server.token}`;
    const publicInvitation = `https://team-invitation.example/coop?token=${server.token}`;
    globalThis.WebSocket = class extends WebSocket {
      constructor(url, ...args) { transportUrls.push(String(url)); super(url, ...args); }
    };
    client = createCoopClient({ localGame, onChange: info => observed.push(structuredClone(info)) });

    const connecting = client.connect(localUrl, {
      name: 'Host', profile: localGame.getSave(), invitation: publicInvitation,
    });
    // The UI can copy an invitation immediately, before the socket welcomes us.
    assert.equal(client.info.status, 'connecting');
    assert.equal(client.info.invite, publicInvitation);
    await connecting;

    assert.deepEqual(transportUrls, [localUrl]);
    assert.ok(server.session.players.has(client.info.id), 'the real loopback server accepted this client');
    assert.ok(observed.some(info => info.status === 'connecting'));
    assert.ok(observed.some(info => info.status === 'lobby' && info.id), 'welcome became visible to the UI');
    assert.ok(observed.every(info => info.invite === publicInvitation), 'no observable state leaks the loopback invitation');
    assert.equal(client.info.invite, publicInvitation);
  } finally {
    client?.dispose();
    await server?.close();
    localGame.dispose();
    globalThis.WebSocket = originalWebSocket;
  }
});

test('invitation parser accepts IPv4 LAN and encrypted public invitations with a complete token', () => {
  for (const host of ['127.0.0.1', '192.168.1.25', '10.0.0.7', '172.16.0.3', '172.31.255.254']) {
    const invite = `ws://${host}:43127/coop?token=${token}`;
    assert.equal(parseInvite(invite), invite);
  }
  assert.equal(parseInvite(`  https://team.example/coop?token=${token}#ignored  `), `wss://team.example/coop?token=${token}`);
  assert.equal(parseInvite(`wss://team.example/coop?token=${token}`), `wss://team.example/coop?token=${token}`);
});

test('invitation parser rejects public unencrypted sockets and malformed invitations', () => {
  const invalid = [
    'not a URL',
    `ws://team.example/coop?token=${token}`,
    `ws://8.8.8.8/coop?token=${token}`,
    `ws://172.32.0.1/coop?token=${token}`,
    `http://team.example/coop?token=${token}`,
    `https://user:password@team.example/coop?token=${token}`,
    `https://team.example/not-coop?token=${token}`,
    'https://team.example/coop',
    `https://team.example/coop?token=${token.slice(1)}`,
    `https://team.example/coop?token=${'g'.repeat(64)}`,
  ];
  for (const invite of invalid) assert.throws(() => parseInvite(invite), undefined, invite);
});
