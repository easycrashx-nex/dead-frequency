import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,isWalkable,findPath,hasLineOfSight,REVIVE_SECONDS,BLEEDOUT_SECONDS,RAID_SECONDS} from '../src/simulation.js';
import {createCoopSession} from '../src/coop-session.js';
import {ENEMY_TYPES,ENEMY_SPAWNING,rollCorpseItems} from '../src/enemies.js';
import {createEnemyAI} from '../src/enemy-ai.js';
import {INTERIORS,SPAWN,BRIDGES,RELAY} from '../src/layout.js';
import {getGroundHeight} from '../src/terrain.js';
const run=(game,seconds,input={})=>{for(let i=0;i<Math.ceil(seconds*60);i++)game.update(1/60,input);};
async function gameFor(t){const game=await createGame(null,{externalAI:true});t.after(()=>game.dispose());game.startRaid({seed:1111});return game;}
async function coopFor(t){const session=createCoopSession({seed:1111});t.after(()=>session.close());const a=await session.join({name:'Helfer'}),b=await session.join({name:'Partner'});session.ready(a,true);session.ready(b,true);session.start(a);const ga=session.players.get(a).game,gb=session.players.get(b).game;ga.state.enemies.length=0;ga.teleport(-140,130);gb.teleport(-139,130);let seq=0;return{session,a,b,ga,gb,advance(seconds,held=false){for(let i=0;i<Math.ceil(seconds*60);i++){session.input(a,++seq,{reviveHeld:held});session.update(1/60);}}};}

