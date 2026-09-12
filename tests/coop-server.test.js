import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createCoopServer as createServer } from '../server/coop-server.js';
import { EXTRACTIONS } from '../src/layout.js';
import { ownedProfile } from './loadout-helpers.js';
import { resolveLoadout } from '../src/loadouts.js';
// These historical combat and crate fixtures use surveyed coordinates in arrival.
const createCoopServer = options => createServer({ ...options, sessionOptions: { spawnId: 'arrival', ...options?.sessionOptions } });

async function connect(t, url) {
  const ws = new WebSocket(url), queue = [], waiters = [];
  ws.on('error', () => {});
  ws.on('message', raw => {
    const message = JSON.parse(raw.toString());
    const match = waiters.findIndex(waiter => waiter.test(message));
    if (match >= 0) { const waiter = waiters.splice(match, 1)[0]; clearTimeout(waiter.timer); waiter.resolve(message); }
    else queue.push(message);
  });
  t.after(() => ws.terminate()); await once(ws, 'open');
  return { ws, send: value => ws.send(JSON.stringify(value)),
    wait(test, timeout = 3500) {
      const match = queue.findIndex(test);
      if (match >= 0) return Promise.resolve(queue.splice(match, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { test, resolve, timer: setTimeout(() => { waiters.splice(waiters.indexOf(waiter), 1); reject(new Error('Timed out waiting for WebSocket message')); }, timeout) };
        waiters.push(waiter);
      });
    } };
}
const advance = (server, seconds) => { for (let i = 0; i < Math.ceil(seconds * 60); i++) server.session.update(1 / 60); };
async function pair(t, server) {
  const url = `ws://127.0.0.1:${server.port}/coop?token=${server.token}`;
  const a = await connect(t, url), b = await connect(t, url);
  a.send({ type: 'join', protocol: 1, version: '1.3.0', name: 'Host', profile: { credits: 0 }, kit: 'scout' });
  const aw = await a.wait(m => m.type === 'welcome');
  b.send({ type: 'join', protocol: 1, version: '1.3.0', name: 'Guest', profile: { credits: 750 }, kit: 'scout' });
  const bw = await b.wait(m => m.type === 'welcome');
  return { a, b, aid: aw.id, bid: bw.id, url };
}

