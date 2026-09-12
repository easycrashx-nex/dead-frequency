// The host owns these serializable brains. Geometry and combat are injected so
// this planner cannot import the simulation or alter weapon damage/accuracy.
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z,(a.y??0)-(b.y??0));
const point = value => ({ x: value.x, y:value.y??0, z: value.z });
const hash = value => { let n = 0; for (const c of String(value)) n = Math.imul(n, 31) + c.charCodeAt(0) | 0; return n >>> 0; };
const finitePoint = value => value && Number.isFinite(value.x) && Number.isFinite(value.z);
const eye = value => ({ x: value.x, y:(value.y??0)+1.55, z: value.z });
const soundPoint = value => ({ x: Math.round(value.x / 3) * 3, y:value.y??0, z: Math.round(value.z / 3) * 3 });

export function createEnemyAI({ isWalkable, findPath, hasLineOfSight, walkSegmentClear,getGroundHeight=()=>0,getSupportHeight=(x,z)=>getGroundHeight(x,z),colliders = [], random = Math.random, shoot = () => {} }) {
  const coverPoints = [];
  let routeTokens = 2, metrics = { plans: 0, senses: 0, routes: 0 };
  const clear = (a, b) => walkSegmentClear(a, b, .38);
  for (const box of colliders) {
    const baseY=getGroundHeight(box.x,box.z);
    if (box.y - box.h / 2 > baseY+.1 || box.y + box.h / 2 < baseY+1.9) continue;
    for (const axis of ['x', 'z']) {
      const tangent = axis === 'x' ? 'z' : 'x', width = (axis === 'x' ? box.w : box.d) / 2, length = (axis === 'x' ? box.d : box.w) / 2;
      for (const side of [-1, 1]) for (const end of [-1, 1]) {
        const hide = { [axis]: box[axis] + side * (width + .75), [tangent]: box[tangent] + end * (length - Math.min(.65, length * .6)),y:baseY };
        const peek = { [axis]: hide[axis], [tangent]: box[tangent] + end * (length + 1.05),y:baseY };
        if (isWalkable(hide.x, hide.z, .48) && isWalkable(peek.x, peek.z, .48) && clear(hide, peek)) coverPoints.push({ id: `${box.id}:${axis}:${side}:${end}`, hide, peek });
      }
    }
  }
  function initialize(e) {
    if (e.ai) return e.ai;
    const seed = hash(e.id), initialContact = finitePoint(e.lastSeen);
    e.path ||= []; e.home ||= point(e); e.alert ||= 0; e.fireTimer ??= 1.2; e.yaw ||= 0; e.side ||= seed % 2 ? 1 : -1;
    return e.ai = { role: e.role==='flanker'||(!e.role&&e.flank) ? 'flanker' : 'anchor', task: initialContact ? 'investigate' : 'patrol',
      goal: null, cover: null, coverPhase: 'hide', coverTimer: 0, coverRetry: 0, rejectedCover: null,
      planTimer: (seed % 6) * .04 + .01, planCooldown: 0, senseTimer: (seed % 6) * .04, routeTimer: 0, shareTimer: 0, soundTimer: 0,
      visible: false, targetId: null, contactAge: initialContact ? 0 : 999, heardAge: 999, sharedAge: 999,
      sharedContact: null, memoryDuration: Math.max(26, initialContact ? e.alert : 0), searchStage: 0, searchTimer: 0,
      searchOrigin: null, searchSector: 0, flankGoal: null, flankTimer: 0, flankStage: 0, flankPlan: null,
      underFire: 0, relocate: false, stuckTime: 0, recoveries: 0, previousPosition: point(e) };
  }
  function hearOne(e, location, kind, playerId, radius) {
    const ai = initialize(e), dist = distance(e, location);
    if (dist > radius || ai.visible) return false;
    const direct = hasLineOfSight(eye(e), { ...location, y: (location.y??0)+1.4 });
    if (!direct && dist > radius * (kind === 'sprint' ? .5 : .85)) return false;
    if (kind === 'sprint' && ai.soundTimer > 0) return false;
    const heard = soundPoint(location), changed = !e.lastHeard || distance(e.lastHeard, heard) > 2;
    e.lastHeard = heard; ai.heardAge = 0; ai.soundTimer = 1.1;
    ai.heardTargetId = playerId ?? null;
    e.alert = Math.max(e.alert, kind === 'sprint' ? 8 : 16);
    if (changed || ai.task === 'patrol' || ai.task === 'return') { ai.searchStage = 0; ai.searchOrigin = null; ai.planTimer = 0; }
    return true;
  }
  function hear(enemies, location, { kind = 'shot', playerId = null, radius = 90 } = {}) {
    if (!finitePoint(location)) return;
    for (const e of enemies) if (!e.dead) hearOne(e, location, kind, playerId, radius);
  }
  function hit(e) { const ai = initialize(e); ai.underFire = 2.4; ai.relocate = true; ai.planTimer = 0; ai.coverRetry = 0; }
  function freeGoal(value) {
    value={...value,y:getSupportHeight(value.x,value.z,value.y??getGroundHeight(value.x,value.z))};
    if (isWalkable(value.x, value.z, .4,value.y)) return point(value);
    for (const radius of [.65, 1.3, 2.6]) for (let i = 0; i < 8; i++) {
      const candidate = { x: value.x + Math.cos(i * Math.PI / 4) * radius, z: value.z + Math.sin(i * Math.PI / 4) * radius,y:value.y };
      if (isWalkable(candidate.x, candidate.z, .4,candidate.y)) return candidate;
    }
    return null;
  }
  function setGoal(e, goal) {
    const ai = e.ai;
    if (!goal) { ai.goal = null; e.path = []; return; }
    if (!ai.goal || distance(ai.goal, goal) > .4||Math.abs((ai.goal.y??0)-(goal.y??0))>.5) { ai.goal = point(goal); e.path = []; }
  }
  function route(e, goal) {
    if (clear(e, goal)) return [point(goal)];
    if (routeTokens < 1 || e.ai.routeTimer > 0) return null;
    routeTokens--; metrics.routes++; e.ai.routeTimer = .95 + (hash(e.id) % 5) * .08;
    const path = findPath(e, goal);
    if (!path.length) return [];
    const last = path[path.length - 1];
    if (!clear(last, goal)) return [];
    // findPath returns grid centers. Cover must finish at the physical hiding
    // point, not one metre away at the nearest navigation cell.
    if (distance(last, goal) > .05) path.push(point(goal));
    return path;
  }
  function seekCover(e, contact, enemies) {
    const ai = e.ai;
    if (ai.coverRetry > 0) return null;
    ai.coverRetry = 2;
    const candidates = coverPoints.filter(cover => distance(e, cover.hide) < 15 && distance(contact, cover.hide) > 6 && cover.id !== ai.rejectedCover)
      .sort((a, b) => distance(e, a.hide) - distance(e, b.hide));
    for (const cover of candidates.slice(0, 10)) {
      if (enemies.some(other => other !== e && !other.dead && other.ai?.cover?.id === cover.id)) continue;
      if (hasLineOfSight(eye(cover.hide), { ...contact, y:(contact.y??0)+1.3 }) || !hasLineOfSight(eye(cover.peek), { ...contact, y:(contact.y??0)+1.3 })) continue;
      const path = route(e, cover.hide);
      if (path === null) { ai.coverRetry = .25; return null; }
      if (!path.length) continue;
      e.path = path; ai.goal = point(cover.hide); ai.coverPhase = 'hide'; ai.coverTimer = 1.8 + (hash(e.id) % 3) * .2;
      return { id: cover.id, hide: point(cover.hide), peek: point(cover.peek) };
    }
    return null;
  }
  function share(e, enemies) {
    const ai = e.ai;
    if (ai.shareTimer > 0 || !e.lastSeen) return;
    ai.shareTimer = 2.2;
    const nearby = enemies.filter(other => other !== e && !other.dead && distance(other, e) < (e.squadId&&other.squadId===e.squadId?65:24))
      .sort((a, b) => distance(a, e) - distance(b, e));
    let informed = 0;
    for (const other of nearby) {
      const brain = initialize(other);
      if (brain.visible || (!(e.squadId&&other.squadId===e.squadId)&&!hasLineOfSight(eye(e), eye(other)))) continue;
      brain.sharedContact = point(e.lastSeen); brain.sharedAge = 0; brain.sharedTargetId = ai.targetId;
      other.alert = Math.max(other.alert, 14);
      if (!brain.searchOrigin || distance(brain.searchOrigin, e.lastSeen) > 4) { brain.searchOrigin = null; brain.searchStage = 0; brain.planTimer = 0; }
      if (++informed >= 3) break;
    }
  }
  function sense(e, targets, enemies, difficulty) {
    const ai = e.ai; metrics.senses++; ai.senseTimer = .22 + (hash(e.id) % 5) * .012;
    let chosen = null, best = Infinity;
    for (const target of targets) {
      if (target.state.phase !== 'raid' || target.state.player.hp <= 0) continue;
      const p = target.state.player, dist = distance(e, p), dx = p.x - e.x, dz = p.z - e.z;
      const range = (difficulty === 'hard' ? 80 : 65) * (p.crouching && !p.moving ? .65 : 1);
      const dot = dist ? (-Math.sin(e.yaw) * dx - Math.cos(e.yaw) * dz) / dist : 1;
      if (dist < range && (e.alert > 0 || dot > .12 || dist < 7) && hasLineOfSight(eye(e), { x: p.x, y: (p.y || 0) + (p.crouching ? .95 : 1.3), z: p.z })) {
        if (dist < best) { chosen = target; best = dist; }
      } else if (p.sprinting && p.moving && dist < 12) hearOne(e, p, 'sprint', target.id, 12);
    }
    const wasVisible = ai.visible; ai.visible = !!chosen;
    if (chosen) {
      if (ai.contactAge > 2) e.fireTimer = Math.max(e.fireTimer, difficulty === 'hard' ? .65 : .95);
      const p = chosen.state.player; e.lastSeen = point(p); ai.contactAge = 0; ai.targetId = chosen.id ?? null;
      e.targetPlayerId = chosen.id ?? null; e.alert = 26; ai.searchStage = 0; ai.searchOrigin = null;
      if (!wasVisible) ai.planTimer = 0;
      share(e, enemies);
    } else if (wasVisible) ai.planTimer = 0;
  }
  function contact(e) {
    const ai = e.ai;
    let known = e.lastSeen && ai.contactAge < ai.memoryDuration ? e.lastSeen : null, age = known ? ai.contactAge : 999;
    if (e.lastHeard && ai.heardAge < 16 && ai.heardAge < age) { known = e.lastHeard; age = ai.heardAge; }
    if (ai.sharedContact && ai.sharedAge < 14 && ai.sharedAge < age) known = ai.sharedContact;
    return known;
  }
  function plan(e, enemies) {
    const ai = e.ai; metrics.plans++; ai.planTimer = .8 + (hash(e.id) % 5) * .05; ai.planCooldown = .2;
    const known = contact(e),leader=e.leaderId?enemies.find(other=>other.id===e.leaderId&&!other.dead):null;
    if(leader&&distance(e,leader)>28){ai.task='regroup';e.mode='search';setGoal(e,freeGoal({x:leader.x+(e.formationIndex%2?5:-5),y:leader.y,z:leader.z+(e.formationIndex<2?5:-5)}));return;}
    if (ai.cover && ai.coverPhase === 'peek' && distance(e, ai.cover.peek) < .5 && !ai.visible && ai.contactAge > 4) ai.cover = null;
    if (known && (ai.visible || (ai.cover && ai.contactAge < ai.memoryDuration))) {
      if (ai.relocate) { ai.rejectedCover = ai.cover?.id ?? null; ai.cover = null; ai.flankGoal = null; ai.flankPlan = null; ai.relocate = false; }
      if (ai.cover && (distance(known, ai.cover.hide) < 5 || hasLineOfSight(eye(ai.cover.hide), { ...known, y:(known.y??0)+1.3 }))) ai.cover = null;
      if (!ai.cover && (ai.role === 'anchor' || ai.underFire > 0)) ai.cover = seekCover(e, known, enemies);
      if (ai.cover) { ai.task = ai.coverPhase === 'peek' ? 'peek' : 'cover'; e.mode = 'attack'; setGoal(e, ai.cover[ai.coverPhase]); return; }
      const dist = distance(e, known), dx = (known.x - e.x) / Math.max(dist, .1), dz = (known.z - e.z) / Math.max(dist, .1);
      if (ai.role === 'flanker' && dist > 9) {
        if (!ai.flankPlan || distance(ai.flankPlan.contact, known) > 8 || (ai.flankTimer <= 0 && dist > 22)) {
          const width = Math.min(10, Math.max(6, dist * .4));
          ai.flankPlan = { contact: point(known), approach: freeGoal({ x: known.x - dx * 8 - dz * width * e.side,y:known.y, z: known.z - dz * 8 + dx * width * e.side }) };
          ai.flankGoal = freeGoal({ x: e.x - dz * width * e.side + dx * 3,y:e.y,z: e.z + dx * width * e.side + dz * 3 }); ai.flankTimer = 12; ai.flankStage = 0;
        }
        if (ai.flankGoal && distance(e, ai.flankGoal) < 1) {
          if (ai.flankStage === 0) { ai.flankStage = 1; ai.flankGoal = ai.flankPlan.approach; }
          else { ai.flankStage = 2; ai.flankGoal = null; }
        }
        if (ai.flankStage === 2) { ai.task = 'pressure'; e.mode = 'attack'; setGoal(e, null); return; }
        ai.task = 'flank'; e.mode = 'flank'; setGoal(e, ai.flankGoal); return;
      }
      ai.task = 'pressure'; e.mode = 'attack';
      setGoal(e, dist > 17 ? freeGoal({ x: known.x - dx * 13 - dz * e.side * 2.5,y:known.y,z: known.z - dz * 13 + dx * e.side * 2.5 }) : null); return;
    }
    ai.cover = null;
    if (known) {
      e.mode = 'search';
      if (ai.flankGoal && ai.flankTimer > 0 && distance(e, ai.flankGoal) > 1) { ai.task = 'flank'; setGoal(e, ai.flankGoal); return; }
      if (!ai.searchOrigin || distance(ai.searchOrigin, known) > 4) { ai.searchOrigin = point(known); ai.searchStage = 0; ai.searchSector = 0; }
      if (ai.searchStage === 0) {
        ai.task = 'investigate';
        const offset = ai.sharedContact && ai.contactAge > ai.memoryDuration && ai.heardAge >= 16 ? e.side * (ai.role === 'flanker' ? 4 : 2) : 0;
        const goal = freeGoal({ x: ai.searchOrigin.x + offset,y:ai.searchOrigin.y,z: ai.searchOrigin.z }); setGoal(e, goal);
        if (goal && distance(e, goal) < 1.5) { ai.searchStage = 1; ai.searchTimer = 1.3; setGoal(e, null); }
      } else if (ai.searchStage === 1) { ai.task = 'scan'; setGoal(e, null); if (ai.searchTimer <= 0) ai.searchStage = 2; }
      else {
        ai.task = 'sweep';
        if (!ai.goal || distance(e, ai.goal) < 1) {
          const angle = (hash(e.id) % 8) * Math.PI / 4 + ai.searchSector * Math.PI * .65 * e.side;
          const radius = ai.searchSector % 2 ? 6 : 4;
          setGoal(e, freeGoal({ x: ai.searchOrigin.x + Math.cos(angle) * radius,y:ai.searchOrigin.y,z: ai.searchOrigin.z + Math.sin(angle) * radius })); ai.searchSector++;
        }
      }
      return;
    }
    ai.flankGoal = null; ai.flankPlan = null; ai.searchOrigin = null; ai.searchStage = 0; e.mode = 'patrol';
    if(leader){ai.task='escort';setGoal(e,freeGoal({x:leader.x+(e.formationIndex%2?5:-5),y:leader.y,z:leader.z+(e.formationIndex<2?5:-5)}));return;}
    const homeDistance = distance(e, e.home);
    if ((ai.task === 'return' && homeDistance > 2) || (ai.task !== 'patrol' && ai.task !== 'return' && homeDistance > 4)) { ai.task = 'return'; setGoal(e, freeGoal(e.home)); return; }
    if (ai.task === 'return') e.patrol = null;
    ai.task = 'patrol';
    if (!e.patrol || distance(e, e.patrol) < 1.6 || !ai.goal) {
      const angle = random() * Math.PI * 2, radius = 5 + random() * 9;
      e.patrol = freeGoal({ x: e.home.x + Math.cos(angle) * radius,y:e.home.y,z: e.home.z + Math.sin(angle) * radius });
    }
    setGoal(e, e.patrol);
  }
  function recover(e, noRoute = false) {
    const ai = e.ai;
    ai.recoveries++; ai.stuckTime = 0; e.path = []; ai.coverRetry = 0; ai.relocate = true; ai.planTimer = 0;
    ai.flankGoal = null; ai.flankPlan = null; e.side *= -1; e.patrol = null;
    if (noRoute && e.mode === 'search') { ai.searchStage = 2; ai.goal = null; }
  }
  function move(e, enemies, dt) {
    const ai = e.ai;
    if (!ai.goal) { ai.stuckTime = 0; return; }
    if (!e.path.length) {
      const path = route(e, ai.goal); if (path) e.path = path;
    }
    let next = e.path[0];
    if (next && (distance(e,next)<.025||(distance(e,next)<.15&&(!e.path[1]||clear(e,e.path[1]))))) { e.path.shift(); next = e.path[0]; }
    if (!next) {
      ai.stuckTime = distance(e, ai.goal) > .35 ? ai.stuckTime + dt : 0;
      if (ai.stuckTime > 1.2) recover(e, true);
      return;
    }
    const dx = next.x - e.x, dz = next.z - e.z, len = Math.hypot(dx, dz);
    const speed = ai.task === 'patrol' || ai.task === 'return' ? 1.35 : ai.task === 'flank' ? 3.4 : e.mode === 'search' ? 3.05 : 2.55;
    const step = Math.min(speed * dt, len); let vx = dx / len * step, vz = dz / len * step;
    for (const other of enemies) if (other !== e && !other.dead) {
      const ox = e.x - other.x, oz = e.z - other.z, d = Math.hypot(ox, oz);
      if (d > .05 && d < .8) { vx += ox / d * (.8 - d) * dt; vz += oz / d * (.8 - d) * dt; }
    }
    const nextPoint = { x: e.x + vx, z: e.z + vz };nextPoint.y=getSupportHeight(nextPoint.x,nextPoint.z,e.y??getGroundHeight(e.x,e.z));
    if (isWalkable(nextPoint.x, nextPoint.z, .38,nextPoint.y) && clear(e, nextPoint)) { e.x = nextPoint.x; e.z = nextPoint.z;e.y=nextPoint.y; }
    // Sideways crowd separation is not forward route progress.
    if (len - distance(e, next) < dt * .12) ai.stuckTime += dt; else ai.stuckTime = 0;
    ai.previousPosition.x = e.x; ai.previousPosition.z = e.z;
    if (ai.stuckTime > 1.2) recover(e);
    if (!ai.visible) e.yaw = Math.atan2(-dx, -dz);
  }
  function update(dt, enemies, targets, difficulty = 'normal') {
    routeTokens = Math.min(3, routeTokens + dt * 20);
    for (const e of enemies) {
      e.attackFlash = Math.max(0, (e.attackFlash || 0) - dt); e.hitFlash = Math.max(0, (e.hitFlash || 0) - dt);
      if (e.dead) continue;
      const ai = initialize(e); e.fireTimer -= dt; e.alert = Math.max(0, e.alert - dt);
      for (const key of ['planTimer', 'planCooldown', 'senseTimer', 'routeTimer', 'shareTimer', 'soundTimer', 'coverRetry', 'flankTimer', 'underFire', 'searchTimer']) ai[key] = Math.max(0, ai[key] - dt);
      ai.contactAge = Math.min(999, ai.contactAge + dt); ai.heardAge = Math.min(999, ai.heardAge + dt); ai.sharedAge = Math.min(999, ai.sharedAge + dt);
      if (ai.senseTimer <= 0) sense(e, targets, enemies, difficulty);
      if (ai.cover && ai.goal && distance(e, ai.goal) < .35) {
        ai.coverTimer -= dt;
        if (ai.coverTimer <= 0) {
          ai.coverPhase = ai.coverPhase === 'hide' ? 'peek' : 'hide';
          ai.coverTimer = ai.coverPhase === 'peek' ? 1.05 : 1.8 + (hash(e.id) % 3) * .2;
          ai.task = ai.coverPhase === 'peek' ? 'peek' : 'cover'; setGoal(e, ai.cover[ai.coverPhase]);
        }
      }
      if (ai.planTimer <= 0 && ai.planCooldown <= 0) plan(e, enemies);
      if (ai.task === 'scan') e.yaw += dt * .9 * e.side;
      if (ai.visible) {
        const target = targets.find(target => (target.id ?? null) === ai.targetId && target.state.phase === 'raid' && target.state.player.hp > 0);
        if (target) {
          const p = target.state.player; e.yaw = Math.atan2(e.x - e.lastSeen.x, e.z - e.lastSeen.z);
          if (e.fireTimer <= 0 && distance(e, p) < 80) {
            const targetPoint = { x: p.x, y: (p.y || 0) + (p.crouching ? .95 : 1.3), z: p.z };
            if (hasLineOfSight(eye(e), targetPoint) && hasLineOfSight({ x: e.x, y:(e.y??0)+1.43, z: e.z }, targetPoint)) shoot(e, target);
          }
        }
      }
      move(e, enemies, dt);
    }
  }
  return { update, hear, hit, reset() { routeTokens = 2; metrics = { plans: 0, senses: 0, routes: 0 }; },
    stats() { return { ...metrics, coverCandidates: coverPoints.length, routeTokens }; } };
}