test('hardcore raid lasts thirty minutes and starts 54 patrols plus a protected boss squad at valid terrain heights',async t=>{
  const game=await gameFor(t);assert.equal(RAID_SECONDS,1800);assert.equal(game.state.enemies.length,59);
  for(const enemy of game.state.enemies){assert.equal(enemy.hp,ENEMY_TYPES[enemy.kind].hp);assert.ok(isWalkable(enemy.x,enemy.z,.38,enemy.y),`${enemy.id} inside geometry`);assert.ok(enemy.y>=getGroundHeight(enemy.x,enemy.z)-.1);}
  assert.ok(game.state.enemies.some(enemy=>enemy.y>10));const boss=game.state.enemies.find(enemy=>enemy.kind==='boss'),guards=game.state.enemies.filter(enemy=>enemy.leaderId===boss.id);assert.equal(guards.length,4);assert.equal(boss.maxHp,650);assert.ok(guards.every(guard=>guard.squadId===boss.squadId));
});
test('nearby unseen shots produce an active search while silent hidden positions never become visual knowledge',()=>{
  const enemy={id:'hearing',x:0,y:0,z:0,yaw:0,hp:145,dead:false,home:{x:0,z:0},fireTimer:0};
  const brain=createEnemyAI({isWalkable:()=>true,findPath:(a,b)=>[b],walkSegmentClear:()=>true,hasLineOfSight:()=>false,random:()=>.5});
  const target={id:'player',state:{phase:'raid',player:{x:60,y:0,z:0,hp:100}},damage(){throw Error('Enemy must not shoot through cover');}};
  brain.hear([enemy],{x:60,y:0,z:0},{kind:'shot',radius:90,playerId:'player'});const initial=enemy.x;
  for(let i=0;i<300;i++)brain.update(1/60,[enemy],[target]);assert.equal(enemy.lastSeen,undefined);assert.ok(enemy.x>initial+8);assert.ok(['investigate','sweep','scan'].includes(enemy.ai.task));
  target.state.player.x=120;for(let i=0;i<60;i++)brain.update(1/60,[enemy],[target]);assert.equal(enemy.lastHeard.x,60);
});
test('killed bots become one searchable role-specific corpse and never also emit loose ammunition',async t=>{
  const game=await gameFor(t);game.teleport(-140,130);const template=structuredClone(game.state.enemies[0]);Object.assign(template,{id:'corpse-test',x:-140,y:0,z:127,hp:1,armor:0,dead:false});game.state.enemies=[template];game.state.loot=[];
  assert.equal(game.fire({x:0,y:(1.1-game.state.player.y-1.65)/3,z:-1}),true);const corpse=game.state.containers.find(c=>c.enemyId==='corpse-test');assert.ok(corpse);assert.equal(corpse.kind,'corpse');assert.equal(game.state.loot.length,0);assert.ok(corpse.items.some(item=>item.kind==='ammo'));
  game.teleport(-140,128);assert.equal(game.interact(),true);run(game,corpse.searchSeconds+.1);assert.equal(corpse.searched,true);const item=corpse.items.find(item=>!item.kind);assert.equal(game.takeContainerItem(corpse.id,item.id),true);assert.equal(game.takeContainerItem(corpse.id,item.id),false);assert.equal(game.state.containers.filter(c=>c.enemyId==='corpse-test').length,1);
  const bossItems=rollCorpseItems({id:'boss-test',kind:'boss'},()=>.1);assert.ok(bossItems.some(item=>item.kind==='weapon'));assert.equal(new Set(bossItems.map(item=>item.id)).size,bossItems.length);
});
test('respawn waves stay distant, out of direct view, capped and uniquely identified across the whole raid budget',async t=>{
  const game=await gameFor(t),target={id:'player',state:game.state,damage:game.receiveDamage};game.state.enemies=[];
  for(let wave=0;wave<13;wave++){
    for(let i=0;i<3001;i++)game.advanceEnemies(.05,[target]);const spawned=game.state.enemies.filter(e=>!e.dead);assert.equal(spawned.length,wave<12?6:0);
    for(const enemy of spawned){const dist=Math.hypot(enemy.x-game.state.player.x,enemy.z-game.state.player.z);assert.ok(dist>=85);assert.ok(dist>=360||!hasLineOfSight({...game.state.player,y:game.state.player.y+1.65},{...enemy,y:enemy.y+1.5}));enemy.dead=true;}
  }
  assert.equal(ENEMY_SPAWNING.maxReinforcements,72);assert.equal(new Set(game.state.enemies.map(e=>e.id)).size,game.state.enemies.length);assert.ok(game.spawnStats().reinforcements===72);
});
test('upper floors have explicit connected stair routes and real Rapier stepping follows those heights',async t=>{
  const game=await gameFor(t),room=INTERIORS.find(room=>room.id==='warehouse'),stairs=room.stairs[0];game.state.enemies=[];
  const path=findPath(stairs.start,stairs.end);assert.ok(path.length>15);assert.ok(path.some(point=>point.y>=3.8));assert.equal(game.teleport(stairs.start.x,stairs.start.z,stairs.start.y+.02),true);
  for(let i=0;i<165;i++)game.update(1/60,{forward:1,yaw:Math.PI});assert.ok(game.state.player.y>3.7,`Character stopped at ${game.state.player.y}`);
  const bridge=BRIDGES[1];assert.equal(game.teleport(bridge.x,bridge.z),true);assert.ok(Math.abs(game.state.player.y-bridge.y)<.1);
});
test('downed cooperative players cannot act and a continuous six-second rescue consumes exactly one medkit',async t=>{
  const {session,a,b,ga,gb,advance}=await coopFor(t);gb.receiveDamage(1000,{x:0,z:0});assert.equal(gb.state.player.downed,true);assert.equal(gb.state.phase,'raid');assert.equal(gb.state.player.bleedoutRemaining,BLEEDOUT_SECONDS);
  session.input(b,1,{forward:1,downed:false,hp:100,reviveProgress:6,medkits:999});advance(1/60);assert.equal(gb.state.player.downed,true);assert.equal(gb.state.player.hp,0);
  assert.equal(gb.fire({x:0,y:0,z:-1}),false);assert.equal(gb.reload(),false);assert.equal(gb.heal(),false);assert.equal(gb.interact(),false);const bank=ga.state.player.medkits;
  advance(3,true);assert.ok(gb.state.player.reviveProgress>2.9);assert.equal(gb.state.player.downed,true);assert.equal(ga.state.player.medkits,bank);
  advance(.1,false);assert.equal(gb.state.player.reviveProgress,0);advance(REVIVE_SECONDS+.1,true);assert.equal(gb.state.player.downed,false);assert.equal(gb.state.player.hp,35);assert.equal(ga.state.player.medkits,bank-1);
  advance(1,true);assert.equal(ga.state.player.medkits,bank-1);assert.equal(session.snapshot(a).state.teammates[0].downed,false);
});
test('revives reset on damage or separation, empty medkits cannot rescue, and a second knockdown is final',async t=>{
  const {ga,gb,advance}=await coopFor(t);gb.receiveDamage(1000,{x:0,z:0});advance(2,true);ga.receiveDamage(1,{x:0,z:0});advance(1/60,true);assert.equal(gb.state.player.reviveProgress,0);
  advance(1,true);ga.teleport(-145,130);advance(.1,true);assert.equal(gb.state.player.reviveProgress,0);ga.teleport(-140,130);ga.state.player.medkits=0;advance(7,true);assert.equal(gb.state.player.downed,true);
  ga.state.player.medkits=1;advance(6.1,true);assert.equal(gb.state.player.downed,false);advance(2.1);gb.receiveDamage(1000,{x:0,z:0});assert.equal(gb.state.phase,'dead');
});
test('bleedout expires once and an entirely downed team finishes instead of deadlocking the session',async t=>{
  const first=await coopFor(t);first.gb.receiveDamage(1000,{x:0,z:0});first.advance(60.1);assert.equal(first.gb.state.phase,'dead');assert.equal(first.ga.state.phase,'raid');
  const second=await coopFor(t);second.ga.receiveDamage(1000,{x:0,z:0});second.gb.receiveDamage(1000,{x:0,z:0});second.advance(.1);assert.equal(second.session.phase,'finished');assert.equal(second.ga.state.phase,'dead');assert.equal(second.gb.state.phase,'dead');
});
test('snapshots omit distant container contents and private enemy plans while preserving nearby corpse items',async t=>{
  const {session,a,ga}=await coopFor(t);const far=ga.state.containers.find(c=>Math.hypot(c.x-ga.state.player.x,c.z-ga.state.player.z)>400);assert.ok(far.items.length);let snap=session.snapshot(a);assert.equal(snap.state.containers.find(c=>c.id===far.id).items.length,0);
  ga.teleport(far.x,far.z+far.d/2+1,far.y+.02);snap=session.snapshot(a);assert.ok(snap.state.containers.find(c=>c.id===far.id).items.length>0);
});


