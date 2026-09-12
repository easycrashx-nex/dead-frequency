import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, isWalkable, hasLineOfSight, findPath, seededRandom } from '../src/simulation.js';
import { createCoopSession } from '../src/coop-session.js';
import { COLLIDERS } from '../src/layout.js';
import { createEnemyAI } from '../src/enemy-ai.js';

const DT = 1 / 60;
const point = entity => ({ x: entity.x, z: entity.z });
const separation = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
async function setup(t, difficulty = 'normal', seed = 1901) {
  const game = await createGame(null, { externalAI: true }); t.after(() => game.dispose());
  assert.equal(game.startRaid({ difficulty, seed }), true); return game;
}
function guardAt(game, x, z, { kind = 'guard', flank = false, id = 'test-guard', yaw = Math.PI } = {}) {
  const guard = structuredClone(game.state.enemies.find(enemy => enemy.kind === kind));
  assert.ok(guard, `Missing ${kind} template`); delete guard.ai;
  return Object.assign(guard, { id, x, z, yaw, home: { x, z }, dead: false, flank, mode: 'patrol',
    alert: 0, fireTimer: 0, path: [], pathTimer: 0, patrol: null, lastSeen: null, lastHeard: null });
}
function targetAt(x, z, id = 'target') {
  const hits = [], state = { phase: 'raid', player: { x, y: 0, z, hp: 100, moving: false, sprinting: false, crouching: false } };
  return { id, state, hits, damage(amount, enemy) { hits.push({ amount, enemyId: enemy.id }); } };
}
function clearMovement(from, to, label) {
  const steps = Math.max(1, Math.ceil(separation(from, to) / .06));
  for (let step = 0; step <= steps; step++) {
    const f = step / steps, x = from.x + (to.x - from.x) * f, z = from.z + (to.z - from.z) * f;
    assert.ok(isWalkable(x, z, .38), `${label}: movement intersects solid geometry at ${x},${z}`);
  }
}
function advance(game, seconds, targets, observe = () => {}) {
  for (let frame = 0; frame < Math.ceil(seconds / DT); frame++) {
    const before = game.state.enemies.map(point);
    game.advanceEnemies(DT, targets);
    game.state.enemies.forEach((enemy, index) => {
      if (!enemy.dead) clearMovement(before[index], enemy, enemy.id);
    });
    observe(frame * DT);
  }
}
function planner() {
  const shots = [];
  const brain = createEnemyAI({ isWalkable, findPath, hasLineOfSight, colliders: COLLIDERS, random: seededRandom(1942),
    walkSegmentClear(from, to, radius) {
      const steps = Math.max(1, Math.ceil(separation(from, to) / .06));
      for (let index = 0; index <= steps; index++) {
        const f = index / steps;
        if (!isWalkable(from.x + (to.x - from.x) * f, from.z + (to.z - from.z) * f, radius)) return false;
      }
      return true;
    },
    shoot(enemy, target) { shots.push({ from: point(enemy), target: point(target.state.player), task: enemy.ai.task }); enemy.fireTimer = 1; },
  });
  return { brain, shots, advance(enemies, seconds, targets, observe = () => {}) {
    const facade = { state: { enemies }, advanceEnemies(dt, currentTargets) { brain.update(dt, enemies, currentTargets, 'normal'); } };
    advance(facade, seconds, targets, observe);
  } };
}

