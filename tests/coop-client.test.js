import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import packageInfo from '../package.json' with { type: 'json' };
import { createCoopClient, parseInvite } from '../src/coop-client.js';
import { createGame } from '../src/simulation.js';
import { createCoopServer } from '../server/coop-server.js';

const token = 'a1'.repeat(32);

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
