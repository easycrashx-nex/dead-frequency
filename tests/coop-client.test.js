import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import packageInfo from '../package.json' with { type: 'json' };
import { createCoopClient, parseInvite } from '../src/coop-client.js';
import { createGame } from '../src/simulation.js';
import { createCoopServer } from '../server/coop-server.js';
import { createCoopSession } from '../src/coop-session.js';
import { approachContainer } from './container-helpers.js';
import { ownedProfile } from './loadout-helpers.js';

const token = 'a1'.repeat(32);

test('paused clients receive admin effects and snap deliberate teleports without interpolating across the map',async()=>{
  const original=globalThis.WebSocket,localGame=await createGame();let client,wire;
  try{
    globalThis.WebSocket=class extends EventTarget{
      static OPEN=1;readyState=1;
      constructor(){super();wire=this;queueMicrotask(()=>this.dispatchEvent(new Event('open')));}
      send(raw){if(JSON.parse(raw).type==='join')queueMicrotask(()=>this.receive({type:'welcome',id:'a',hostId:'a'}));}
      receive(value){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(value)}));}
      close(){this.readyState=3;}
    };
    client=createCoopClient({localGame});await client.connect(`ws://127.0.0.1:1/coop?token=${token}`);
    const incoming=structuredClone(localGame.state);incoming.phase='raid';
    wire.receive({type:'snapshot',seq:1,state:incoming});client.pause();
    const oldX=client.state.player.x;
    Object.assign(incoming.player,{adminGodmode:true,adminStamina:true,adminTeleportSequence:1,x:500,y:10,z:400});
    wire.receive({type:'snapshot',seq:2,state:incoming});
    assert.equal(client.state.phase,'paused');assert.equal(client.state.player.adminGodmode,true);assert.equal(client.state.player.adminStamina,true);
    assert.notEqual(oldX,500);assert.equal(client.state.player.x,500);assert.equal(client.state.player.z,400);
    incoming.player.x=501;wire.receive({type:'snapshot',seq:3,state:incoming});assert.equal(client.state.player.x,500,'Ordinary movement retains interpolation');
    client.update(1/60,{});assert.ok(client.state.player.x>500&&client.state.player.x<501);
  }finally{client?.dispose();localGame.dispose();globalThis.WebSocket=original;}
});

test('short semi-automatic clicks survive the network send interval and cleared input never fires later', async () => {
  const originalWebSocket=globalThis.WebSocket,session=createCoopSession({seed:1717}),localGame=await createGame();
  let client,wire,seq=0;
  try{
    const a=await session.join({name:'Host',profile:ownedProfile({weapon:'RV-6'})}),b=await session.join({name:'Partner'});
    session.ready(a,true);session.ready(b,true);session.start(a);
    const game=session.players.get(a).game;game.state.enemies.length=0;
    globalThis.WebSocket=class extends EventTarget{
      static OPEN=1;readyState=1;
      constructor(){super();wire=this;queueMicrotask(()=>this.dispatchEvent(new Event('open')));}
      send(raw){const m=JSON.parse(raw);if(m.type==='join')queueMicrotask(()=>this.receive({type:'welcome',id:a,hostId:a}));else if(m.type==='input')session.input(a,m.seq,m.input);}
      receive(m){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(m)}));}
      close(){this.readyState=3;}
    };
    client=createCoopClient({localGame});await client.connect(`ws://127.0.0.1:1/coop?token=${token}`);
    wire.receive({...session.snapshot(a),seq:++seq});assert.equal(client.state.player.weapon,'RV-6');
    client.update(1/60,{fire:false,firePressed:true}); // Click already released before a network send.
    client.update(1/60,{fire:false,firePressed:false});session.update(1/60);
    assert.equal(game.state.player.ammo,5);
    for(let i=0;i<90;i++)session.update(1/60);
    assert.equal(game.state.player.ammo,5,'The buffered trigger is consumed exactly once');
    client.update(1/60,{fire:false,firePressed:true});client.clearInput();
    for(let i=0;i<4;i++){client.update(1/60,{fire:false});session.update(1/60);}
    assert.equal(game.state.player.ammo,5,'A menu/focus change cancels an unsent click');
    client.update(1/60,{fire:true,firePressed:true});client.update(1/60,{fire:true});
    for(let i=0;i<90;i++){client.update(1/60,{fire:true});session.update(1/60);}
    assert.equal(game.state.player.ammo,4,'Holding a semi-automatic trigger cannot become automatic fire');
    game.state.raid.xpEarned=110;game.state.profile.progression.xp=110;
    wire.receive({...session.snapshot(a),seq:++seq});wire.receive({type:'closed',message:'Host left'});
    assert.equal(client.state.phase,'dead');assert.equal(client.state.result.xpEarned,110);
    assert.equal(localGame.state.profile.progression.xp,110,'Disconnected result and persistent profile agree on earned XP');
  }finally{client?.dispose();globalThis.WebSocket=originalWebSocket;session.close();localGame.dispose();}
});

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