test('guard and elite HP, first reaction and individual bullet damage retain their previous difficulty values', async t => {
  for (const difficulty of ['normal', 'hard']) for (const kind of ['guard', 'elite']) {
    const game = await setup(t, difficulty), guard = guardAt(game, -140, 118, { kind });
    assert.equal(guard.hp, kind === 'elite' ? 150 : 95);
    game.state.enemies = [guard]; game.drainEvents();
    const target = targetAt(-140, 130), shotTimes = []; let time = 0;
    advance(game, 15, [target], () => {
      time += DT;
      for (const event of game.drainEvents()) if (event.type === 'enemyShot') shotTimes.push(time);
    });
    assert.ok(shotTimes.length >= 3, `${difficulty}/${kind}: never engaged`);
    assert.ok(shotTimes[0] >= (difficulty === 'hard' ? .65 : .95) - DT - 1e-8, `${difficulty}/${kind}: shortened reaction delay`);
    for (let index = 1; index < shotTimes.length; index++) assert.ok(shotTimes[index] - shotTimes[index - 1] >= (kind === 'elite' ? .65 : .92) - DT - 1e-8, `${difficulty}/${kind}: fire interval shortened`);
    assert.ok(target.hits.length > 0, `${difficulty}/${kind}: no actual hits`);
    for (const hit of target.hits) assert.equal(hit.amount, (kind === 'elite' ? 18 : 13) * (difficulty === 'hard' ? 1.15 : 1));
  }
});

test('unseen silent movement behind a solid building cannot update the last observed position or permit damage', async t => {
  const game = await setup(t), guard = guardAt(game, -52, 25), target = targetAt(-52, 40);
  game.state.enemies = [guard]; advance(game, .5, [target]);
  assert.deepEqual(guard.lastSeen, { x: -52, z: 40 });
  const observed = structuredClone(guard.lastSeen), hits = target.hits.length;
  game.drainEvents();
  for (const hidden of [{ x: -40, z: 9 }, { x: -39, z: 9 }]) {
    Object.assign(target.state.player, hidden);
    assert.equal(hasLineOfSight({ ...guard, y: 1.55 }, { ...target.state.player, y: 1.3 }), false);
    advance(game, .35, [target], () => assert.deepEqual(guard.lastSeen, observed));
  }
  assert.equal(target.hits.length, hits);
  assert.equal(game.drainEvents().some(event => event.type === 'enemyShot'), false);
});

test('all emitted guard shots have unobstructed geometry even immediately after the target takes cover', async t => {
  const game = await setup(t), guard = guardAt(game, -52, 25), target = targetAt(-52, 40);
  game.state.enemies = [guard]; game.drainEvents(); let shots = 0;
  advance(game, 5, [target], () => {
    for (const event of game.drainEvents()) if (event.type === 'enemyShot') {
      shots++;
      assert.equal(hasLineOfSight(event.from, { ...target.state.player, y: 1.3 }), true, 'Shot fired through solid cover');
    }
  });
  assert.ok(shots > 0);
  // Establish a fresh visible contact at a fixed corner. The earlier guard may
  // legitimately have moved to different cover during its engagement.
  const cornerGuard = guardAt(game, -52, 25, { id: 'corner-guard' }); game.state.enemies = [cornerGuard];
  Object.assign(target.state.player, { x: -52, z: 40 }); advance(game, .35, [target]); game.drainEvents();
  assert.equal(cornerGuard.ai.visible, true);
  Object.assign(target.state.player, { x: -40, z: 9 });
  assert.equal(hasLineOfSight({ ...cornerGuard, y: 1.55 }, { ...target.state.player, y: 1.3 }), false);
  cornerGuard.fireTimer = 0;
  const before = target.hits.length; advance(game, DT, [target]);
  assert.equal(target.hits.length, before, 'Cached visual contact caused damage through newly entered cover');
  assert.equal(game.drainEvents().some(event => event.type === 'enemyShot'), false);
});

test('matching raid seeds and observed target movements reproduce the full tactical evolution', async t => {
  const a = await setup(t, 'normal', 1917), b = await setup(t, 'normal', 1917);
  for (const game of [a, b]) game.state.enemies = [guardAt(game, 0, 23, { id: 'anchor' }), guardAt(game, -4, 23, { id: 'flanker', flank: true })];
  const targetA = targetAt(2, 35), targetB = targetAt(2, 35);
  a.drainEvents(); b.drainEvents();
  for (const location of [{ x: 2, z: 35 }, { x: 9, z: 34 }, { x: -10, z: 30 }]) {
    Object.assign(targetA.state.player, location); Object.assign(targetB.state.player, location);
    advance(a, 4, [targetA]); advance(b, 4, [targetB]);
    assert.deepEqual(a.state.enemies, b.state.enemies); assert.deepEqual(a.drainEvents(), b.drainEvents()); assert.deepEqual(targetA.hits, targetB.hits);
  }
});