test('two WebSocket clients share authoritative loot, validated movement and personal extraction results', { timeout: 15000 }, async t => {
  const server = await createCoopServer(); t.after(() => server.close());
  assert.match(server.token, /^[a-f0-9]{64}$/);
  const { a, b, aid, bid } = await pair(t, server);
  a.send({ type: 'ready', ready: true }); b.send({ type: 'ready', ready: true });
  await a.wait(m => m.type === 'lobby' && m.players.length === 2 && m.players.every(p => p.ready));
  b.send({ type: 'start', difficulty: 'normal' }); assert.match((await b.wait(m => m.type === 'error')).message, /Host/);
  a.send({ type: 'start', difficulty: 'normal' });
  const initial = await a.wait(m => m.type === 'snapshot' && m.state.phase === 'raid');
  const peer = await b.wait(m => m.type === 'snapshot' && m.state.phase === 'raid');
  assert.equal(initial.state.raid.seed, peer.state.raid.seed);
  assert.equal(initial.state.teammates[0].id, bid); assert.equal(peer.state.teammates[0].id, aid);
  const ga = server.session.players.get(aid).game, gb = server.session.players.get(bid).game;
  ga.state.enemies.splice(0);
  a.send({ type: 'input', seq: 1, input: { forward: 999, x: 9999, hp: 0, ammo: 9000, fire: false } });
  const moved = await a.wait(m => m.type === 'snapshot' && m.ack === 1 && m.state.player.z < 48);
  assert.ok(Math.abs(moved.state.player.x + 7) < .02); assert.equal(moved.state.player.hp, 100); assert.equal(moved.state.player.ammo, 24);
  a.send({ type: 'input', seq: 2, input: { forward: 0 } });
  await a.wait(m => m.type === 'snapshot' && m.ack === 2);
  assert.equal(initial.state.loot.length, 0);
  const container = ga.state.containers.find(c => c.id === 'arrival-tools'), item = container.items[0];
  ga.teleport(container.x, container.z + container.d / 2 + .9); gb.teleport(container.x, container.z + container.d / 2 + .9);
  a.send({ type: 'action', action: 'interact' }); b.send({ type: 'action', action: 'interact' });
  await a.wait(m => m.type === 'snapshot' && m.state.activeContainerId === container.id);
  await b.wait(m => m.type === 'snapshot' && m.state.activeContainerId === container.id);
  a.send({ type: 'action', action: 'take', containerId: container.id, id: item.id });
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(ga.state.raid.loot.length, 0, 'searching does not allow an early take');
  advance(server, 1.7);
  const searched = await b.wait(m => m.type === 'snapshot' && m.state.containers.find(c => c.id === container.id)?.searched);
  assert.equal(searched.state.activeContainerId, container.id);
  a.send({ type: 'action', action: 'take', containerId: 'wrong-container', id: item.id });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(ga.state.raid.loot.length, 0, 'item membership is enforced at the server boundary');
  a.send({ type: 'action', action: 'take', containerId: container.id, id: item.id });
  await a.wait(m => m.type === 'snapshot' && m.state.raid.loot.some(value => value.id === item.id));
  b.send({ type: 'action', action: 'take', containerId: container.id, id: item.id });
  const noDuplicate = await b.wait(m => m.type === 'snapshot' && m.state.containers.find(c => c.id === container.id)?.items.find(value => value.id === item.id)?.taken);
  assert.equal(noDuplicate.state.raid.loot.length, 0);
  a.send({ type: 'action', action: 'closeContainer' }); b.send({ type: 'action', action: 'closeContainer' });
  await a.wait(m => m.type === 'snapshot' && !m.state.activeContainerId && m.state.raid.loot.length === 1);
  ga.teleport(-7, 48); gb.teleport(-7, 48);
  advance(server, .15); a.send({ type: 'action', action: 'drop', id: item.id });
  await a.wait(m => m.type === 'snapshot' && m.state.raid.loot.length === 0 && m.state.loot[0]?.taken === false && m.seq > moved.seq);
  advance(server, .15); b.send({ type: 'action', action: 'interact' });
  await b.wait(m => m.type === 'snapshot' && m.state.raid.loot.length === 1);
  const exit = EXTRACTIONS[0]; ga.teleport(exit.x, exit.z); gb.teleport(exit.x + 1, exit.z);
  advance(server, .15); a.send({ type: 'action', action: 'interact' }); b.send({ type: 'action', action: 'interact' });
  await b.wait(m => m.type === 'snapshot' && m.state.raid.extractionProgress > 0);
  advance(server, 8.2);
  const ar = await a.wait(m => m.type === 'snapshot' && m.state.phase === 'extracted');
  const br = await b.wait(m => m.type === 'snapshot' && m.state.phase === 'extracted');
  assert.equal(ar.state.profile.intake.length, 0); assert.equal(br.state.profile.intake.length, 1);
  assert.equal(ar.state.profile.credits, 0); assert.equal(br.state.profile.credits, 750);
  assert.equal(br.state.result.value, item.value); assert.equal(br.state.coopPhase, 'finished');
  assert.equal(a.ws.readyState, WebSocket.OPEN); assert.equal(b.ws.readyState, WebSocket.OPEN);
});

test('WebSocket take-all obeys shared contents and immediate close cancels private crate interaction', { timeout: 10000 }, async t => {
  const server = await createCoopServer(); t.after(() => server.close());
  const { a, b, aid, bid } = await pair(t, server);
  server.session.ready(aid, true); server.session.ready(bid, true); server.session.start(aid);
  const ga = server.session.players.get(aid).game, gb = server.session.players.get(bid).game;
  ga.state.enemies.splice(0);
  const container = ga.state.containers.find(c => c.type === 'medical');
  assert.ok(ga.teleport(container.x, container.z + container.d / 2 + .9));
  assert.ok(gb.teleport(container.x, container.z + container.d / 2 + .9));
  const beforeMedkits = ga.state.player.medkits;
  a.send({ type: 'action', action: 'interact' });
  await a.wait(m => m.type === 'snapshot' && m.state.activeContainerId === container.id);
  advance(server, 1.6);
  await a.wait(m => m.type === 'snapshot' && m.state.containers.find(c => c.id === container.id)?.searched);
  a.send({ type: 'action', action: 'takeAll', containerId: container.id });
  const claimed = await a.wait(m => m.type === 'snapshot' && m.state.containers.find(c => c.id === container.id)?.items.every(item => item.taken));
  assert.equal(claimed.state.raid.loot.length, container.items.filter(item => !['ammo','medkit'].includes(item.kind)).length);
  assert.equal(claimed.state.player.medkits, beforeMedkits + 1);
  b.send({ type: 'action', action: 'interact' });
  await b.wait(m => m.type === 'snapshot' && m.state.activeContainerId === container.id);
  advance(server, .1); b.send({ type: 'action', action: 'takeAll', containerId: container.id });
  b.send({ type: 'action', action: 'closeContainer' });
  const closed = await b.wait(m => m.type === 'snapshot' && !m.state.activeContainerId && m.state.containers.find(c => c.id === container.id)?.searched);
  assert.equal(closed.state.raid.loot.length, 0);
  assert.equal(closed.state.containerSearchRemaining, 0);
});