test('guards follow observations upstairs and downstairs through physical landings instead of searching the wrong level',async t=>{
  const game=await gameFor(t),room=INTERIORS.find(room=>room.levels===3),guard=game.state.enemies[0],distant={id:'far',state:{phase:'raid',player:{x:-740,y:100,z:740,hp:100}},damage(){}};
  game.state.enemies=[guard];Object.assign(guard,{...room.stairs[0].start,home:{...room.stairs[0].start},id:'vertical-searcher',dead:false});
  for(const goal of [{x:room.x,y:room.baseY+8,z:room.z},{x:room.x,y:room.baseY,z:room.z}]){
    delete guard.ai;Object.assign(guard,{lastSeen:goal,alert:120,path:[],lastHeard:null});let closest=Infinity;
    for(let i=0;i<45*60;i++){game.advanceEnemies(1/60,[distant]);assert.ok(isWalkable(guard.x,guard.z,.38,guard.y));closest=Math.min(closest,Math.hypot(guard.x-goal.x,guard.y-goal.y,guard.z-goal.z));if(closest<1.5)break;}
    assert.ok(closest<1.5,`Guard failed to reach floor ${goal.y}: ${closest}m`);
  }
});

test('boss bodyguards retain two protectors and two flankers and regroup around their living commander',async t=>{
  const game=await gameFor(t),boss=game.state.enemies.find(e=>e.kind==='boss'),guards=game.state.enemies.filter(e=>e.leaderId===boss.id);
  Object.assign(boss,{x:-140,y:0,z:100,home:{x:-140,y:0,z:100},patrol:{x:-140,y:0,z:100}});game.state.enemies=[boss,...guards];
  for(const[ i,guard ]of guards.entries())Object.assign(guard,{x:-140+(i%2?5:-5),y:0,z:100+(i<2?5:-5),home:{x:-140,y:0,z:100}});
  const distant={id:'far',state:{phase:'raid',player:{x:-740,y:100,z:740,hp:100}},damage(){}};
  for(let i=0;i<60;i++)game.advanceEnemies(1/60,[distant]);assert.equal(boss.ai.role,'anchor');assert.equal(guards.filter(e=>e.ai.role==='anchor').length,2);assert.equal(guards.filter(e=>e.ai.role==='flanker').length,2);
  boss.x=-140;boss.z=130;boss.home={x:-140,y:0,z:130};boss.patrol={...boss.home};boss.ai.goal=null;boss.ai.planCooldown=60;const tasks=new Set();
  for(let i=0;i<15*60;i++){game.advanceEnemies(1/60,[distant]);for(const guard of guards)tasks.add(guard.ai.task);}
  assert.ok(tasks.has('regroup'));for(const guard of guards)assert.ok(Math.hypot(guard.x-boss.x,guard.z-boss.z)<15);
});

test('scripted relay reinforcement respects the same 72 living enemy limit as periodic waves',async t=>{
  for(const count of [71,72]){
    const game=await gameFor(t),template=game.state.enemies[0];game.state.enemies=Array.from({length:count},(_,index)=>({...structuredClone(template),id:`cap-test-${index}`}));
    assert.equal(game.teleport(RELAY.x,RELAY.z-1.4),true);assert.equal(game.state.prompt.kind,'relay');assert.equal(game.interact(),true);
    assert.equal(game.state.raid.objectiveComplete,true);assert.equal(game.state.enemies.filter(enemy=>!enemy.dead).length,72);
    assert.equal(game.interact(),false);assert.equal(game.state.enemies.length,72);
  }
});