test('shared tactical AI switches to the living teammate after the host actually dies', async t => {
  const session = createCoopSession({ seed: 1941 }); t.after(() => session.close());
  const a = await session.join({ name: 'Alpha', profile: { credits: 750 }, kit: 'scout' });
  const b = await session.join({ name: 'Bravo', profile: { credits: 750 }, kit: 'scout' });
  session.ready(a, true); session.ready(b, true); session.start(a);
  const ga = session.players.get(a).game, gb = session.players.get(b).game;
  const guard = guardAt(ga, -52, 25); ga.state.enemies.splice(0, ga.state.enemies.length, guard);
  assert.equal(ga.teleport(-52, 39), true); assert.equal(gb.teleport(-52, 40), true);
  for (let frame = 0; frame < 30; frame++) session.update(DT);
  ga.receiveDamage(10_000, guard); assert.equal(ga.state.phase, 'dead');
  const hp = gb.state.player.hp;
  for (let frame = 0; frame < 15 * 60 && gb.state.player.hp === hp; frame++) session.update(DT);
  assert.equal(gb.state.phase, 'raid'); assert.ok(gb.state.player.hp < hp, 'AI stopped with the dead host');
  assert.equal(guard.targetPlayerId, b); assert.equal(ga.state.player.hp, 0);
});

test('gunshots reveal only a coarse sound location within the direct or occluded hearing range', async t => {
  const game = await setup(t), ai = planner();
  const near = guardAt(game, -39, -15, { id: 'near-listener' });
  const far = guardAt(game, -60, -15, { id: 'far-listener' });
  const muffled = guardAt(game, -10, 20, { id: 'muffled-listener' });
  const source = { x: -10, z: -15 };
  assert.equal(hasLineOfSight({ ...near, y: 1.55 }, { ...source, y: 1.4 }), false);
  assert.equal(hasLineOfSight({ ...muffled, y: 1.55 }, { ...source, y: 1.4 }), false);
  ai.brain.hear([near, far, muffled], source, { kind: 'shot', playerId: 'shooter', radius: 36 });
  assert.ok(near.lastHeard); assert.equal(near.lastSeen, null);
  assert.ok(separation(near.lastHeard, source) > 0 && separation(near.lastHeard, source) <= Math.sqrt(4.5));
  assert.equal(Math.abs(near.lastHeard.x % 3), 0); assert.equal(Math.abs(near.lastHeard.z % 3), 0);
  assert.equal(far.lastHeard, null); assert.equal(muffled.lastHeard, null);
  ai.advance([near], .4, [targetAt(140, 140)]);
  assert.equal(near.ai.task, 'investigate'); assert.equal(near.lastSeen, null);
  assert.ok(separation(near.ai.goal, near.lastHeard) < 3);
});

test('sprinting is heard nearby, while silent movement and distant or wall-muffled steps disclose nothing', async t => {
  const game = await setup(t);
  for (const scenario of [
    { name: 'near sprint', guard: [-52, 25], player: [-52, 34], sprinting: true, heard: true },
    { name: 'quiet walking', guard: [-52, 25], player: [-52, 34], sprinting: false, heard: false },
    { name: 'distant sprint', guard: [-52, 25], player: [-52, 38], sprinting: true, heard: false },
    { name: 'wall-muffled sprint', guard: [5, 43], player: [14, 43], sprinting: true, heard: false },
  ]) {
    const ai = planner(), guard = guardAt(game, ...scenario.guard, { id: scenario.name, yaw: 0 }), target = targetAt(...scenario.player);
    Object.assign(target.state.player, { moving: true, sprinting: scenario.sprinting });
    // Inspect the first staggered sensing pass. After hearing a sprint the bot
    // may legitimately turn around and establish a later visual contact.
    ai.advance([guard], .21, [target]);
    assert.equal(!!guard.lastHeard, scenario.heard, scenario.name);
    assert.equal(guard.lastSeen, null, `${scenario.name}: sound became visual knowledge`);
    assert.equal(ai.shots.length, 0, scenario.name);
  }
});