test('WebSocket authentication, protocol, capacity, ping and graceful shutdown are enforced', { timeout: 15000 }, async t => {
  const server = await createCoopServer(); t.after(() => server.close());
  const rejected = new WebSocket(`ws://127.0.0.1:${server.port}/coop?token=${'0'.repeat(64)}`);
  rejected.on('error', () => {}); t.after(() => rejected.terminate());
  const [, response] = await once(rejected, 'unexpected-response');
  assert.equal(response.statusCode, 401);
  rejected.terminate();
  const url = `ws://127.0.0.1:${server.port}/coop?token=${server.token}`;
  const mismatch = await connect(t, url);
  mismatch.send({ type: 'join', protocol: 99, name: 'Old' });
  assert.match((await mismatch.wait(m => m.type === 'error')).message, /Protokoll/);
  if (mismatch.ws.readyState !== WebSocket.CLOSED) await once(mismatch.ws, 'close');
  const { a, b } = await pair(t, server);
  a.send({ type: 'ping', time: 12345 }); assert.equal((await a.wait(m => m.type === 'pong')).time, 12345);
  a.ws.send('{broken'); assert.match((await a.wait(m => m.type === 'error')).message, /JSON/);
  const third = new WebSocket(url); third.on('error', () => {}); t.after(() => third.terminate());
  const [, fullResponse] = await once(third, 'unexpected-response'); assert.equal(fullResponse.statusCode, 503); third.terminate();
  const aClosed = a.wait(m => m.type === 'closed'), bClosed = b.wait(m => m.type === 'closed');
  await server.close();
  assert.match((await aClosed).message, /Host/); assert.match((await bClosed).message, /Host/);
  await server.close();
});

test('real WebSocket loadouts validate weapons, retain migrated skills and award combat XP only to the shooter', {timeout:10000}, async t=>{
  const server=await createCoopServer();t.after(()=>server.close());
  const url=`ws://127.0.0.1:${server.port}/coop?token=${server.token}`;
  const a=await connect(t,url),b=await connect(t,url);
  a.send({type:'join',protocol:1,version:'1.3.0',weapon:'invented-gun',profile:{credits:750}});
  assert.match((await a.wait(m=>m.type==='error')).message,/Kit|Waffe/);
  const pa=ownedProfile({weapon:'RV-6',upgrades:{armor:2},gear:['carrier-web','plate-fiber','helmet-bump']}),pb=ownedProfile({weapon:'SG-8',attachments:['muzzle-choke']});
  const guestCost=resolveLoadout(pb).cost;
  a.send({type:'join',protocol:1,version:'1.3.0',profile:pa,name:'Revolver'});
  const aid=(await a.wait(m=>m.type==='welcome')).id;
  b.send({type:'join',protocol:1,version:'1.3.0',profile:pb,name:'Shotgun'});
  const bid=(await b.wait(m=>m.type==='welcome')).id;
  a.send({type:'ready',ready:true});b.send({type:'ready',ready:true});
  await a.wait(m=>m.type==='lobby'&&m.players.length===2&&m.players.every(p=>p.ready));
  a.send({type:'start'});
  const start=await a.wait(m=>m.type==='snapshot'&&m.state.phase==='raid');
  assert.equal(start.state.player.weapon,'RV-6');assert.equal(start.state.player.magSize,6);assert.equal(start.state.player.armor,70);
  const partner=await b.wait(m=>m.type==='snapshot'&&m.state.phase==='raid');
  assert.equal(partner.state.player.weapon,'SG-8');assert.equal(partner.state.player.magSize,8);assert.equal(partner.state.profile.credits,pb.credits-guestCost);
  assert.equal(partner.state.player.attachments.muzzle,'muzzle-choke');
  const game=server.session.players.get(aid).game,target=game.state.enemies[0];
  game.state.enemies.splice(1);Object.assign(target,{x:-7,z:42,hp:20,fireTimer:9999,pathTimer:9999,alert:0});
  a.send({type:'input',seq:1,input:{fire:false,firePressed:true,yaw:0,pitch:0}});
  const killed=await a.wait(m=>m.type==='snapshot'&&m.state.enemies.find(e=>e.id===target.id)?.dead);
  assert.equal(killed.state.player.ammo,5);assert.ok(killed.state.profile.progression.xp>=50);
  assert.equal(server.session.players.get(bid).game.state.profile.progression.xp,0);
  advance(server,.7);assert.equal(game.state.player.ammo,5);
});