test('visual contact reaches at most three nearby allies and cannot broadcast through the whole district', async t => {
  const game = await setup(t), ai = planner(), reporter = guardAt(game, -52, 10, { id: 'reporter' });
  const friends = [-40, -37, -34, -31].map((x, index) => guardAt(game, x, 9, { id: `listener-${index}`, yaw: 0 }));
  const distant = guardAt(game, -52, -18, { id: 'distant-listener', yaw: 0 }), target = targetAt(-52, 38);
  assert.equal(hasLineOfSight({ ...reporter, y: 1.55 }, { ...target.state.player, y: 1.3 }), true);
  for (const friend of friends) {
    assert.equal(hasLineOfSight({ ...reporter, y: 1.55 }, { ...friend, y: 1.55 }), true);
    assert.equal(hasLineOfSight({ ...friend, y: 1.55 }, { ...target.state.player, y: 1.3 }), false);
  }
  ai.advance([reporter, ...friends, distant], .4, [target]);
  assert.deepEqual(reporter.lastSeen, { x: -52, z: 38 });
  assert.equal(friends.filter(friend => friend.ai.sharedContact).length, 3);
  for (const friend of friends.slice(0, 3)) { assert.deepEqual(friend.ai.sharedContact, reporter.lastSeen); assert.equal(friend.lastSeen, null); }
  assert.equal(friends[3].ai.sharedContact, null); assert.equal(distant.ai.sharedContact, null);
});

test('an anchor enters genuine hard cover, holds it, peeks to shoot and returns behind the obstacle', async t => {
  const game = await setup(t), ai = planner(), guard = guardAt(game, 11, 3, { id: 'cover-anchor', yaw: -Math.PI / 2 }), target = targetAt(20, 3);
  const tasks = [], nearHide = [], nearPeek = []; let time = 0;
  ai.advance([guard], 20, [target], () => {
    time += DT;
    if (tasks.at(-1)?.task !== guard.ai.task) tasks.push({ task: guard.ai.task, time });
    if (!guard.ai.cover) return;
    assert.equal(hasLineOfSight({ ...guard.ai.cover.hide, y: 1.55 }, { ...target.state.player, y: 1.3 }), false);
    assert.equal(hasLineOfSight({ ...guard.ai.cover.peek, y: 1.55 }, { ...target.state.player, y: 1.3 }), true);
    if (guard.ai.task === 'cover' && separation(guard, guard.ai.cover.hide) < .35) nearHide.push(time);
    if (guard.ai.task === 'peek' && separation(guard, guard.ai.cover.peek) < .35) nearPeek.push(time);
  });
  assert.equal(guard.ai.role, 'anchor'); assert.ok(nearHide.length > 0, 'Never reached physical hiding position');
  assert.ok(nearPeek.length > 0, 'Never reached a visible firing position');
  const firstPeek = tasks.find(entry => entry.task === 'peek'); assert.ok(firstPeek);
  assert.ok(firstPeek.time - nearHide[0] >= 1.1, `Cover was abandoned immediately: ${firstPeek.time - nearHide[0]}s`);
  assert.ok(nearHide.some(time => time > nearPeek[0] + .5), 'Never returned to cover after peeking');
  assert.ok(ai.shots.some(shot => shot.task === 'peek'), 'Peek never produced a firing opportunity');
  for (const shot of ai.shots) assert.equal(hasLineOfSight({ ...shot.from, y: 1.43 }, { ...shot.target, y: 1.3 }), true);
});

test('flankers move laterally while an anchor maintains pressure instead of both following the same path', async t => {
  const game = await setup(t), ai = planner(), anchor = guardAt(game, -135, 118, { id: 'pressure-anchor' });
  const flanker = guardAt(game, -140, 118, { id: 'wide-flanker', flank: true }), target = targetAt(-140, 130);
  const start = point(flanker), roles = new Set(), goals = new Set();
  ai.advance([anchor, flanker], 3.5, [target], () => {
    roles.add(flanker.ai.task);
    if (flanker.ai.goal) goals.add(`${flanker.ai.goal.x.toFixed(1)},${flanker.ai.goal.z.toFixed(1)}`);
  });
  assert.equal(anchor.ai.role, 'anchor'); assert.equal(flanker.ai.role, 'flanker'); assert.ok(roles.has('flank'));
  assert.ok(Math.abs(flanker.x - start.x) > 3, 'Flanker only charged straight at the player');
  assert.ok(goals.size > 0); assert.ok(separation(anchor, flanker) > 3);
});

test('a remembered contact is reached around containers, scanned and swept before memory expires and the guard returns', async t => {
  const game = await setup(t), ai = planner(), guard = guardAt(game, -7, 18, { id: 'searcher' }), remembered = { x: -7, z: 3 };
  Object.assign(guard, { lastSeen: remembered, home: { x: -7, z: 45 } });
  const tasks = new Set(), sectors = new Set(); let closest = Infinity;
  ai.advance([guard], 75, [targetAt(-55, 55)], () => {
    tasks.add(guard.ai.task); closest = Math.min(closest, separation(guard, remembered));
    if (guard.ai.task === 'sweep' && guard.ai.goal) sectors.add(`${guard.ai.goal.x.toFixed(1)},${guard.ai.goal.z.toFixed(1)}`);
    assert.deepEqual(guard.lastSeen, remembered);
  });
  assert.ok(closest < 1.6, `Search gave up before reaching the remembered contact: ${closest}m`);
  for (const task of ['investigate', 'scan', 'sweep', 'return', 'patrol']) assert.ok(tasks.has(task), `Missing search stage ${task}`);
  assert.ok(sectors.size >= 2, 'Search did not check distinct nearby sectors');
  assert.equal(ai.shots.length, 0);
});

test('a stale route into solid geometry triggers recovery and a new safe route to the search location', async t => {
  const game = await setup(t), ai = planner(), guard = guardAt(game, -7, 18, { id: 'stuck-searcher' }), remembered = { x: -7, z: 3 };
  Object.assign(guard, { lastSeen: remembered, alert: 60 });
  const distant = targetAt(-55, 55); ai.advance([guard], DT, [distant]);
  // Emulate a stale waypoint left inside a blocker. Recovery must discard it,
  // not teleport through the wall or keep pushing into it for the whole raid.
  guard.path = [{ x: -7, z: 13 }]; let closest = Infinity;
  ai.advance([guard], 30, [distant], () => { closest = Math.min(closest, separation(guard, remembered)); });
  assert.ok(guard.ai.recoveries >= 1, 'No recovery after the blocked waypoint');
  assert.ok(closest < 1.6, `Guard remained stuck instead of replanning: ${closest}m`);
  assert.equal(ai.shots.length, 0);
});

test('thirty-three active brains keep sensing and route work within their staggered budgets', async t => {
  const game = await setup(t), ai = planner(), enemies = [];
  for (let index = 0; index < 33; index++) {
    const guard = guardAt(game, -39, -30 + index * .7, { id: `budget-${index}`, flank: index % 3 === 0 });
    Object.assign(guard, { lastSeen: { x: -25, z: -15 }, alert: 60 }); enemies.push(guard);
  }
  ai.advance(enemies, 6, [targetAt(140, 140)]);
  const stats = ai.brain.stats();
  assert.ok(stats.senses > 33); assert.ok(stats.senses <= 33 * 31, `Sensing exceeded 5 Hz: ${stats.senses}`);
  assert.ok(stats.plans <= 33 * 9, `Planning ran every frame: ${stats.plans}`);
  assert.ok(stats.routes > 0); assert.ok(stats.routes <= 122, `Global route budget exceeded: ${stats.routes}`);
});
